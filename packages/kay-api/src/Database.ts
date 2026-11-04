import { PgClient } from "@effect/sql-pg"
import { Layer, ManagedRuntime, Redacted } from "effect"
import type { Configuration } from "./Configuration.ts"

export const runtime = (
	config: Configuration | Pick<Configuration, "databaseUrl">,
) =>
	ManagedRuntime.make(
		PgClient.layer({ url: Redacted.make(config.databaseUrl) }).pipe(
			Layer.orDie,
		),
	)
export type DatabaseRuntime = ReturnType<typeof runtime>
