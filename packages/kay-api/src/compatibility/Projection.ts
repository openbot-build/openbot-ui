import { Schema } from "effect"
import { AppExecution } from "@kaicom/e-platform-api"

export type Json = Schema.Json
export type ObjectValue = Schema.JsonObject
export const object = (value: Json | undefined): ObjectValue =>
	value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as ObjectValue)
		: {}

const oldMemory = "@kaicom/e-plugin-memory"
const newMemory = "@openbot-build/openbot/memory"
const hostId = "@openbot-build/openbot/session-host"

const memorySettings = (business: Json | undefined) => {
	const memory = object(object(object(business)[hostId])["memory"])
	return {
		memoryEnabled: memory["use"] ?? true,
		memoryGenerationEnabled: memory["generate"] ?? true,
	}
}

/** Transform structural records only. User text, tool arguments and results stay opaque. */
const settings = (value: Json | undefined, business?: Json): ObjectValue => {
	const { pluginSettings, ...rest } = object(value)
	const memory = object(object(pluginSettings)[newMemory])
	return {
		...rest,
		...memorySettings(business),
		...(memory["use"] === undefined ? {} : { memoryEnabled: memory["use"] }),
		...(memory["generate"] === undefined
			? {}
			: { memoryGenerationEnabled: memory["generate"] }),
	}
}

const turn = (value: Json, business?: Json): ObjectValue => {
	const input = object(value)
	const status = object(input["status"])
	return {
		...input,
		...(status["_tag"] === "Waiting"
			? { status: { ...status, _tag: "WaitingApproval" } }
			: {}),
		settings: settings(input["settings"], business),
	}
}

const platformSettings = (
	value: Json | undefined,
	perTurn = false,
): ObjectValue => {
	const { memoryEnabled, memoryGenerationEnabled, ...rest } = object(value)
	return {
		...rest,
		...(perTurn
			? {
					pluginSettings: {
						...object(rest["pluginSettings"]),
						[newMemory]: {
							use: memoryEnabled ?? true,
							generate: memoryGenerationEnabled ?? true,
						},
					},
				}
			: {}),
	}
}

const goalBusiness = (
	value: Json | undefined,
	toPlatform: boolean,
): ObjectValue => {
	const source = toPlatform
		? "@kaicom/e-plugin-goal"
		: "@openbot-build/openbot/goals"
	const target = toPlatform
		? "@openbot-build/openbot/goals"
		: "@kaicom/e-plugin-goal"
	const business = object(value)
	const goal = business[source]
	if (goal === undefined) return business
	const rest = { ...business }
	delete rest[source]
	return { ...rest, [target]: goal }
}

const platformTurn = (value: Json): ObjectValue => {
	const input = object(value),
		status = object(input["status"])
	return {
		...input,
		...(status["_tag"] === "WaitingApproval"
			? { status: { ...status, _tag: "Waiting" } }
			: {}),
		settings: platformSettings(input["settings"], true),
	}
}

const Host = Schema.Struct({
	agent: Schema.NonEmptyString,
	kind: Schema.Literals(["direct", "delegated", "review"]),
	chain: Schema.Struct({
		organizationId: Schema.NonEmptyString,
		userId: Schema.NonEmptyString,
		tokenId: Schema.optionalKey(Schema.String),
		agents: Schema.Array(Schema.NonEmptyString),
		sessions: Schema.Array(Schema.String),
	}),
	parent: Schema.optionalKey(Schema.JsonObject),
	review: Schema.optionalKey(Schema.String),
	memory: Schema.optionalKey(Schema.JsonObject),
})

const platformRef = (value: Json, host: ObjectValue): ObjectValue => {
	const input = object(value),
		defaults = object(input["settings"]),
		business = goalBusiness(input["business"], true)
	const trustedHost = Schema.decodeUnknownSync(Host)(host, {
		onExcessProperty: "error",
	})
	return {
		...input,
		settings: platformSettings(defaults),
		turns: Array.isArray(input["turns"])
			? input["turns"].map(platformTurn)
			: [],
		inheritedTurns: Array.isArray(input["inheritedTurns"])
			? input["inheritedTurns"].map(platformTurn)
			: [],
		business: {
			...business,
			[hostId]: {
				...trustedHost,
				memory: {
					use: defaults["memoryEnabled"] ?? true,
					generate: defaults["memoryGenerationEnabled"] ?? true,
				},
			},
		},
	}
}

/** Restore converts snapshots and defaults; the gateway supplies the actual CAS reference. */
const platformRecord = (value: Json, host: ObjectValue): ObjectValue => {
	const input = object(value)
	return {
		...input,
		session: platformRef(input["session"] ?? {}, host),
		versions: Array.isArray(input["versions"])
			? input["versions"].map((snapshot) => {
					const item = object(snapshot),
						{ memory, [oldMemory]: learned, ...rest } = object(item["value"])
					return {
						...item,
						schemaVersion:
							item["schemaVersion"] === "memory/1"
								? "timeline/1"
								: (item["schemaVersion"] ?? ""),
						value: {
							...rest,
							...(memory === undefined ? {} : { conversation: memory }),
							...(learned === undefined ? {} : { [newMemory]: learned }),
						},
					}
				})
			: [],
	}
}

export const ref = (value: Json): ObjectValue => {
	const input = object(value)
	const { [hostId]: _, ...business } = goalBusiness(input["business"], false)
	return {
		...input,
		metadata: {
			...object(input["metadata"]),
			title: object(input["metadata"])["title"] ?? "",
		},
		business,
		settings: settings(input["settings"], input["business"]),
		turns: Array.isArray(input["turns"])
			? input["turns"].map((t) => turn(t, input["business"]))
			: [],
		inheritedTurns: Array.isArray(input["inheritedTurns"])
			? input["inheritedTurns"].map((t) => turn(t, input["business"]))
			: [],
	}
}

export const version = (value: Json): ObjectValue => {
	const input = object(value)
	return {
		...input,
		...(input["schemaVersion"] === "timeline/1"
			? { schemaVersion: "memory/1" }
			: {}),
	}
}

export const memoryValue = (value: Json): ObjectValue => {
	const { conversation, [newMemory]: learned, ...rest } = object(value)
	return {
		...rest,
		...(conversation === undefined ? {} : { memory: conversation }),
		...(learned === undefined ? {} : { [oldMemory]: learned }),
	}
}

const state = (value: Json, returnTo?: string): ObjectValue => {
	const input = object(value)
	const mapped = memoryValue(input["value"] ?? {})
	return {
		...input,
		version: version(input["version"] ?? {}),
		value:
			returnTo === undefined
				? mapped
				: {
						...mapped,
						memory: historyNavigation(mapped["memory"] ?? {}, returnTo),
					},
	}
}

export const sessionView = (value: Json): ObjectValue => {
	const input = object(value)
	const id = object(input["session"])["id"]
	return {
		...input,
		session: ref(input["session"] ?? {}),
		state: state(
			input["state"] ?? {},
			typeof id === "string" ? `/sessions/${encodeURIComponent(id)}` : "/",
		),
	}
}

export const record = (value: Json): ObjectValue => {
	const input = object(value)
	return {
		...input,
		session: ref(input["session"] ?? {}),
		versions: Array.isArray(input["versions"])
			? input["versions"].map((snapshot) => {
					const v = object(snapshot)
					return { ...version(v), value: memoryValue(v["value"] ?? {}) }
				})
			: [],
	}
}

const connectionKeys = new Set(["cardUrl", "app", "appId", "source"])
/** Only protocol identity slots change. Never rewrite URNs inside user messages. */
const appIdentities = (value: Json, direction: "toOpenBot" | "toKay"): Json => {
	if (Array.isArray(value)) return value.map((v) => appIdentities(v, direction))
	if (value === null || typeof value !== "object") return value
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => [
			key,
			connectionKeys.has(key) && typeof item === "string"
				? item.replace(
						direction === "toKay" ? /^urn:openbot:manual:/ : /^urn:kai:manual:/,
						direction === "toKay" ? "urn:kai:manual:" : "urn:openbot:manual:",
					)
				: [
							"arguments",
							"request",
							"responses",
							"content",
							"result",
							"configuration",
							"definition",
							"headers",
							"values",
					  ].includes(key)
					? item
					: appIdentities(item, direction),
		]),
	)
}

const navigation = (value: Json, returnTo: string): Json => {
	if (Array.isArray(value)) return value.map((v) => navigation(v, returnTo))
	if (value === null || typeof value !== "object") return value
	const input = object(value)
	if (
		[
			"AppCandidates",
			"AppDetails",
			"AppAccess",
			"AppAssistanceFailed",
		].includes(String(input["_tag"]))
	)
		return { ...input, returnTo }
	return Object.fromEntries(
		Object.entries(input).map(([key, item]) => [
			key,
			["arguments", "content", "result"].includes(key)
				? item
				: navigation(item, returnTo),
		]),
	)
}

/** Enrich only platform tool result envelopes used for rendering, never exported content. */
const historyNavigation = (value: Json, returnTo: string): Json => {
	const input = object(value)
	if (!Array.isArray(input["history"])) return value
	return {
		...input,
		history: input["history"].map((entry) => {
			const item = object(entry),
				prompt = object(item["content"])
			if (!Array.isArray(prompt["content"])) return entry
			return {
				...item,
				content: {
					...prompt,
					content: prompt["content"].map((message) => {
						const msg = object(message)
						if (msg["role"] !== "tool" || !Array.isArray(msg["content"]))
							return message
						return {
							...msg,
							content: msg["content"].map((part) => {
								const node = object(part)
								if (node["type"] !== "tool-result") return part
								const result = appIdentities(node["result"] ?? null, "toKay")
								if (
									/^(?:openbot|k)_(?:search_apps|app_details|app_access)(?:_[1-9]\d*)?$/.test(
										String(node["name"]),
									)
								) {
									const enriched = { ...object(result), returnTo }
									if (Schema.is(AppExecution.Assistance)(enriched))
										return { ...node, result: enriched }
								}
								return /^(?:openbot|k)_[a-f0-9]{40}$/.test(
									String(node["name"]),
								) && Schema.is(AppExecution.Result)(result)
									? { ...node, result }
									: part
							}),
						}
					}),
				},
			}
		}),
	}
}

export const response = ({
	path,
	value,
	returnTo = "/",
}: {
	readonly path: string
	readonly value: Json
	readonly returnTo?: string
}): Json => {
	if (path === "/auth/session") {
		const input = object(value),
			identity = object(input["identity"])
		return {
			...input,
			identity: {
				userId: identity["userId"] ?? "",
				tenantId: identity["userId"] ?? "",
			},
		}
	}
	if (path === "/v1/sessions" && Array.isArray(value))
		return value.map((item) => ({
			...object(item),
			...(object(item)["status"] === "Waiting"
				? { status: "WaitingApproval" }
				: {}),
			session: ref(object(item)["session"] ?? {}),
		}))
	if (/^\/v1\/sessions\//.test(path) || path === "/v1/sessions") {
		if (/\/versions$/.test(path) && Array.isArray(value))
			return value.map(version)
		if (/\/history$/.test(path)) return state(value, path.slice(3, -8))
		const input = object(value)
		if (input["state"] !== undefined && input["session"] !== undefined)
			return sessionView(value)
		if (/\/record$/.test(path)) return record(value)
		if (/\/turns\/[^/]+\/items$/.test(path) && Array.isArray(input["items"]))
			return {
				...input,
				items:
					object(
						historyNavigation(
							{ history: input["items"] },
							"/" + path.split("/").slice(2, 4).join("/"),
						),
					)["history"] ?? [],
			}
		if (/\/turns$/.test(path) && Array.isArray(input["items"]))
			return { ...input, items: input["items"].map((t) => turn(t)) }
		if (/\/turns\/[^/]+$/.test(path) && input["turn"] !== undefined)
			return { ...input, turn: turn(input["turn"]) }
		if (/\/memory$/.test(path)) {
			const { settings: _, overrides: __, ...rest } = input
			return rest
		}
	}
	if (
		/^\/v1\/app-operations\/[^/]+(?:\/inputs)?$/.test(path) ||
		/^\/v1\/sessions\/[^/]+\/app-operations$/.test(path)
	) {
		const invocation = (value: Json): Json => {
			const input = object(appIdentities(value, "toKay"))
			const result = input["result"]
			if (result === null || result === undefined) return input
			const mapped = appIdentities(result, "toKay")
			return Schema.is(AppExecution.Result)(mapped)
				? { ...input, result: mapped }
				: input
		}
		return Array.isArray(value) ? value.map(invocation) : invocation(value)
	}
	if (path === "/v1/app-experience/export")
		return { ...object(appIdentities(value, "toKay")), format: "kai-apps-v1" }
	return navigation(appIdentities(value, "toKay"), returnTo)
}

export const request = ({
	path,
	value,
	host,
}: {
	readonly path: string
	readonly value: Json
	/** A current authenticated native host binding; never take it from an imported record. */
	readonly host?: ObjectValue
}): Json => {
	if (/^\/v1\/sessions\/[^/]+\/record$/.test(path)) {
		const input = object(value)
		if (host === undefined)
			throw new Error(
				"A trusted OpenBot Session host is required to restore a record.",
			)
		return { ...input, record: platformRecord(input["record"] ?? {}, host) }
	}
	if (path === "/v1/app-experience/import")
		return {
			...object(appIdentities(value, "toOpenBot")),
			format: "openbot-apps-v1",
		}
	const inputValue = object(value)
	const emptyTitle =
		typeof inputValue["title"] === "string" && inputValue["title"].trim() === ""
	if (/^\/v1\/sessions\/[^/]+$/.test(path) && emptyTitle)
		return { ...inputValue, title: null }
	if (/^\/v1\/sessions(?:\/[^/]+\/(?:turns|fork|settings))?$/.test(path)) {
		const { title, ...withoutTitle } = inputValue
		const input =
				emptyTitle && (path === "/v1/sessions" || path.endsWith("/fork"))
					? withoutTitle
					: inputValue,
			key = /\/turns$/.test(path) ? "overrides" : "settings"
		const { memoryEnabled, memoryGenerationEnabled, ...rest } = object(
			input[key],
		)
		return {
			...input,
			...(input[key] === undefined ? {} : { [key]: rest }),
			...(memoryEnabled === undefined && memoryGenerationEnabled === undefined
				? {}
				: {
						memory: {
							...(memoryEnabled === undefined ? {} : { use: memoryEnabled }),
							...(memoryGenerationEnabled === undefined
								? {}
								: { generate: memoryGenerationEnabled }),
						},
					}),
		}
	}
	return appIdentities(value, "toOpenBot")
}

/** Map protocol identities in query parameters without touching free-text searches. */
export const requestURL = (path: string): string => {
	const url = new URL(path, "http://compatibility.invalid")
	for (const key of connectionKeys) {
		const values = url.searchParams.getAll(key)
		if (values.length === 0) continue
		url.searchParams.delete(key)
		for (const value of values)
			url.searchParams.append(
				key,
				value.replace(/^urn:kai:manual:/, "urn:openbot:manual:"),
			)
	}
	return url.pathname + url.search
}
