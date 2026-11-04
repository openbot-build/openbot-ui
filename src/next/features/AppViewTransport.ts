import { specTypeSchemas } from "@modelcontextprotocol/client"
import { Client as KClient } from "@kaicom/k"
import type { UiClient } from "@kaicom/k/McpApps"
import type { Client } from "@kaicom/kay-contracts/Client"
import { Effect, Schema } from "effect"
import { objectOf } from "./SchemaValues.ts"

/** This is a product transport adapter. McpApps owns the protocol and frame boundary. */
export const OpenedView = Schema.Struct({
	id: Schema.String,
	operationId: Schema.String,
	readOnly: Schema.Boolean,
	chat: Schema.String,
	item: Schema.String,
	source: Schema.Struct({
		connectionId: Schema.String,
		connectionName: Schema.String,
		appName: Schema.String,
		name: Schema.String,
	}),
	interaction: Schema.Struct({ revision: Schema.Finite }),
	resource: Schema.Struct({
		uri: Schema.String,
		mimeType: Schema.Literal("text/html;profile=mcp-app"),
		html: Schema.String,
	}),
	tools: Schema.Array(Schema.JsonObject),
	arguments: Schema.JsonObject,
	result: Schema.optional(Schema.JsonObject),
})
export type OpenedView = typeof OpenedView.Type

const failure = () =>
	new KClient.ClientError({
		reason: "Protocol",
		issue:
			"The App request could not be completed. Check its saved operation before continuing.",
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
			if (result.issues !== undefined) throw new Error("Invalid App result")
			return result.value
		},
		catch: failure,
	})

export const toolResult = (value: unknown) =>
	decode(specTypeSchemas.CallToolResult, value)

export const viewClient = ({
	client,
	opened,
	owner,
	onOperation,
	onChanged,
}: {
	readonly client: Pick<Client, "featureCall">
	readonly opened: OpenedView
	readonly owner: string
	readonly onOperation: (operation: {
		readonly requestId: string
		readonly status: string
	}) => void
	readonly onChanged: () => void
}): UiClient => {
	let pending = false
	let uncertain = false
	const params = { viewId: opened.id }
	const call = (id: string, input: Parameters<Client["featureCall"]>[1]) =>
		Effect.tryPromise({
			try: (signal) => client.featureCall(id, input, signal),
			catch: failure,
		})
	const read = (method: string, cursor?: string) =>
		call("appViews.read", {
			params,
			payload: { method, params: cursor === undefined ? {} : { cursor } },
		})
	const invoke = (payload: Schema.JsonObject) =>
		Effect.gen(function* () {
			if (opened.readOnly || pending || uncertain) return yield* failure()
			pending = true
			const requestId = String(payload["requestId"])
			onOperation({ requestId, status: "Sending" })
			try {
				yield* call("appViews.act", { params, payload }).pipe(
					Effect.tapError(() =>
						Effect.sync(() => {
							uncertain = true
							onOperation({ requestId, status: "OutcomeUnknown" })
						}),
					),
				)
				let previous: string | undefined
				while (true) {
					const observed = objectOf(
						yield* call("appViews.operation", {
							params: { ...params, requestId },
						}).pipe(
							Effect.tapError(() =>
								Effect.sync(() => {
									uncertain = true
									onOperation({ requestId, status: "OutcomeUnknown" })
								}),
							),
						),
					)
					const status = String(observed["status"])
					if (previous !== status) {
						previous = status
						onOperation({ requestId, status })
						onChanged()
					}
					const result = objectOf(objectOf(observed["operation"])["result"])
					if (status === "Completed" && result["_tag"] === "Completed")
						return result["result"]
					if (
						status === "Failed" &&
						result["_tag"] === "Failed" &&
						result["result"] !== undefined
					)
						return result["result"]
					if (status === "OutcomeUnknown") uncertain = true
					if (["Failed", "Rejected", "OutcomeUnknown"].includes(status))
						return yield* failure()
					yield* Effect.sleep("500 millis")
				}
			} finally {
				pending = false
			}
		})
	return {
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
}
