import { Match, Schema } from "effect"

export const AppConnection = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	endpoint: Schema.String,
	enabled: Schema.Boolean,
	revision: Schema.Finite,
	card: Schema.Struct({ name: Schema.String, description: Schema.String }),
	availability: Schema.TaggedUnion({
		PendingConfiguration: {},
		PendingAuthorization: { scopes: Schema.Array(Schema.String) },
		Unverified: {},
		Available: {},
		AuthorizationExpired: {},
		ConnectionFailed: { message: Schema.String },
		NeedsRevalidation: {},
		CleanupPending: {},
		Restricted: {},
	}),
})
export type AppConnection = typeof AppConnection.Type
export const AppConnections = Schema.Array(AppConnection)
export const authorizationNeeded = (connection: AppConnection): boolean =>
	connection.availability._tag === "PendingAuthorization" ||
	connection.availability._tag === "AuthorizationExpired"
export const connectionSummary = (
	connection: AppConnection,
):
	| "ready"
	| "paused"
	| "authorization"
	| "configuration"
	| "restricted"
	| "unavailable" => {
	if (!connection.enabled) return "paused"
	return Match.value(connection.availability._tag).pipe(
		Match.when("Available", () => "ready" as const),
		Match.when(
			(tag) => tag === "PendingAuthorization" || tag === "AuthorizationExpired",
			() => "authorization" as const,
		),
		Match.when("PendingConfiguration", () => "configuration" as const),
		Match.when("Restricted", () => "restricted" as const),
		Match.orElse(() => "unavailable" as const),
	)
}

export const connectionUrl = (input: string): string => {
	const url = new URL(input.trim())
	if (url.protocol !== "https:" || url.username !== "" || url.password !== "")
		throw new Error(
			"Use the service's HTTPS address without a username or password.",
		)
	return url.toString()
}
