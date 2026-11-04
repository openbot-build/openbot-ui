import { Context, Data, Effect, Schema, Scope, Stream } from "effect"
import { type HttpClientRequest } from "effect/http"

export const publicProductToken = "KProtocol"

export class NetworkError extends Data.TaggedError("NetworkError")<{
	readonly reason:
		| "BlockedTarget"
		| "Transport"
		| "TooLarge"
		| "Timeout"
		| "Redirect"
		| "Encoding"
	readonly message: string
}> {}

export interface Reply {
	readonly url: string
	readonly status: number
	readonly headers: Readonly<Record<string, string>>
	/** Decoded HTTP entity bytes. Owned by the caller's request Scope. */
	readonly body: Stream.Stream<Uint8Array, NetworkError>
}
export interface DocumentResponse {
	readonly url: string
	readonly status: number
	readonly headers: Readonly<Record<string, string>>
	readonly text: string
}
export interface Limits {
	readonly maxBytes?: number
	readonly timeoutMs?: number
	readonly maxRedirects?: number
}

/** A selected network capability. Its implementation must enforce actual connections. */
export class Network extends Context.Service<
	Network,
	{
		readonly identity: {
			readonly scope: "public" | "user"
			readonly owner: string
		}
		readonly execute: (
			request: HttpClientRequest.HttpClientRequest,
		) => Effect.Effect<Reply, NetworkError | Schema.SchemaError, Scope.Scope>
		readonly readDocument: (options: {
			readonly url: string
			readonly headers?: Readonly<Record<string, string>>
			readonly followRedirects?: boolean
		}) => Effect.Effect<DocumentResponse, NetworkError | Schema.SchemaError>
	}
>()("@kaicom/k/network/Network") {}

/** Indexing only accepts this anonymous capability, never a user network. */
export class PublicNetwork extends Context.Service<
	PublicNetwork,
	{
		readonly readDocument: (options: {
			readonly url: string
			/** Indexing checks robots for each document target before following a redirect. */
			readonly followRedirects?: boolean
			readonly validators?: {
				readonly etag?: string
				readonly lastModified?: string
			}
		}) => Effect.Effect<DocumentResponse, NetworkError | Schema.SchemaError>
	}
>()("@kaicom/k/network/Network/PublicNetwork") {}
