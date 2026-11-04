import { pathToFileURL } from "node:url"
import { PgClient } from "@effect/sql-pg"
import { Effect, Schema } from "effect"
import { fromEnvironment, type Configuration } from "./Configuration.ts"
import { runtime, type DatabaseRuntime } from "./Database.ts"

class ReadinessFailure extends Error {}
const Health = Schema.Struct({ status: Schema.Literal("ok") })
const OpenApi = Schema.Struct({
	openapi: Schema.NonEmptyString,
	paths: Schema.JsonObject,
})

/** Deployment checks use anonymous reads; they never create or retry work. */
export const checkReadiness = async ({
	config,
	db,
	origin,
}: {
	readonly config: Configuration
	readonly db: DatabaseRuntime
	readonly origin: string
}) => {
	let backends: ReadonlyArray<"e" | "openbot">
	try {
		backends = await db.runPromise(
			Effect.flatMap(PgClient.PgClient, (sql) =>
				Effect.gen(function* () {
					// These queries verify both the live connection and migrated schema.
					yield* sql`SELECT account_id,body FROM kay_preferences LIMIT 0`
					yield* sql`SELECT id,phase FROM kay_operations LIMIT 0`
					if (config.backendRouting === "native") {
						yield* sql`SELECT account_id,organization_id,chat_id,automation_ids FROM kay_chat_metadata LIMIT 0`
						yield* sql`SELECT account_id,flow_id,return_to FROM kay_navigation LIMIT 0`
						return ["openbot"] as const
					}
					if (config.backendRouting === "e") return ["e"] as const
					const rows = yield* sql<{
						active_backend: "e" | "openbot"
					}>`SELECT active_backend FROM kay_auth_migration WHERE id='global' UNION SELECT active_backend FROM kay_migration_accounts`
					return rows.map((row) => row.active_backend)
				}).pipe(Effect.timeout("10 seconds")),
			),
		)
	} catch {
		throw new ReadinessFailure("Kay database readiness failed.")
	}
	if (backends.length === 0)
		throw new ReadinessFailure("No active runtime is registered.")
	const request = async (
		base: string,
		path: string,
		expected: number,
		gateway = false,
	) => {
		try {
			const response = await fetch(new URL(path, base), {
				redirect: "error",
				signal: AbortSignal.timeout(10000),
			})
			if (response.status !== expected) throw new Error("Unexpected status")
			if (gateway && response.headers.get("x-request-id") === null)
				throw new Error("The request bypassed the gateway")
			return await response.json()
		} catch {
			throw new ReadinessFailure(`Readiness request failed: ${path}.`)
		}
	}
	for (const backend of backends) {
		const source = backend === "e" ? config.eOrigin : config.openbotOrigin
		try {
			Schema.decodeUnknownSync(Health)(await request(source, "/health", 200))
		} catch {
			throw new ReadinessFailure(`The ${backend} runtime is unavailable.`)
		}
	}
	try {
		Schema.decodeUnknownSync(Health)(
			await request(origin, "/health", 200, true),
		)
		await request(origin, "/auth/session", 401, true)
		if (config.backendRouting === "native") {
			await request(origin, "/api/kay/v1/bootstrap", 401, true)
			await request(origin, "/v1/sessions", 410, true)
		} else await request(origin, "/v1/sessions", 401, true)
		const schema = Schema.decodeUnknownSync(OpenApi)(
			await request(origin, "/openapi.json", 200, true),
		)
		const historyPath =
			config.backendRouting === "native" ? "/v1/chats" : "/v1/sessions"
		if (schema.paths[historyPath] === undefined)
			throw new Error("The conversation API is missing")
	} catch (error) {
		if (error instanceof ReadinessFailure) throw error
		throw new ReadinessFailure("The gateway did not return the Platform API.")
	}
}

if (
	process.argv[1] !== undefined &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	const config = fromEnvironment(process.env)
	const db = runtime(config)
	try {
		const args = process.argv.slice(2)
		const origin =
			args.length === 0
				? `http://127.0.0.1:${config.port}`
				: args.length === 1 && args[0] === "--public"
					? config.publicOrigin
					: args.length === 2 && args[0] === "--origin"
						? args[1]
						: undefined
		if (origin === undefined)
			throw new ReadinessFailure("Use Readiness [--public | --origin URL].")
		await checkReadiness({ config, db, origin })
		process.stdout.write("Kay database, runtime and gateway checks passed.\n")
	} catch (error) {
		process.stderr.write(
			(error instanceof ReadinessFailure
				? error.message
				: "Kay readiness failed.") + "\n",
		)
		process.exitCode = 1
	} finally {
		await db.dispose()
	}
}
