import { specTypeSchemas } from "@modelcontextprotocol/client"
import { AppViewsApi as Api } from "@kaicom/e-platform-api"
import { Client as KClient } from "@kaicom/k"
import type { UiClient } from "@kaicom/k/McpApps"
import { Effect, Schema } from "effect"
import { Client } from "./Client.ts"

const failure = () =>
	new KClient.ClientError({
		reason: "Protocol",
		issue:
			"The App view request failed. Review its saved operation before continuing.",
	})
const decode = <A>(
	schema: {
		readonly "~standard": {
			readonly validate: (
				input: unknown,
			) =>
				| { readonly value: A; readonly issues?: undefined }
				| { readonly issues: ReadonlyArray<unknown> }
				| PromiseLike<
						| { readonly value: A; readonly issues?: undefined }
						| { readonly issues: ReadonlyArray<unknown> }
				  >
		}
	},
	input: unknown,
) =>
	Effect.tryPromise({
		try: async () => {
			const result = await schema["~standard"].validate(input)
			if (result.issues !== undefined) throw new Error("Invalid MCP result")
			return result.value
		},
		catch: failure,
	})
export const toolResult = (value: unknown) =>
	decode(specTypeSchemas.CallToolResult, value)
/** A credential-free bridge bound to one server-owned view. Polling never re-submits an action. */
export const make = Effect.fn("AppViews.make")(function* (
	opened: Api.Opened,
	owner: string,
	onChange: () => void = () => {},
) {
	const { api } = yield* Client
	const params = { viewId: opened.id }
	const read = (
		method: "tools/list" | "resources/list" | "resources/templates/list",
		cursor?: string,
	) =>
		api.appViews
			.read({
				params,
				payload: { method, params: cursor === undefined ? {} : { cursor } },
			})
			.pipe(Effect.mapError(failure))
	const invoke = (payload: Api.ActionRequest) =>
		Effect.gen(function* () {
			yield* (
				payload.kind === "tool"
					? api.appViews.act({ params, payload })
					: api.appViews.act({ params, payload })
			).pipe(Effect.mapError(failure))
			let previous: string | undefined
			while (true) {
				const observed = yield* api.appViews
					.operation({ params: { ...params, requestId: payload.requestId } })
					.pipe(Effect.mapError(failure))
				if (previous !== observed.status) {
					previous = observed.status
					onChange()
				}
				const result = observed.operation?.result
				if (observed.status === "Completed" && result?._tag === "Completed")
					return result.result
				if (
					observed.status === "Failed" &&
					result?._tag === "Failed" &&
					result.result !== undefined
				)
					return result.result
				if (
					observed.status === "Failed" ||
					observed.status === "OutcomeUnknown" ||
					observed.status === "Rejected"
				)
					return yield* failure()
				yield* Effect.sleep("250 millis")
			}
		})
	const client: UiClient = {
		key: { owner, connectionId: opened.source.connectionId },
		listTools: (options) =>
			options?.source === "host"
				? decode(specTypeSchemas.ListToolsResult, { tools: opened.tools })
				: read("tools/list", options?.cursor).pipe(
						Effect.flatMap((value) =>
							decode(specTypeSchemas.ListToolsResult, value),
						),
					),
		listResources: (cursor) =>
			read("resources/list", cursor).pipe(
				Effect.flatMap((value) =>
					decode(specTypeSchemas.ListResourcesResult, value),
				),
			),
		listResourceTemplates: (cursor) =>
			read("resources/templates/list", cursor).pipe(
				Effect.flatMap((value) =>
					decode(specTypeSchemas.ListResourceTemplatesResult, value),
				),
			),
		callTool: (input) =>
			Schema.decodeUnknownEffect(Schema.JsonObject)(input.arguments ?? {}).pipe(
				Effect.mapError(failure),
				Effect.flatMap((args) =>
					invoke({
						kind: "tool",
						requestId: crypto.randomUUID(),
						name: input.name,
						arguments: args,
					}),
				),
				Effect.flatMap(toolResult),
				Effect.map((result) => ({ _tag: "Completed" as const, result })),
			),
		readResource: (input, options) =>
			options?.source === "host" && input.uri === opened.resource.uri
				? Effect.succeed({
						_tag: "Completed" as const,
						result: {
							contents: [
								{
									uri: opened.resource.uri,
									mimeType: opened.resource.mimeType,
									text: opened.resource.html,
								},
							],
						},
					})
				: invoke({
						kind: "resource",
						requestId: crypto.randomUUID(),
						uri: input.uri,
					}).pipe(
						Effect.flatMap((value) =>
							decode(specTypeSchemas.ReadResourceResult, value),
						),
						Effect.map((result) => ({ _tag: "Completed" as const, result })),
					),
	}
	return client
})
