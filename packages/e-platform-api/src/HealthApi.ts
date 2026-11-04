import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"

export const Health = Schema.Struct({ status: Schema.Literal("ok") })
export type Health = typeof Health.Type

export const HealthApi = HttpApiGroup.make("health").add(
	HttpApiEndpoint.get("getHealth", "/health", { success: Health }).annotate(
		OpenApi.Description,
		"Checks that the HTTP service can respond. Does not check business dependencies.",
	),
)
