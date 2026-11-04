import { Context, Data, Effect, Scope } from "effect"
import * as Discovery from "../discovery/Discovery.ts"
import * as Store from "./Store.ts"

export class AppError extends Data.TaggedError("AppError")<{
	readonly reason: "ConfirmationRequired" | "CandidateChanged" | "Unavailable"
}> {}

export class CleanupPending extends Data.TaggedError("CleanupPending")<{
	readonly key: Store.ConnectionKey
	readonly stage: "Credentials" | "Connection"
}> {}

export class ConnectionScopes extends Context.Service<
	ConnectionScopes,
	{
		readonly register: (input: {
			readonly key: Store.ConnectionKey
			readonly scope: Scope.Closeable
		}) => Effect.Effect<void>
		readonly close: (key: Store.ConnectionKey) => Effect.Effect<void>
	}
>()("@kaicom/k/connections/App/ConnectionScopes") {}

export interface RevalidationOptions {
	readonly key: Store.ConnectionKey
	readonly candidate: Discovery.Candidate
	readonly remoteIndex?: number
	readonly values?: Readonly<Record<string, string>>
	/** Latest requirements obtained by the trusted host. null means an unprotected endpoint. */
	readonly authorization: {
		readonly issuer: string
		readonly scopes: ReadonlyArray<string>
	} | null
	readonly confirmed: boolean
}
