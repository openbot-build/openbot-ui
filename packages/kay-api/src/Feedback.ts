import { createHash, createHmac, randomUUID } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import { PgClient } from "@effect/sql-pg"
import { Effect, Schema } from "effect"
import * as Product from "@kaicom/kay-contracts"
import type { DatabaseRuntime } from "./Database.ts"

export interface FeedbackOwner {
	readonly accountId: string
	readonly organizationId: string
	readonly botId: string
}
export interface FeedbackConnection extends FeedbackOwner {
	readonly connectionId: string
}
export class FeedbackFailure extends Error {
	readonly status: number
	constructor(status: number, message: string) {
		super(message)
		this.status = status
	}
}
export interface Feedback {
	readonly connection: (owner: FeedbackOwner) => Promise<FeedbackConnection>
	readonly credential: (connection: FeedbackConnection) => string
	readonly authenticate: (
		authorization: string | undefined,
	) => Promise<FeedbackConnection | null>
	readonly submit: (
		owner: FeedbackOwner,
		report: Product.FeedbackInput,
	) => Promise<Product.FeedbackReceipt>
	readonly list: (query: {
		readonly status?: typeof Product.FeedbackStatus.Type
		readonly before?: string
	}) => Promise<Product.FeedbackPage>
	readonly get: (id: string) => Promise<Product.FeedbackReport>
	readonly update: (
		id: string,
		command: Product.FeedbackUpdate,
		actorId: string,
	) => Promise<Product.FeedbackReport>
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex")
const redact = (value: string) =>
	value
		.replace(
			/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi,
			"[redacted private key]",
		)
		.replace(
			/\b(?:authorization|cookie|set-cookie)\s*[:=][^\r\n]*/gi,
			"[redacted credential header]",
		)
		.replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
		.replace(
			/\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*[^\s,;]+/gi,
			"[redacted credential]",
		)
		.replace(/\bsk-[A-Za-z0-9_-]{12,}/g, "[redacted API key]")
const sanitize = (input: Product.FeedbackInput): Product.FeedbackInput => ({
	...input,
	title: redact(input.title),
	summary: redact(input.summary),
	expected: redact(input.expected),
	actual: redact(input.actual),
	...(input.steps === undefined ? {} : { steps: input.steps.map(redact) }),
	...(input.errorId === undefined ? {} : { errorId: redact(input.errorId) }),
})
interface Row {
	id: string
	report_id: string
	account_id: string
	organization_id: string
	bot_id: string
	content: Product.FeedbackInput
	status: typeof Product.FeedbackStatus.Type
	revision: number
	created_at: string
	updated_at: string
	updated_by: string | null
}
const project = (row: Row): Product.FeedbackReport =>
	Schema.decodeSync(Product.FeedbackReport)({
		id: row.id,
		reportId: row.report_id,
		accountId: row.account_id,
		organizationId: row.organization_id,
		botId: row.bot_id,
		source: "conversation_unknown",
		content: row.content,
		status: row.status,
		revision: row.revision,
		createdAt: Number(row.created_at),
		updatedAt: Number(row.updated_at),
		updatedBy: row.updated_by,
	})
export const makeFeedback = ({
	db,
	secret,
}: {
	readonly db: DatabaseRuntime
	readonly secret: string
}): Feedback => {
	const run = <A, E>(f: (sql: PgClient.PgClient) => Effect.Effect<A, E>) =>
		db.runPromise(Effect.flatMap(PgClient.PgClient, f))
	const credential = (connection: FeedbackConnection) =>
		"kay-feedback_" +
		createHmac("sha256", secret)
			.update(
				JSON.stringify([
					"Feedback2Platform/v1",
					connection.accountId,
					connection.organizationId,
					connection.connectionId,
				]),
			)
			.digest("base64url")
	const get = async (id: string) => {
		const rows = await run(
			(sql) =>
				sql<Row>`SELECT * FROM kay_feedback_reports WHERE id=${id}::uuid`,
		)
		if (rows[0] === undefined)
			throw new FeedbackFailure(404, "This report could not be found.")
		return project(rows[0])
	}
	return {
		credential,
		connection: async (owner) => {
			const connectionId = randomUUID()
			const token = credential({ ...owner, connectionId })
			const rows = await run(
				(sql) => sql<{
					connection_id: string
					bot_id: string
				}>`INSERT INTO kay_feedback_connections(account_id,organization_id,connection_id,credential_hash,bot_id)
    VALUES(${owner.accountId},${owner.organizationId},${connectionId},${hash(token)},${owner.botId})
    ON CONFLICT(account_id,organization_id) DO UPDATE SET bot_id=EXCLUDED.bot_id RETURNING connection_id,bot_id`,
			)
			return {
				...owner,
				connectionId: rows[0]!.connection_id,
				botId: rows[0]!.bot_id,
			}
		},
		authenticate: async (authorization) => {
			const match = /^Bearer (kay-feedback_[A-Za-z0-9_-]{43})$/.exec(
				authorization ?? "",
			)
			if (match?.[1] === undefined) return null
			const rows = await run(
				(sql) =>
					sql<{
						account_id: string
						organization_id: string
						bot_id: string
						connection_id: string
					}>`SELECT account_id,organization_id,bot_id,connection_id FROM kay_feedback_connections WHERE credential_hash=${hash(match[1]!)} AND enabled=true`,
			)
			const row = rows[0]
			return row === undefined
				? null
				: {
						accountId: row.account_id,
						organizationId: row.organization_id,
						botId: row.bot_id,
						connectionId: row.connection_id,
					}
		},
		submit: async (owner, raw) => {
			const content = sanitize(
				Schema.decodeSync(Product.FeedbackInput)(raw, {
					onExcessProperty: "error",
				}),
			)
			const now = Date.now()
			const rows = await run((sql) =>
				sql.withTransaction(
					Effect.gen(function* () {
						yield* sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["feedback", owner.accountId, owner.organizationId])},0))`
						const previous =
							yield* sql<Row>`SELECT * FROM kay_feedback_reports WHERE account_id=${owner.accountId} AND organization_id=${owner.organizationId} AND report_id=${content.reportId}::uuid`
						if (previous[0] !== undefined) return previous
						const recent = yield* sql<{
							count: string
						}>`SELECT count(*) FROM kay_feedback_reports WHERE account_id=${owner.accountId} AND organization_id=${owner.organizationId} AND created_at>${now - 86400000}`
						if (Number(recent[0]?.count) >= 100) return []
						return yield* sql<Row>`INSERT INTO kay_feedback_reports(id,account_id,organization_id,bot_id,report_id,content,created_at,updated_at)
     VALUES(${randomUUID()},${owner.accountId},${owner.organizationId},${owner.botId},${content.reportId}::uuid,${JSON.stringify(content)}::jsonb,${now},${now}) RETURNING *`
					}),
				),
			)
			if (rows[0] === undefined)
				throw new FeedbackFailure(
					429,
					"The daily report limit has been reached.",
				)
			if (!isDeepStrictEqual(rows[0].content, content))
				throw new FeedbackFailure(
					409,
					"This report ID already belongs to different content.",
				)
			return { id: rows[0].id, status: rows[0].status }
		},
		list: async (query) => {
			let cursor: { readonly at: number; readonly id: string } | null = null
			if (query.before !== undefined)
				try {
					cursor = Schema.decodeUnknownSync(
						Schema.Struct({
							at: Schema.Finite,
							id: Schema.String.check(Schema.isUUID()),
						}),
					)(JSON.parse(Buffer.from(query.before, "base64url").toString("utf8")))
				} catch {
					throw new FeedbackFailure(400, "The report page cursor is invalid.")
				}

			const rows = await run(
				(
					sql,
				) => sql<Row>`SELECT * FROM kay_feedback_reports WHERE (${query.status ?? null}::text IS NULL OR status=${query.status ?? null})
    AND (${cursor?.at ?? null}::bigint IS NULL OR (created_at,id)<(${cursor?.at ?? null}::bigint,${cursor?.id ?? null}::uuid)) ORDER BY created_at DESC,id DESC LIMIT 51`,
			)
			const page = rows.slice(0, 50)
			const last = page.at(-1)
			return {
				items: page.map(project),
				next:
					rows.length > 50 && last !== undefined
						? Buffer.from(
								JSON.stringify({ at: Number(last.created_at), id: last.id }),
							).toString("base64url")
						: null,
			}
		},
		get,
		update: async (id, command, actorId) => {
			const rows = await run(
				(
					sql,
				) => sql<Row>`UPDATE kay_feedback_reports SET status=${command.status},revision=revision+1,updated_at=${Date.now()},updated_by=${actorId}
    WHERE id=${id}::uuid AND revision=${command.expected} RETURNING *`,
			)
			if (rows[0] === undefined) {
				await get(id)
				throw new FeedbackFailure(
					409,
					"This report changed. Read its current status before trying again.",
				)
			}
			return project(rows[0])
		},
	}
}
