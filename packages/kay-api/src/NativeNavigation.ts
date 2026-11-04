import { PgClient } from "@effect/sql-pg"
import { Effect, Schema } from "effect"
import * as Product from "@kaicom/kay-contracts"
import type { DatabaseRuntime } from "./Database.ts"

class NavigationAmbiguous extends Schema.TaggedError<NavigationAmbiguous>()(
	"NavigationAmbiguous",
	{},
) {}

export type FlowKind = "app" | "developer"
const flow = Schema.Struct({ flowId: Product.Id })
const developer = Schema.Struct({ authorization: Schema.NullOr(flow) })
const key = (kind: FlowKind, flowId: string) => `native:${kind}:${flowId}`

/** Store a navigation reference from an authorized core response, never an OAuth secret. */
export const makeNativeNavigation = (db: DatabaseRuntime) => ({
	remember: (input: {
		readonly accountId: string
		readonly kind: FlowKind
		readonly flowId: string
		readonly returnTo: string
	}) =>
		db.runPromise(
			Effect.gen(function* () {
				const sql = yield* PgClient.PgClient
				const destination = yield* Schema.decodeEffect(Product.ReturnTo)(
					input.returnTo,
				)
				yield* sql`INSERT INTO kay_navigation(account_id,flow_id,return_to) VALUES(${input.accountId},${key(input.kind, input.flowId)},${destination}) ON CONFLICT(account_id,flow_id) DO UPDATE SET return_to=EXCLUDED.return_to`
			}),
		),
	lookup: (input: { readonly kind: FlowKind; readonly flowId: string }) =>
		db.runPromise(
			Effect.gen(function* () {
				const sql = yield* PgClient.PgClient
				const rows = yield* sql<{
					account_id: string
					return_to: string
				}>`SELECT account_id,return_to FROM kay_navigation WHERE flow_id=${key(input.kind, input.flowId)}`
				if (rows.length > 1) return yield* NavigationAmbiguous.make({})
				return rows[0] === undefined
					? null
					: { accountId: rows[0].account_id, returnTo: rows[0].return_to }
			}),
		),
})

export const isAuthorizationReply = (operationId: string) =>
	[
		"appAuthorization.beginAppAuthorization",
		"appAuthorization.getAppAuthorization",
		"appAuthorization.completeAppAuthorization",
		"developer.authorizeTest",
		"developer.test",
		"developer.completeTestAuthorization",
	].includes(operationId)

export const rememberAuthorizationReply = async (input: {
	readonly db: DatabaseRuntime
	readonly accountId: string
	readonly operationId: string
	readonly body: unknown
	readonly payload?: Schema.Json
}) => {
	const body = Schema.decodeUnknownSync(Schema.JsonObject)(input.body)
	let flowId: string | undefined
	const kind = input.operationId.startsWith("developer.") ? "developer" : "app"
	if (kind === "developer")
		flowId = Schema.decodeUnknownSync(developer)(body).authorization?.flowId
	else if (
		input.operationId !== "appAuthorization.beginAppAuthorization" ||
		body["_tag"] === "AuthorizationStarted"
	)
		flowId = Schema.decodeUnknownSync(flow)(body).flowId
	if (flowId === undefined) return
	const payload = Schema.is(Schema.JsonObject)(input.payload)
		? input.payload
		: {}
	const destination = body["returnTo"] ?? payload["returnTo"] ?? "/next"
	await makeNativeNavigation(input.db).remember({
		accountId: input.accountId,
		kind,
		flowId,
		returnTo: Schema.decodeUnknownSync(Product.ReturnTo)(destination),
	})
}
