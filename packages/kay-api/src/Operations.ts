import { PgClient } from "@effect/sql-pg"
import { Effect, Schema } from "effect"
import type { DatabaseRuntime } from "./Database.ts"

export interface Operation {
	readonly id: string
	readonly accountId: string
	readonly backend: "e" | "openbot"
	readonly epoch: number
	readonly kind:
		"create" | "fork" | "delete" | "reset" | "default-bot" | "feedback-setup"
	readonly request: Schema.JsonObject
}
export interface SavedOperation {
	readonly id: string
	readonly kind: Operation["kind"]
	readonly phase:
		"Prepared" | "Sending" | "Applied" | "Completed" | "OutcomeUnknown"
	readonly request: Schema.JsonObject
	readonly result: Schema.JsonObject | null
}

/** Records the remote result before applying Kay changes. It never resends an uncertain request. */
export const makeOperations = (db: DatabaseRuntime) => {
	const run = <A, E>(fn: (sql: PgClient.PgClient) => Effect.Effect<A, E>) =>
		db.runPromise(Effect.flatMap(PgClient.PgClient, fn))
	return {
		claim: (input: Operation) =>
			run(
				(sql) => sql<{
					id: string
				}>`INSERT INTO kay_operations(id,account_id,backend,epoch,kind,request,phase)
   VALUES(${input.id},${input.accountId},${input.backend},${input.epoch},${input.kind},${JSON.stringify(input.request)}::jsonb,'Prepared')
   ON CONFLICT(id) DO NOTHING RETURNING id`,
			).then((rows) => rows.length === 1),
		/** Release only a confirmed pre-execution refusal belonging to this exact claim. */
		releaseRejected: (input: Operation & { readonly status: number }) =>
			![400, 401, 403, 404, 409, 422].includes(input.status)
				? Promise.resolve(false)
				: run(
						(sql) => sql<{ id: string }>`DELETE FROM kay_operations
					WHERE id=${input.id} AND account_id=${input.accountId}
					AND backend=${input.backend} AND epoch=${input.epoch} AND kind=${input.kind}
					AND request=${JSON.stringify(input.request)}::jsonb AND phase='Sending' AND result IS NULL
					RETURNING id`,
					).then((rows) => rows.length === 1),
		prepare: (input: Operation) =>
			run((sql) =>
				sql.withTransaction(
					Effect.gen(function* () {
						let request = input.request
						if (input.kind === "reset") {
							yield* sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.accountId},0))`
							const rows = yield* sql<{
								body: Schema.JsonObject
							}>`SELECT body FROM kay_preferences WHERE account_id=${input.accountId}`
							request = {
								...request,
								expectedPreferences: rows[0]?.body ?? null,
							}
						}
						yield* sql`INSERT INTO kay_operations(id,account_id,backend,epoch,kind,request,phase)
                VALUES(${input.id},${input.accountId},${input.backend},${input.epoch},${input.kind},${JSON.stringify(request)}::jsonb,'Prepared')`
						return request
					}),
				),
			),
		mark: (input: {
			readonly id: string
			readonly accountId: string
			readonly phase: SavedOperation["phase"]
			readonly result?: Schema.JsonObject
			readonly attemptId?: string
		}) =>
			run(
				(sql) => sql`
			UPDATE kay_operations SET phase=${input.phase},result=COALESCE(${input.result === undefined ? null : JSON.stringify(input.result)}::jsonb,result),updated_at=now()
			WHERE id=${input.id} AND account_id=${input.accountId}
			AND (${input.attemptId ?? null}::text IS NULL OR request->>'attemptId'=${input.attemptId ?? null})
		`,
			),
		get: (input: { readonly id: string; readonly accountId: string }) =>
			run(
				(sql) =>
					sql<SavedOperation>`SELECT id,kind,phase,request,result FROM kay_operations WHERE id=${input.id} AND account_id=${input.accountId}`,
			).then((rows) => rows[0] ?? null),
	}
}
