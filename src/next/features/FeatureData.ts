import { dual } from "effect/Function"
import { adminSectionFor, memoryOperations } from "./SettingsData.ts"
import {
	objectOf,
	resolveSchema,
	seed,
	type JsonObject,
} from "./SchemaValues.ts"

export interface FeatureOperation {
	readonly id: string
	readonly group: string
	readonly title: string
	readonly description: string
	readonly method: string
	readonly params: JsonObject | null
	readonly query: JsonObject | null
	readonly payload: JsonObject | null
	readonly response: JsonObject | null
	readonly transport: "json" | "binary" | "sse" | "websocket" | "multipart"
}
export interface FeatureInput {
	readonly params?: JsonObject
	readonly query?: JsonObject
	readonly payload?: unknown
}

const groups: Readonly<Record<string, ReadonlyArray<string>>> = {
	tasks: [
		"requests",
		"delegations",
		"toolCalls",
		"appOperations",
		"codeRuns",
		"chats",
	],
	files: ["files"],
	apps: [
		"appIndex",
		"apps",
		"connections",
		"appAuthorization",
		"appExperience",
		"appViews",
	],
	automations: ["triggers", "reminders"],
	channels: ["channelLinks"],
	computers: ["computers"],
	live: ["live"],
	settings: [],
	memory: ["bots"],
}

export const orderedGroups: {
	(
		id: string,
		operations: ReadonlyArray<FeatureOperation>,
	): ReadonlyArray<string>
	(
		operations: ReadonlyArray<FeatureOperation>,
	): (id: string) => ReadonlyArray<string>
} = dual(
	2,
	(
		id: string,
		operations: ReadonlyArray<FeatureOperation>,
	): ReadonlyArray<string> => {
		const present = new Set(operations.map((operation) => operation.group))
		return [
			...(groups[id] ?? [id]).filter((group) => present.has(group)),
			...[...present].filter((group) => !(groups[id] ?? [id]).includes(group)),
		]
	},
)

export const belongsTo: {
	(id: string, operation: FeatureOperation): boolean
	(operation: FeatureOperation): (id: string) => boolean
} = dual(2, (id: string, operation: FeatureOperation): boolean => {
	if (id === "admin") return adminSectionFor(operation) !== undefined
	if (id.startsWith("admin:"))
		return adminSectionFor(operation) === id.slice("admin:".length)
	if (id === "memory") return memoryOperations.has(operation.id)
	if (!(groups[id] ?? [id]).includes(operation.group)) return false
	if (id === "tasks" && operation.group === "chats")
		return !new Set([
			"chats.createConversation",
			"chats.forkChat",
			"chats.deleteChat",
			"chats.sendBotMessage",
			"chats.sendMessage",
			"chats.interruptChat",
			"chats.waitChat",
		]).has(operation.id)
	return true
})

/** Keep permitted workflow dependencies even when their group is not in the navigation. */
export const featureScope = ({
	id,
	operations,
}: {
	readonly id: string
	readonly operations: ReadonlyArray<FeatureOperation>
}) => ({
	operations: operations.filter((operation) => belongsTo(id, operation)),
	createImportedConnection: operations.find(
		(operation) => operation.id === "connections.createConnection",
	),
})

/** Only fields named by this operation are carried into its next request. */
type Defaults = {
	readonly botId: string | null
	readonly userId: string
	readonly organizationId: string
}
const reference = (value: unknown): string | undefined =>
	typeof value === "string"
		? value
		: typeof objectOf(value)["id"] === "string"
			? String(objectOf(value)["id"])
			: undefined
export const inputFor: {
	(
		operation: FeatureOperation,
		record: JsonObject,
		defaults: Defaults,
	): FeatureInput
	(
		record: JsonObject,
		defaults: Defaults,
	): (operation: FeatureOperation) => FeatureInput
} = dual(
	3,
	(
		operation: FeatureOperation,
		record: JsonObject,
		defaults: Defaults,
	): FeatureInput => {
		const infer = (
			schema: JsonObject | null,
			kind: "params" | "query" | "payload",
		) => {
			if (schema === null) return undefined
			const result = { ...objectOf(seed(schema)) }
			const idFields = Object.keys(
				objectOf(resolveSchema(schema, schema)["properties"]),
			).filter((name) => name.endsWith("Id"))
			for (const [name, shape] of Object.entries(
				objectOf(resolveSchema(schema, schema)["properties"]),
			)) {
				const field = resolveSchema(objectOf(shape), schema)
				const primitive =
					field["type"] === "string" ||
					field["type"] === "number" ||
					field["type"] === "integer" ||
					field["type"] === "boolean"
				if (name === "expected" && typeof record["revision"] === "number")
					result[name] = record["revision"]
				else if (
					name === "expectedVersion" &&
					typeof record["version"] === "number"
				)
					result[name] = record["version"]
				else if (kind === "params" && name === "botId")
					result[name] =
						reference(record["bot"]) ??
						reference(record["botId"]) ??
						(operation.group === "bots" ? record["id"] : undefined) ??
						defaults["botId"] ??
						undefined
				else if (kind === "params" && name === "organizationId")
					result[name] = record["organizationId"] ?? defaults["organizationId"]
				else if (kind === "params" && name === "userId")
					result[name] = record["userId"] ?? defaults["userId"]
				else if (kind === "params")
					result[name] =
						record[name] ??
						(name === "chatId"
							? (reference(record["chat"]) ?? reference(record["chatId"]))
							: undefined) ??
						(name === "sessionId" ? record["session"] : undefined) ??
						(name.endsWith("Id") && idFields.length === 1
							? record["id"]
							: undefined)
				else if (
					kind === "payload" &&
					operation.method === "PATCH" &&
					primitive &&
					record[name] !== undefined
				)
					result[name] = record[name]
			}
			return Object.fromEntries(
				Object.entries(result).filter(([, value]) => value !== undefined),
			)
		}
		const params = infer(operation.params, "params"),
			query = infer(operation.query, "query"),
			payload = infer(operation.payload, "payload")
		return {
			...(params === undefined ? {} : { params }),
			...(query === undefined ? {} : { query }),
			...(payload === undefined ? {} : { payload }),
		}
	},
)

export function rowsOf(value: unknown): ReadonlyArray<unknown> {
	if (Array.isArray(value)) return value
	const record = objectOf(value)
	for (const field of [
		"items",
		"data",
		"results",
		"models",
		"events",
		"entries",
		"operations",
		"files",
		"apps",
	])
		if (Array.isArray(record[field])) return record[field]
	return value === undefined || value === null ? [] : [value]
}

export function titleOf(value: unknown): string {
	const record = objectOf(value)
	for (const field of [
		"name",
		"title",
		"filename",
		"summary",
		"text",
		"prompt",
		"reason",
		"id",
		"_tag",
	])
		if (typeof record[field] === "string" && record[field] !== "")
			return record[field]
	return typeof value === "string" ? value : ""
}

export const safeLink = (value: unknown) =>
	typeof value === "string" && /^https?:\/\//.test(value) ? value : undefined

export const readFirst = (operations: ReadonlyArray<FeatureOperation>) =>
	operations.find(
		(operation) =>
			operation.method === "GET" &&
			operation.transport === "json" &&
			operation.params === null,
	) ??
	operations.find(
		(operation) => operation.method === "GET" && operation.transport === "json",
	) ??
	operations[0]
