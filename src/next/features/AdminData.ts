import { Match, Function } from "effect"
import { objectOf, type JsonObject } from "./SchemaValues.ts"

export interface AdminChoice {
	readonly label: string
	readonly value: unknown
}

export function adminModelChoices({
	models,
	selected,
	purpose,
}: {
	readonly models: ReadonlyArray<JsonObject>
	readonly selected: unknown
	readonly purpose: "chat" | "rules" | "memory"
}): ReadonlyArray<AdminChoice> {
	const current = objectOf(selected)
	return models
		.filter(
			(model) =>
				model["type"] === "language" ||
				(purpose === "rules" && model["type"] === "decision"),
		)
		.map((model) => ({
			label: String(model["name"] ?? model["id"]),
			value:
				current["provider"] === model["provider"] &&
				current["model"] === model["id"]
					? selected
					: {
							_tag: "Config.Selection",
							provider: model["provider"],
							model: model["id"],
						},
		}))
}

export interface AdminField {
	readonly path: string
	readonly label: string
	readonly hint?: string | undefined
	readonly type?:
		| "text"
		| "email"
		| "url"
		| "password"
		| "number"
		| "lines"
		| "boolean"
		| "choice"
		| "multiple"
		| undefined
	readonly choices?: ReadonlyArray<AdminChoice> | undefined
	readonly required?: boolean | undefined
	readonly defaultValue?: unknown
	readonly min?: number | undefined
	readonly max?: number | undefined
	readonly scale?: number | undefined
	readonly integer?: boolean | undefined
	readonly createOnly?: boolean | undefined
	readonly readOnly?: boolean | undefined
	readonly nullable?: boolean | undefined
	readonly blank?: "omit" | undefined
}

export const readPath: {
	(path: string): (record: unknown) => unknown
	(record: unknown, path: string): unknown
} = Function.dual(2, (record: unknown, path: string): unknown =>
	path.split(".").reduce<unknown>((value, key) => objectOf(value)[key], record),
)

export const writePath: {
	(path: string, value: unknown): (record: JsonObject) => JsonObject
	(record: JsonObject, path: string, value: unknown): JsonObject
} = Function.dual(
	3,
	(record: JsonObject, path: string, value: unknown): JsonObject => {
		const [key, ...rest] = path.split(".")
		if (
			key === undefined ||
			["__proto__", "constructor", "prototype"].includes(key)
		)
			throw new Error("Invalid configuration field.")
		return {
			...record,
			[key]:
				rest.length === 0
					? value
					: writePath(objectOf(record[key]), rest.join("."), value),
		}
	},
)

/** Stored secret hints are never accepted as replacement credentials. */
export function withoutSecrets(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(withoutSecrets)
	if (value === null || typeof value !== "object") return value
	const record = objectOf(value)
	if (typeof record["set"] === "boolean" && "hint" in record) return undefined
	return Object.fromEntries(
		Object.entries(record).flatMap(([key, entry]) => {
			const safe = withoutSecrets(entry)
			return safe === undefined ? [] : [[key, safe]]
		}),
	)
}

export const adminDraft: {
	(
		previous: JsonObject | null,
	): (fields: ReadonlyArray<AdminField>) => JsonObject
	(fields: ReadonlyArray<AdminField>, previous: JsonObject | null): JsonObject
} = Function.dual(
	2,
	(
		fields: ReadonlyArray<AdminField>,
		previous: JsonObject | null,
	): JsonObject =>
		Object.fromEntries(
			fields.map((field) => {
				const value =
					previous === null
						? field.defaultValue
						: readPath(previous, field.path)
				return [
					field.path,
					field.type === "password"
						? ""
						: field.type === "number" && typeof value === "number"
							? value / (field.scale ?? 1)
							: (value ?? field.defaultValue ?? ""),
				]
			}),
		),
)

function fieldValue(field: AdminField, value: unknown): unknown {
	return Match.value(field.type ?? "text").pipe(
		Match.when("number", () => {
			if (value === "" || value === undefined || value === null)
				return field.nullable === true ? null : undefined
			const number = Number(value)
			if (
				!Number.isFinite(number) ||
				(field.min !== undefined && number < field.min) ||
				(field.max !== undefined && number > field.max)
			)
				throw new Error(field.label)
			const result = number * (field.scale ?? 1)
			if (field.integer === true && !Number.isInteger(result))
				throw new Error(field.label)
			return result
		}),
		Match.when("lines", () =>
			Array.isArray(value)
				? value
				: String(value ?? "")
						.split(/\n|,/)
						.map((entry) => entry.trim())
						.filter(Boolean),
		),
		Match.when("boolean", () => value === true),
		Match.when("multiple", () => (Array.isArray(value) ? value : [])),
		Match.when("choice", () =>
			value === "" ? (field.nullable === true ? null : undefined) : value,
		),
		Match.when("password", () =>
			typeof value === "string" && value !== "" ? value : undefined,
		),
		Match.orElse(() =>
			typeof value === "string"
				? value.trim() === ""
					? field.nullable === true
						? null
						: ""
					: value.trim()
				: undefined,
		),
	)
}

/** The editor sends only its named fields and preserves unrelated nested settings. */
export function adminPayload({
	fields,
	draft,
	previous,
	defaults = {},
}: {
	readonly fields: ReadonlyArray<AdminField>
	readonly draft: JsonObject
	readonly previous: JsonObject | null
	readonly defaults?: JsonObject | undefined
}): JsonObject {
	let payload: JsonObject = { ...defaults }
	if (previous !== null && typeof previous["version"] === "number")
		payload = { ...payload, expectedVersion: previous["version"] }
	for (const field of fields) {
		if (
			field.readOnly === true ||
			(previous !== null && field.createOnly === true)
		)
			continue
		const rawValue = draft[field.path] ?? field.defaultValue
		const oldValue =
			previous === null ? undefined : readPath(previous, field.path)
		if (
			previous !== null &&
			(rawValue === "" || rawValue === undefined) &&
			(oldValue === null || oldValue === undefined)
		)
			continue
		const value = fieldValue(field, rawValue)
		const savedSecret =
			field.type === "password" &&
			previous !== null &&
			objectOf(readPath(previous, field.path))["set"] === true
		if (
			field.required === true &&
			!savedSecret &&
			(value === undefined ||
				value === null ||
				value === "" ||
				(Array.isArray(value) && value.length === 0))
		)
			throw new Error(field.label)
		if (
			value === undefined ||
			(previous === null &&
				(value === null || (value === "" && field.defaultValue !== "")))
		)
			continue
		if (
			previous !== null &&
			field.type !== "password" &&
			JSON.stringify(value) === JSON.stringify(readPath(previous, field.path))
		)
			continue
		const root = field.path.split(".")[0]!
		if (
			field.path.includes(".") &&
			payload[root] === undefined &&
			previous !== null
		)
			payload = { ...payload, [root]: withoutSecrets(previous[root]) }
		if (field.blank === "omit" && value === "") {
			const parts = field.path.split(".")
			const key = parts.pop()!
			const parent =
				parts.length === 0
					? payload
					: objectOf(readPath(payload, parts.join(".")))
			const cleaned = Object.fromEntries(
				Object.entries(parent).filter(([name]) => name !== key),
			)
			payload =
				parts.length === 0
					? cleaned
					: writePath(payload, parts.join("."), cleaned)
			continue
		}
		payload = writePath(payload, field.path, value)
	}
	return payload
}

export const adminRecordKey = (record: JsonObject): string =>
	String(
		record["id"] ??
			record["userId"] ??
			record["email"] ??
			record["domain"] ??
			"settings",
	)

export const adminRecordName: {
	(fallback: string): (record: JsonObject) => string
	(record: JsonObject, fallback: string): string
} = Function.dual(2, (record: JsonObject, fallback: string): string => {
	for (const key of ["name", "email", "domain", "title", "model"])
		if (typeof record[key] === "string" && record[key] !== "")
			return record[key]
	return fallback
})

export function formatMoney(value: unknown): string {
	return typeof value === "number"
		? new Intl.NumberFormat(undefined, {
				style: "currency",
				currency: "USD",
				maximumFractionDigits: 4,
			}).format(value / 1_000_000)
		: "—"
}

export function displayDate(value: unknown): string {
	const time =
		typeof value === "number" || typeof value === "string"
			? new Date(value)
			: null
	return time !== null && Number.isFinite(time.valueOf())
		? time.toLocaleString()
		: "—"
}
