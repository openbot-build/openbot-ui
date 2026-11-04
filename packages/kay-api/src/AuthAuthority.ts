import { randomUUID } from "node:crypto"
import { PgClient } from "@effect/sql-pg"
import { Effect, Schema } from "effect"
import type { DatabaseRuntime } from "./Database.ts"

const Request = Schema.Struct({
	backend: Schema.Literals(["e", "openbot"]),
	epoch: Schema.optionalKey(Schema.Natural),
	migrationId: Schema.optionalKey(Schema.NonEmptyString),
	leaseId: Schema.optionalKey(Schema.NonEmptyString),
})
interface Row {
	readonly migration_id: string
	readonly phase:
		"E_ACTIVE" | "DRAINING" | "COPIED" | "VALIDATED" | "OPENBOT_ACTIVE"
	readonly active_backend: "e" | "openbot"
	readonly epoch: string
}

/** Global identity cutover is separate from per-account business migration. */
export const authAuthority = async ({
	path,
	raw,
	runtime,
}: {
	readonly path: string
	readonly raw: unknown
	readonly runtime: DatabaseRuntime
}) => {
	const input = Schema.decodeUnknownSync(Request)(raw)
	return runtime.runPromise(
		Effect.gen(function* () {
			const sql = yield* PgClient.PgClient
			return yield* sql.withTransaction(
				Effect.gen(function* () {
					const rows =
						yield* sql<Row>`SELECT migration_id,phase,active_backend,epoch FROM kay_auth_migration WHERE id='global' FOR UPDATE`
					const row = rows[0]
					if (row === undefined)
						return { status: 409, body: { allowed: false } }
					const active =
						["E_ACTIVE", "OPENBOT_ACTIVE"].includes(row.phase) &&
						row.active_backend === input.backend
					const state = {
						epoch: Number(row.epoch),
						phase: row.phase,
						migrationId: row.migration_id,
						activeBackend: row.active_backend,
					}
					if (path === "/internal/auth/state")
						return {
							status: 200,
							body: {
								...state,
								mode: active
									? "active"
									: row.phase === "DRAINING"
										? "draining"
										: "frozen",
							},
						}
					if (path === "/internal/auth/release") {
						if (input.leaseId === undefined || input.epoch === undefined)
							return { status: 400, body: { released: false } }
						yield* sql`DELETE FROM kay_auth_write_leases WHERE request_id=${input.leaseId} AND backend=${input.backend} AND epoch=${input.epoch}`
						return { status: 200, body: { released: true } }
					}
					if (
						path === "/internal/auth/revocation-check" ||
						path === "/internal/auth/revocation-status-check"
					) {
						const leases =
							input.leaseId === undefined || input.epoch === undefined
								? []
								: yield* sql<{
										account_id: string
										credential_digest: string
									}>`SELECT r.account_id,r.credential_digest FROM kay_auth_write_leases l JOIN kay_auth_revocations r ON r.id=l.request_id AND r.backend=l.backend AND r.epoch=l.epoch WHERE l.request_id=${input.leaseId} AND l.backend=${input.backend} AND l.epoch=${input.epoch} AND r.phase='Pending'`
						const allowed =
							row.active_backend === input.backend &&
							leases.length === 1 &&
							(path.endsWith("/revocation-status-check") ||
								(Number(row.epoch) === input.epoch &&
									["E_ACTIVE", "OPENBOT_ACTIVE", "DRAINING"].includes(
										row.phase,
									)))
						return {
							status: allowed ? 200 : 409,
							body: {
								...state,
								allowed,
								accountId: leases[0]?.account_id,
								credentialDigest: leases[0]?.credential_digest,
							},
						}
					}
					if (path === "/internal/auth/drain-check") {
						const leases =
							yield* sql`SELECT request_id FROM kay_auth_write_leases LIMIT 1`
						const allowed =
							row.phase === "DRAINING" &&
							row.migration_id === input.migrationId &&
							Number(row.epoch) === input.epoch &&
							leases.length === 0
						return { status: allowed ? 200 : 409, body: { ...state, allowed } }
					}
					if (!active)
						return { status: 409, body: { ...state, allowed: false } }
					const leaseId = randomUUID()
					yield* sql`INSERT INTO kay_auth_write_leases(request_id,backend,epoch) VALUES(${leaseId},${input.backend},${Number(row.epoch)})`
					return { status: 200, body: { ...state, allowed: true, leaseId } }
				}),
			)
		}),
	)
}
