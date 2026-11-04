import { PgClient } from "@effect/sql-pg"
import { Effect, Schema } from "effect"
import {
	ExperienceStorageUnavailable,
	Identity,
	PreferencesApi,
} from "@kaicom/e-platform-api"
import * as Product from "@kaicom/kay-contracts"
import type { NativeCall, NativeClient } from "@kaicom/kay-contracts/Native"
import type { DatabaseRuntime } from "./Database.ts"
import * as PreferenceRepository from "./preferences/RepositoryPostgres.ts"
import * as Preferences from "./preferences/Preferences.ts"
import { Repository } from "./preferences/Repository.ts"

export class BusinessFailure extends Schema.TaggedError<BusinessFailure>()(
	"BusinessFailure",
	{ status: Schema.Natural, message: Schema.String },
) {}
const metadataRow = Schema.Struct({
	chat_id: Product.Id,
	revision: Schema.Union([Schema.Natural, Schema.String, Schema.BigInt]),
	title: Schema.NullOr(Schema.String),
	archived: Schema.Boolean,
	automation_ids: Product.AutomationIds,
})
const metadata = (value: unknown): Product.ChatMetadata => {
	const row = Schema.decodeUnknownSync(metadataRow)(value)
	return Schema.decodeSync(Product.ChatMetadata)({
		chatId: row.chat_id,
		revision: Number(row.revision),
		title: row.title,
		archived: row.archived,
		automationIds: row.automation_ids,
	})
}
export const makeBusiness = ({
	db,
	identity,
	client,
}: {
	readonly db: DatabaseRuntime
	readonly identity: typeof Product.Identity.Type
	readonly client: NativeClient
}) => {
	const owner = { userId: identity.userId, tenantId: identity.userId }
	const verifyAccess = async (call: NativeCall, allowMissing = false) => {
		let response: Response
		try {
			response = await client.request(call)
		} catch {
			throw BusinessFailure.make({
				status: 503,
				message: "Resource access could not be verified.",
			})
		}
		await response.body?.cancel()
		if (allowMissing && response.status === 404) return false
		if (!response.ok)
			throw BusinessFailure.make({
				status: response.status,
				message: "You do not have access to this resource.",
			})
		return true
	}
	const readAutomationLink = (triggerId: string) =>
		db.runPromise(
			Effect.gen(function* () {
				const sql = yield* PgClient.PgClient
				const rows =
					yield* sql`SELECT chat_id, revision, title, archived, automation_ids FROM kay_chat_metadata WHERE account_id=${identity.userId} AND organization_id=${identity.organizationId} AND automation_ids ? ${triggerId}`
				if (rows.length > 1)
					return yield* BusinessFailure.make({
						status: 409,
						message: "This automation has conflicting conversation links.",
					})
				const saved = rows.map(metadata)
				return {
					triggerId,
					chatId: saved[0]?.chatId ?? null,
					metadata: saved,
				} satisfies Product.AutomationLink
			}),
		)
	const preferenceAction = (
		method: "GET" | "PATCH" | "PUT",
		payload?: unknown,
	) =>
		Effect.gen(function* () {
			const repository = yield* PreferenceRepository.make({
				exists: (id) =>
					Effect.tryPromise({
						try: async () => {
							const response = await client.request({
								operation: "chat",
								id,
							})
							await response.body?.cancel()
							if (response.status === 404) return false
							if (!response.ok) throw new Error("Chat access failed.")
							return true
						},
						catch: () => ExperienceStorageUnavailable.make({}),
					}),
			})
			const service = yield* Preferences.make.pipe(
				Effect.provideService(Repository, repository),
			)
			const action =
				method === "GET"
					? service.getPreferences
					: method === "PATCH"
						? Schema.decodeUnknownEffect(
								Schema.Struct({ change: PreferencesApi.PreferencesPatch }),
							)(payload).pipe(
								Effect.flatMap(({ change }) =>
									service.patchPreferences(change),
								),
							)
						: Schema.decodeUnknownEffect(PreferencesApi.PreferencesUpdate)(
								payload,
							).pipe(Effect.flatMap(service.updatePreferences))
			return yield* action.pipe(Effect.provideService(Identity, owner))
		})
	return {
		getAutomationLink: async (
			triggerId: string,
		): Promise<Product.AutomationLink> => {
			const exists = await verifyAccess(
				{
					operation: "feature",
					id: "triggers.getTrigger",
					payload: { params: { triggerId } },
				},
				true,
			)
			const link = await readAutomationLink(triggerId)
			if (!exists && link.chatId === null)
				throw BusinessFailure.make({
					status: 404,
					message: "This automation was not found.",
				})
			if (link.chatId !== null)
				await verifyAccess({ operation: "chat", id: link.chatId }, true)
			return link
		},
		linkAutomation: async (
			triggerId: string,
			patch: Product.AutomationLinkPatch,
		): Promise<Product.AutomationLink> => {
			const exists = await verifyAccess(
				{
					operation: "feature",
					id: "triggers.getTrigger",
					payload: { params: { triggerId } },
				},
				patch.chatId === null,
			)
			if (patch.chatId !== null)
				await verifyAccess({ operation: "chat", id: patch.chatId })
			if (
				patch.expectedChatId !== null &&
				patch.expectedChatId !== patch.chatId
			)
				await verifyAccess(
					{ operation: "chat", id: patch.expectedChatId },
					true,
				)
			return db.runPromise(
				Effect.gen(function* () {
					const sql = yield* PgClient.PgClient
					return yield* sql.withTransaction(
						Effect.gen(function* () {
							// Association edits share one owner lock so moves cannot deadlock across two conversations.
							yield* sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["kay-automation-links", identity.userId, identity.organizationId])},0))`
							const linked =
								yield* sql`SELECT chat_id, revision, title, archived, automation_ids FROM kay_chat_metadata WHERE account_id=${identity.userId} AND organization_id=${identity.organizationId} AND automation_ids ? ${triggerId}`
							if (linked.length > 1)
								return yield* BusinessFailure.make({
									status: 409,
									message:
										"This automation has conflicting conversation links.",
								})
							const previous =
								linked[0] === undefined ? null : metadata(linked[0])
							if ((previous?.chatId ?? null) !== patch.expectedChatId)
								return yield* BusinessFailure.make({
									status: 409,
									message:
										"The automation link changed. Refresh before saving.",
								})
							if (!exists && previous === null)
								return yield* BusinessFailure.make({
									status: 404,
									message: "This automation was not found.",
								})
							if (
								previous?.chatId === patch.chatId ||
								(previous === null && patch.chatId === null)
							)
								return {
									triggerId,
									chatId: patch.chatId,
									metadata: previous === null ? [] : [previous],
								}
							if (patch.chatId !== null)
								yield* sql`INSERT INTO kay_chat_metadata(account_id,organization_id,chat_id) VALUES (${identity.userId},${identity.organizationId},${patch.chatId}) ON CONFLICT DO NOTHING`
							const affected =
								yield* sql`SELECT chat_id, revision, title, archived, automation_ids FROM kay_chat_metadata WHERE account_id=${identity.userId} AND organization_id=${identity.organizationId} AND (chat_id=${patch.chatId} OR chat_id=${previous?.chatId ?? null}) ORDER BY chat_id FOR UPDATE`
							const saved: Product.ChatMetadata[] = []
							for (const row of affected) {
								const current = metadata(row)
								const remaining = (current.automationIds ?? []).filter(
									(value) => value !== triggerId,
								)
								const automationIds =
									current.chatId === patch.chatId
										? [...remaining, triggerId]
										: remaining
								if (automationIds.length > 100)
									return yield* BusinessFailure.make({
										status: 409,
										message:
											"This conversation already has the maximum number of linked automations.",
									})
								const updated =
									yield* sql`UPDATE kay_chat_metadata SET automation_ids=${JSON.stringify(automationIds)}::jsonb,revision=revision+1,updated_at=now() WHERE account_id=${identity.userId} AND organization_id=${identity.organizationId} AND chat_id=${current.chatId} RETURNING chat_id,revision,title,archived,automation_ids`
								saved.push(metadata(updated[0]))
							}
							return { triggerId, chatId: patch.chatId, metadata: saved }
						}),
					)
				}),
			)
		},
		listMetadata: () =>
			db.runPromise(
				Effect.gen(function* () {
					const sql = yield* PgClient.PgClient
					const rows =
						yield* sql`SELECT chat_id, revision, title, archived, automation_ids FROM kay_chat_metadata WHERE account_id=${identity.userId} AND organization_id=${identity.organizationId}`
					return rows.map(metadata)
				}),
			),
		fillTitle: (chatId: string, title: string) =>
			db.runPromise(
				Effect.gen(function* () {
					const sql = yield* PgClient.PgClient
					// A concurrent manual rename wins; this only fills an unset title.
					yield* sql`INSERT INTO kay_chat_metadata(account_id,organization_id,chat_id,title,revision) VALUES (${identity.userId},${identity.organizationId},${chatId},${title},1) ON CONFLICT(account_id,organization_id,chat_id) DO UPDATE SET title=EXCLUDED.title,revision=kay_chat_metadata.revision+1,updated_at=now() WHERE kay_chat_metadata.title IS NULL`
					const rows =
						yield* sql`SELECT chat_id,revision,title,archived,automation_ids FROM kay_chat_metadata WHERE account_id=${identity.userId} AND organization_id=${identity.organizationId} AND chat_id=${chatId}`
					return metadata(rows[0])
				}),
			),
		patchMetadata: (
			chatId: string,
			patch: typeof Product.ChatMetadataPatch.Type,
		) =>
			db.runPromise(
				Effect.gen(function* () {
					const sql = yield* PgClient.PgClient
					return yield* sql.withTransaction(
						Effect.gen(function* () {
							yield* sql`INSERT INTO kay_chat_metadata(account_id,organization_id,chat_id) VALUES (${identity.userId},${identity.organizationId},${chatId}) ON CONFLICT DO NOTHING`
							const rows =
								yield* sql`SELECT chat_id, revision, title, archived, automation_ids FROM kay_chat_metadata WHERE account_id=${identity.userId} AND organization_id=${identity.organizationId} AND chat_id=${chatId} FOR UPDATE`
							const previous = metadata(rows[0])
							if (previous.revision !== patch.expected)
								return yield* BusinessFailure.make({
									status: 409,
									message:
										"The conversation details changed. Refresh before saving.",
								})
							const title =
								patch.title === undefined ? previous.title : patch.title
							const archived = patch.archived ?? previous.archived
							const saved =
								yield* sql`UPDATE kay_chat_metadata SET title=${title},archived=${archived},revision=revision+1,updated_at=now() WHERE account_id=${identity.userId} AND organization_id=${identity.organizationId} AND chat_id=${chatId} RETURNING chat_id,revision,title,archived,automation_ids`
							return metadata(saved[0])
						}),
					)
				}),
			),
		completeFork: (operationId: string, sourceChatId: string, chatId: string) =>
			db.runPromise(
				Effect.gen(function* () {
					const sql = yield* PgClient.PgClient
					return yield* sql.withTransaction(
						Effect.gen(function* () {
							const rows = yield* sql<{
								phase: string
							}>`SELECT phase FROM kay_operations WHERE id=${operationId} AND account_id=${identity.userId} AND request->>'organizationId'=${identity.organizationId} FOR UPDATE`
							if (rows[0]?.phase === "Completed") return
							if (rows[0]?.phase !== "Applied")
								return yield* BusinessFailure.make({
									status: 409,
									message:
										"The core operation must finish before its product details can be saved.",
								})
							yield* preferenceAction("PATCH", {
								change: {
									_tag: "InheritOrganization",
									sourceSessionId: sourceChatId,
									sessionId: chatId,
								},
							})
							yield* sql`INSERT INTO kay_chat_metadata(account_id, organization_id, chat_id, title) SELECT account_id, organization_id, ${chatId}, title FROM kay_chat_metadata WHERE account_id=${identity.userId} AND organization_id=${identity.organizationId} AND chat_id=${sourceChatId} ON CONFLICT DO NOTHING`
							yield* sql`UPDATE kay_operations SET phase='Completed',updated_at=now() WHERE id=${operationId} AND account_id=${identity.userId}`
						}),
					)
				}),
			),
		preferences: async (method: "GET" | "PATCH" | "PUT", payload?: unknown) => {
			const outcome = await db.runPromise(
				preferenceAction(method, payload).pipe(
					Effect.match({
						onSuccess: (value) => ({ ok: true, value }) as const,
						onFailure: (error) => ({ ok: false, error }) as const,
					}),
				),
			)
			if (outcome.ok) return outcome.value
			const status =
				outcome.error._tag === "PreferencesConflict"
					? 409
					: outcome.error._tag === "ExperienceNotFound"
						? 404
						: outcome.error._tag === "SchemaError" ||
							  outcome.error._tag === "ExperienceInputInvalid"
							? 400
							: 503
			throw BusinessFailure.make({
				status,
				message: "Kay could not update these workspace preferences.",
			})
		},
	}
}
