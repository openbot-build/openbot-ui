import { reconcileRevocation } from "./Logout.ts"
import { makeTelemetry, type Telemetry } from "./Telemetry.ts"
import { createHash, randomUUID, timingSafeEqual } from "node:crypto"
import { createServer, type ServerResponse } from "node:http"
import { PgClient } from "@effect/sql-pg"
import { Effect, Schema } from "effect"
import type { Configuration } from "./Configuration.ts"
import type { DatabaseRuntime } from "./Database.ts"
import { authAuthority } from "./AuthAuthority.ts"

export const GateRequest = Schema.Struct({
	accountId: Schema.NonEmptyString,
	backend: Schema.Literals(["e", "openbot"]),
	epoch: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	intent: Schema.Literals(["admit", "continue", "write", "send"]),
})
const Resolve = Schema.Struct({
	accountId: Schema.NonEmptyString,
	backend: Schema.Literals(["e", "openbot"]),
})
const DrainCheck = Schema.Struct({
	...Resolve.fields,
	sourceTenantId: Schema.NonEmptyString,
	epoch: GateRequest.fields.epoch,
	migrationId: Schema.NonEmptyString,
})
const Release = Schema.Struct({
	...Resolve.fields,
	epoch: GateRequest.fields.epoch,
	leaseId: Schema.NonEmptyString,
})
type LedgerRow = { active_backend: string; phase: string; epoch: string }

export const allows = ({
	row,
	request,
}: {
	readonly row: LedgerRow
	readonly request: typeof GateRequest.Type
}) =>
	row.active_backend === request.backend &&
	Number(row.epoch) === request.epoch &&
	(["E_ACTIVE", "PRECHECK", "OPENBOT_ACTIVE"].includes(row.phase) ||
		(row.phase === "DRAINING" && request.intent !== "admit"))

const reply = (res: ServerResponse, status: number, body: unknown) => {
	res.writeHead(status, {
		"content-type": "application/json",
		"cache-control": "no-store",
	})
	res.end(JSON.stringify(body))
}

/** This listener is private to the service network and never routed through the public edge. */
export const createExecutionAuthority = ({
	config,
	runtime,
	telemetry = makeTelemetry(),
}: {
	readonly config: Configuration
	readonly runtime: DatabaseRuntime
	readonly telemetry?: Telemetry
}) => {
	const secret = createHash("sha256")
		.update(`Bearer ${config.internalToken}`)
		.digest()
	return createServer((req, res) => {
		void (async () => {
			const received = createHash("sha256")
				.update(req.headers.authorization ?? "")
				.digest()
			if (!timingSafeEqual(secret, received)) {
				reply(res, 401, { allowed: false })
				return
			}
			if (req.method === "GET" && req.url === "/internal/metrics") {
				const state = await runtime.runPromise(
					Effect.gen(function* () {
						const sql = yield* PgClient.PgClient
						const phases =
							yield* sql`SELECT phase,count(*)::int AS count FROM kay_migration_accounts GROUP BY phase`
						const frozen =
							yield* sql`SELECT count(*)::int AS count,COALESCE(max(GREATEST(0,60-extract(epoch FROM freeze_deadline_at-clock_timestamp()))),0)::float8 AS max_seconds FROM kay_migration_accounts WHERE freeze_deadline_at IS NOT NULL`
						const unknown =
							yield* sql`SELECT count(*)::int AS count FROM kay_operations WHERE phase='OutcomeUnknown'`
						return { phases, freeze: frozen[0], unknownOperations: unknown[0] }
					}),
				)
				reply(res, 200, { ...telemetry.snapshot(), migration: state })
				return
			}
			if (
				req.method !== "POST" ||
				![
					"/internal/auth/state",
					"/internal/auth/admit",
					"/internal/auth/release",
					"/internal/auth/drain-check",
					"/internal/auth/revocation-check",
					"/internal/auth/revocation-status-check",
					"/internal/auth/revocations/reconcile",
					"/internal/execution/assignment",
					"/internal/execution/drain-check",
					"/internal/execution/resolve",
					"/internal/execution/check",
					"/internal/execution/acquire",
					"/internal/execution/release",
				].includes(req.url ?? "")
			) {
				reply(res, 404, {})
				return
			}
			const chunks: Buffer[] = []
			let size = 0
			for await (const part of req) {
				const buffer = Buffer.isBuffer(part) ? part : Buffer.from(part)
				size += buffer.length
				if (size > 8192) {
					reply(res, 413, {})
					return
				}
				chunks.push(buffer)
			}
			const raw: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"))
			if (req.url === "/internal/auth/revocations/reconcile") {
				const input = Schema.decodeUnknownSync(
					Schema.Struct({ id: Schema.NonEmptyString }),
				)(raw)
				const result = await reconcileRevocation({
					config,
					db: runtime,
					id: input.id,
				})
				reply(res, result.found ? 200 : 404, result)
				return
			}
			if (req.url?.startsWith("/internal/auth/") === true) {
				const result = await authAuthority({ path: req.url, raw, runtime })
				reply(res, result.status, result.body)
				return
			}
			if (req.url === "/internal/execution/assignment") {
				const input = Schema.decodeUnknownSync(
					Schema.Struct({
						namespace: Schema.NonEmptyString,
						backend: Resolve.fields.backend,
					}),
				)(raw)
				const owner =
					input.backend === "openbot"
						? Schema.decodeSync(
								Schema.fromJsonString(
									Schema.Tuple([Schema.NonEmptyString, Schema.NonEmptyString]),
								),
							)(input.namespace)
						: ["", ""]
				const rows = await runtime.runPromise(
					Effect.flatMap(PgClient.PgClient, (sql) =>
						input.backend === "e"
							? sql<LedgerRow>`SELECT active_backend,phase,epoch FROM kay_migration_accounts WHERE source_tenant_id=${input.namespace}`
							: sql<LedgerRow>`SELECT active_backend,phase,epoch FROM kay_migration_accounts WHERE target_organization_id=${owner[0]} AND account_id=${owner[1]}`,
					),
				)
				if (rows.length !== 1) {
					reply(res, 409, { assigned: null })
					return
				}
				reply(res, 200, { assigned: rows[0]?.active_backend === input.backend })
				return
			}
			if (req.url === "/internal/execution/drain-check") {
				const input = Schema.decodeUnknownSync(DrainCheck)(raw)
				const rows = await runtime.runPromise(
					Effect.flatMap(
						PgClient.PgClient,
						(sql) =>
							sql<
								LedgerRow & {
									migration_id: string
									source_tenant_id: string
									target_organization_id: string
								}
							>`SELECT active_backend,phase,epoch,migration_id,source_tenant_id,target_organization_id FROM kay_migration_accounts WHERE account_id=${input.accountId}`,
					),
				)
				const row = rows[0]
				const allowed =
					row !== undefined &&
					row.phase === "DRAINING" &&
					row.migration_id === input.migrationId &&
					input.sourceTenantId ===
						(input.backend === "e"
							? row.source_tenant_id
							: JSON.stringify([
									row.target_organization_id,
									input.accountId,
								])) &&
					allows({ row, request: { ...input, intent: "continue" } })
				reply(res, allowed ? 200 : 409, {
					allowed,
					epoch: row === undefined ? null : Number(row.epoch),
					phase: row?.phase ?? null,
					migrationId: row?.migration_id ?? null,
				})
				return
			}
			if (req.url === "/internal/execution/resolve") {
				const input = Schema.decodeUnknownSync(Resolve)(raw)
				const rows = await runtime.runPromise(
					Effect.flatMap(
						PgClient.PgClient,
						(sql) =>
							sql<LedgerRow>`SELECT active_backend,phase,epoch FROM kay_migration_accounts WHERE account_id=${input.accountId}`,
					),
				)
				const row = rows[0]
				const allowed =
					row !== undefined &&
					allows({
						row,
						request: { ...input, epoch: Number(row.epoch), intent: "admit" },
					})
				if (!allowed) telemetry.increment("epoch_rejected")
				reply(res, allowed ? 200 : 409, {
					allowed,
					epoch: row === undefined ? null : Number(row.epoch),
					phase: row?.phase ?? null,
				})
				return
			}
			if (req.url === "/internal/execution/release") {
				const input = Schema.decodeUnknownSync(Release)(raw)
				await runtime.runPromise(
					Effect.flatMap(
						PgClient.PgClient,
						(sql) =>
							sql`DELETE FROM kay_migration_write_leases WHERE request_id=${input.leaseId} AND account_id=${input.accountId} AND epoch=${input.epoch}`,
					),
				)
				reply(res, 200, { released: true })
				return
			}
			const input = Schema.decodeUnknownSync(GateRequest)(raw)
			const result = await runtime.runPromise(
				Effect.gen(function* () {
					const sql = yield* PgClient.PgClient
					return yield* sql.withTransaction(
						Effect.gen(function* () {
							const rows =
								yield* sql<LedgerRow>`SELECT active_backend,phase,epoch FROM kay_migration_accounts WHERE account_id=${input.accountId} FOR UPDATE`
							const row = rows[0]
							if (row === undefined || !allows({ row, request: input }))
								return {
									allowed: false,
									epoch: row === undefined ? null : Number(row.epoch),
									phase: row?.phase ?? null,
								}
							if (req.url !== "/internal/execution/acquire")
								return {
									allowed: true,
									epoch: Number(row.epoch),
									phase: row.phase,
								}
							const leaseId = randomUUID()
							yield* sql`INSERT INTO kay_migration_write_leases(request_id,account_id,epoch,expires_at) VALUES(${leaseId},${input.accountId},${input.epoch},now()+interval '1 hour')`
							return {
								allowed: true,
								epoch: Number(row.epoch),
								phase: row.phase,
								leaseId,
							}
						}),
					)
				}),
			)
			if (!result.allowed) telemetry.increment("epoch_rejected")
			reply(res, result.allowed ? 200 : 409, result)
		})().catch(() => reply(res, 503, { allowed: false }))
	})
}
