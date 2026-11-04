import { writeFile, mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Authorization, OpenBotApi } from "@openbot-build/client/Api"
import { Context, Option, Schema } from "effect"
import { OpenApi } from "effect/http-api"

// Explicit product surface. Provider callbacks and machine hooks keep their own entry points.
const groups = new Set([
	"developer",
	"appIndex",
	"appAuthorization",
	"apps",
	"chats",
	"operations",
	"executions",
	"toolCalls",
	"live",
	"files",
	"delegations",
	"bots",
	"botInvitations",
	"requests",
	"reminders",
	"memberSettings",
	"triggers",
	"channels",
	"channelLinks",
	"computerProviders",
	"computers",
	"secretProviders",
	"vaults",
	"usage",
	"budgets",
	"appOperations",
	"codeRuns",
	"appViews",
	"appExperience",
	"connections",
	"organizations",
	"platform",
	"userTokens",
	"organization",
	"modelProviders",
	"sso",
])
const excluded = new Set([
	"platform.updatePlatformOrganizationCredits",
	"platform.grantPlatformOrganizationCredits",
])
const document = OpenApi.fromApi(OpenBotApi)
const out =
	process.argv[2] === undefined
		? fileURLToPath(new URL("../src/", import.meta.url))
		: resolve(process.argv[2])
const title = (name) =>
	name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (x) => x.toUpperCase())
const standalone = (schema) => {
	if (schema === undefined) return null
	const definitions = {}
	const visit = (value) => {
		if (Array.isArray(value)) return value.map(visit)
		if (value === null || typeof value !== "object") return value
		if (
			typeof value.$ref === "string" &&
			value.$ref.startsWith("#/components/schemas/")
		) {
			const name = value.$ref.slice("#/components/schemas/".length)
			if (!(name in definitions)) {
				definitions[name] = {}
				definitions[name] = visit(document.components.schemas[name])
			}
			return { ...value, $ref: `#/$defs/${name}` }
		}
		return Object.fromEntries(
			Object.entries(value).map(([key, child]) => [key, visit(child)]),
		)
	}
	const result = visit(schema)
	return Object.keys(definitions).length === 0
		? result
		: { ...result, $defs: definitions }
}
const fields = (parameters, where) => {
	const found = parameters.filter((p) => p.in === where)
	return found.length === 0
		? null
		: standalone({
				type: "object",
				properties: Object.fromEntries(
					found.map((p) => [
						p.name,
						{
							...p.schema,
							...(p.description ? { description: p.description } : {}),
						},
					]),
				),
				required: found.filter((p) => p.required).map((p) => p.name),
				additionalProperties: false,
			})
}
const hasCommandKey = (schema) => {
	if (schema?.$ref?.startsWith("#/components/schemas/"))
		return hasCommandKey(
			document.components.schemas[
				schema.$ref.slice("#/components/schemas/".length)
			],
		)
	return (
		schema?.properties?.commandKey !== undefined ||
		(schema?.allOf ?? schema?.anyOf ?? schema?.oneOf ?? []).some(hasCommandKey)
	)
}
// The adapter supplies command identity; configuration forms must not ask users for it.
const productPayload = (schema) => {
	const visit = (value) => {
		if (Array.isArray(value)) return value.map(visit)
		if (value === null || typeof value !== "object") return value
		const result = Object.fromEntries(
			Object.entries(value).map(([key, child]) => [key, visit(child)]),
		)
		if (result.properties?.commandKey !== undefined) {
			delete result.properties.commandKey
			result.required = (result.required ?? []).filter(
				(key) => key !== "commandKey",
			)
		}
		return result
	}
	return visit(standalone(schema))
}
// FeatureDispatch receives SDK values, not URL strings. Keep its input schema in the catalog.
const typedQuery = (endpoint, parameters) => {
	if (endpoint.query === undefined) return null
	const document = Schema.toJsonSchemaDocument(
		Schema.toType(Schema.make(endpoint.query.ast)),
		{ onExcessProperty: "error" },
	)
	const original = fields(parameters, "query")
	return {
		...document.schema,
		properties: Object.fromEntries(
			Object.entries(document.schema.properties ?? {}).map(([name, schema]) => [
				name,
				{
					...schema,
					...(original?.properties?.[name]?.description === undefined
						? {}
						: { description: original.properties[name].description }),
				},
			]),
		),
		required: document.schema.required ?? [],
		...(Object.keys(document.definitions).length === 0
			? {}
			: { $defs: document.definitions }),
	}
}
// These resources have organization-wide scopes in the native API. Object-specific
// permissions remain the native endpoint's responsibility (for example one Channel).
const managementKinds = new Set([
	"Organization",
	"Role",
	"Member",
	"ModelProvider",
	"Sso",
	"AuditLog",
	"Usage",
	"Budget",
	"Platform",
])
const catalog = [],
	permissions = {},
	cases = []
for (const [groupName, group] of Object.entries(OpenBotApi.groups)) {
	if (!groups.has(groupName)) continue
	for (const [name, endpoint] of Object.entries(group.endpoints)) {
		const id = `${groupName}.${name}`
		if (excluded.has(id)) continue
		const groupRequirement = Option.getOrUndefined(
			Context.getOption(group.annotations, Authorization.GroupRequired),
		)
		const required = Option.getOrElse(
			Context.getOption(endpoint.annotations, Authorization.Required),
			() =>
				(endpoint.method === "GET"
					? groupRequirement?.read
					: groupRequirement?.write) ?? [],
		)
		const management = required
			.filter((requirement) => managementKinds.has(requirement.kind))
			.map(({ kind, action }) => ({ kind, action }))
		if (management.length > 0) permissions[id] = management
		const path = endpoint.path.replace(/:([^/]+)/g, "{$1}")
		const operation = document.paths[path]?.[endpoint.method.toLowerCase()]
		if (!operation) throw new Error(`Missing OpenAPI operation: ${id}`)
		const content = operation.requestBody?.content ?? {}
		const payloadSchema = (
			content["application/json"] ?? content["multipart/form-data"]
		)?.schema
		const command = hasCommandKey(payloadSchema)
		const success =
			Object.entries(operation.responses).find(([status]) =>
				status.startsWith("2"),
			)?.[1]?.content ?? {}
		const websocket = id === "live.connectLive"
		const multipart = "multipart/form-data" in content
		const transport = websocket
			? "websocket"
			: multipart
				? "multipart"
				: "text/event-stream" in success
					? "sse"
					: Object.keys(success).some((t) => t !== "application/json")
						? "binary"
						: "json"
		catalog.push({
			id,
			group: groupName,
			title: operation.summary ?? title(name),
			description: operation.description ?? "",
			method: endpoint.method,
			params: fields(operation.parameters ?? [], "path"),
			query: productPayload(typedQuery(endpoint, operation.parameters ?? [])),
			payload: productPayload(payloadSchema),
			response: standalone(success["application/json"]?.schema),
			transport,
			...(endpoint.method !== "GET" &&
			hasCommandKey(success["application/json"]?.schema) &&
			![
				"appViews.act",
				"appViews.message",
				"chats.sendMessage",
				"chats.sendBotMessage",
			].includes(id)
				? { resultMode: "execution" }
				: {}),
		})
		if (websocket) continue
		const args = ['responseMode: "response-only"']
		for (const slot of ["params", "query"])
			if (endpoint[slot] !== undefined)
				args.push(
					`${slot}: yield* decodeSlot(Api.OpenBotApi.groups.${groupName}.endpoints.${name}, "${slot}", ${slot === "query" && operation.parameters?.some((parameter) => parameter.in === "query" && parameter.name === "commandKey") ? "commandPayload(input.query)" : `input.${slot} ?? {}`})`,
				)
		if (endpoint.payload.size > 0)
			args.push(
				multipart
					? "payload: yield* formData(input.payload)"
					: `payload: yield* decodePayload(Api.OpenBotApi.groups.${groupName}.endpoints.${name}, ${command ? "commandPayload(input.payload)" : "input.payload"})`,
			)
		if (endpoint.headers !== undefined)
			throw new Error(`Explicit headers need review: ${id}`)
		cases.push(
			`case "${id}": return yield* api.${groupName}.${name}({ ${args.join(", ")} })`,
		)
	}
}
await mkdir(out, { recursive: true })
await writeFile(
	resolve(out, "FeatureCatalog.json"),
	JSON.stringify(catalog, null, 2) + "\n",
)
await writeFile(
	resolve(out, "FeaturePermissions.json"),
	JSON.stringify(permissions, null, 2) + "\n",
)
await writeFile(
	resolve(out, "FeatureDispatch.ts"),
	`// Generated from the pinned native API by scripts/generate-features.mjs.\nimport * as Api from "@openbot-build/client/Api"\nimport { commandPayload } from "./Commands.ts"\nimport type { Client, ClientError } from "@openbot-build/client"\nimport { Effect, Schema, SchemaAST } from "effect"\nimport type { HttpApiEndpoint } from "effect/http-api"\nimport type { HttpClientResponse } from "effect/http"\n\nconst decodeSlot = <E extends HttpApiEndpoint.ConstraintRequest & Pick<HttpApiEndpoint.Top, "params" | "query" | "payload">, S extends "params" | "query">(endpoint: E, slot: S, input: unknown) => Schema.decodeUnknownEffect(Schema.toType(Schema.make<E[S extends "params" ? "~Params" : "~Query"]>(endpoint[slot]!.ast)))(input, { onExcessProperty: "error" })\nconst decodePayload = <E extends HttpApiEndpoint.ConstraintRequest & Pick<HttpApiEndpoint.Top, "params" | "query" | "payload">>(endpoint: E, input: unknown) => {\n const payload = endpoint.payload.get("application/json")\n if (payload === undefined || payload.encoding._tag === "Stream") throw new Error("Expected a JSON payload schema.")\n return Schema.decodeUnknownEffect(Schema.make<E["~Payload"]>(payload.schemas.length === 1 ? payload.schemas[0].ast : new SchemaAST.Union(payload.schemas.map((schema) => schema.ast))))(input, { onExcessProperty: "error" })\n}\nconst formData = (input: unknown) => Schema.decodeUnknownEffect(Schema.instanceOf(FormData))(input)\n\nclass UnsupportedOperation extends Schema.TaggedError<UnsupportedOperation>()("UnsupportedOperation", { id: Schema.String }) {}\nexport const dispatchFeature = ({ api, id, input }: { readonly api: typeof Client.Service.api; readonly id: string; readonly input: { readonly params?: unknown; readonly query?: unknown; readonly payload?: unknown } }): Effect.Effect<HttpClientResponse.HttpClientResponse, ClientError | UnsupportedOperation> => Effect.gen(function* () {\n switch (id) {\n ${cases.join("\n ")}\n default: return yield* UnsupportedOperation.make({ id })\n }\n})\n`,
)
console.log(`Generated ${catalog.length} product operations.`)
