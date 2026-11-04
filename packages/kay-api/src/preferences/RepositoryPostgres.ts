import { isDeepStrictEqual } from "node:util"
import { PgClient } from "@effect/sql-pg"
import { Context, Effect, Schema } from "effect"
import {
	ExperienceStorageUnavailable,
	ExperienceNotFound,
	PreferencesApi,
} from "@kaicom/e-platform-api"
import { Repository, type Owner } from "./Repository.ts"
import { retainSessions } from "./PreferencePatch.ts"

/** The authenticated request supplies this capability; it has no platform database access. */
export class SessionOwnership extends Context.Service<
	SessionOwnership,
	{
		readonly exists: (
			id: string,
		) => Effect.Effect<boolean, ExperienceStorageUnavailable>
	}
>()("@kaicom/kay-api/preferences/RepositoryPostgres/SessionOwnership") {}

export const make = (ownership: typeof SessionOwnership.Service) =>
	Effect.gen(function* () {
		const sql = yield* PgClient.PgClient
		const read = (owner: Owner) =>
			sql<{
				body: unknown
			}>`SELECT body FROM kay_preferences WHERE account_id = ${owner.userId}`.pipe(
				Effect.flatMap((rows) =>
					rows[0] === undefined
						? Effect.succeed(null)
						: Schema.decodeUnknownEffect(PreferencesApi.Preferences)(
								rows[0].body,
							),
				),
				Effect.mapError(() => ExperienceStorageUnavailable.make({})),
			)
		const write = (owner: Owner, body: PreferencesApi.Preferences) =>
			sql`
		INSERT INTO kay_preferences(account_id,body) VALUES (${owner.userId},${JSON.stringify(body)}::jsonb)
		ON CONFLICT (account_id) DO UPDATE SET body=EXCLUDED.body, updated_at=now()
	`.pipe(
				Effect.as(body),
				Effect.mapError(() => ExperienceStorageUnavailable.make({})),
			)
		const lock = (owner: Owner) =>
			sql`SELECT pg_advisory_xact_lock(hashtextextended(${owner.userId},0))`
		return Repository.of({
			getPreferences: read,
			savePreferences: (owner, body) =>
				sql
					.withTransaction(lock(owner).pipe(Effect.andThen(write(owner, body))))
					.pipe(Effect.mapError(() => ExperienceStorageUnavailable.make({}))),
			modifyPreferences: ({
				owner,
				sessionIds = [],
				pruneMissingSessions,
				update,
			}) =>
				sql
					.withTransaction(
						Effect.gen(function* () {
							yield* lock(owner)
							yield* Effect.forEach(
								[...new Set(sessionIds)],
								(id) =>
									ownership
										.exists(id)
										.pipe(
											Effect.flatMap((found) =>
												found
													? Effect.void
													: Effect.fail(ExperienceNotFound.make({ id })),
											),
										),
								{ concurrency: 8 },
							)
							const previous = yield* read(owner)
							const workspace = previous?.workspace
							if (
								pruneMissingSessions !== true ||
								workspace === undefined ||
								previous === null
							)
								return yield* write(owner, yield* update(previous))
							const references = [
								...new Set([
									...workspace.companions.flatMap((c) => c.sessions),
									...(workspace.pinnedSessions ?? []),
									...(workspace.projects ?? []).flatMap((p) => p.sessions),
								]),
							]
							const found = yield* Effect.forEach(
								references,
								(id) =>
									ownership
										.exists(id)
										.pipe(Effect.map((exists) => ({ id, exists }))),
								{ concurrency: 8 },
							)
							return yield* write(
								owner,
								yield* update({
									...previous,
									workspace: retainSessions({
										workspace,
										keep: (id) =>
											found.some((item) => item.id === id && item.exists),
									}),
								}),
							)
						}),
					)
					.pipe(
						Effect.catchTag("SqlError", () =>
							Effect.fail(ExperienceStorageUnavailable.make({})),
						),
					),
			reset: (owner, expected) =>
				sql
					.withTransaction(
						Effect.gen(function* () {
							yield* lock(owner)
							if (expected === undefined) {
								yield* sql`DELETE FROM kay_preferences WHERE account_id=${owner.userId}`
								return true
							}
							const current = yield* read(owner)
							if (!isDeepStrictEqual(current, expected)) return false
							yield* sql`DELETE FROM kay_preferences WHERE account_id=${owner.userId}`
							return true
						}),
					)
					.pipe(Effect.mapError(() => ExperienceStorageUnavailable.make({}))),
		})
	})
