import { Discovery } from "@kaicom/k"
import { Schema } from "effect"
import {
	HttpApiEndpoint,
	HttpApiError,
	HttpApiGroup,
	HttpApiSchema,
	OpenApi,
} from "effect/http-api"

export const DiscoverAppRequest = Schema.Struct({
	input: Schema.NonEmptyString,
})
export type DiscoverAppRequest = typeof DiscoverAppRequest.Type

export const AppDiscoveryResult = Schema.Union([
	Schema.TaggedStruct("Single", {
		candidate: Discovery.Candidate,
		issues: Schema.Array(Discovery.Issue),
	}),
	Schema.TaggedStruct("Multiple", {
		candidates: Schema.Array(Discovery.Candidate).check(Schema.isMinLength(2)),
		issues: Schema.Array(Discovery.Issue),
	}),
])
export type AppDiscoveryResult = typeof AppDiscoveryResult.Type

export class AppDiscoveryFailed extends Schema.TaggedError<AppDiscoveryFailed>()(
	"AppDiscoveryFailed",
	{
		reason: Schema.Literals([
			"InvalidInput",
			"NoDeclaration",
			"NoUsableServices",
			"Document",
			"IncompatibleCard",
			"Http",
			"BlockedTarget",
			"Transport",
			"TooLarge",
			"Timeout",
			"Redirect",
			"Encoding",
		]),
		issues: Schema.Array(Discovery.Issue),
	},
) {}

export const AppsApi = HttpApiGroup.make("apps").add(
	HttpApiEndpoint.post("discoverApp", "/v1/apps/discover", {
		payload: DiscoverAppRequest,
		success: AppDiscoveryResult,
		error: [
			HttpApiError.BadRequestNoContent,
			AppDiscoveryFailed.pipe(HttpApiSchema.status(422)),
		],
	}).annotate(
		OpenApi.Description,
		"Discovers Apps at a domain or HTTPS link. Returns K Protocol candidates, configuration requirements and provenance without adding a connection, authorizing an account or indexing a service.",
	),
)
