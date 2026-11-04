export type JsonObject = Readonly<Record<string, unknown>>
export const objectOf = (value: unknown): JsonObject =>
	value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as JsonObject)
		: {}
export const words = (value: string) =>
	value
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[_-]/g, " ")
		.replace(/^./, (first) => first.toUpperCase())
export const secretField = (name: string) =>
	/password|secret|accessToken|refreshToken|apiKey|credential|^token$/i.test(
		name,
	)
export const literal = (schema: JsonObject): unknown =>
	schema["const"] ??
	(Array.isArray(schema["enum"]) && schema["enum"].length === 1
		? schema["enum"][0]
		: undefined)

/** Schemas are product metadata. Validation and permissions stay on the server. */
export const resolveSchema: {
	(schema: JsonObject, root: JsonObject): JsonObject
	(root: JsonObject): (schema: JsonObject) => JsonObject
} = dual(2, (schema: JsonObject, root: JsonObject): JsonObject => {
	if (typeof schema["$ref"] !== "string" || !schema["$ref"].startsWith("#/"))
		return schema
	let current: unknown = root
	for (const key of schema["$ref"].slice(2).split("/"))
		current = objectOf(current)[key.replace(/~1/g, "/").replace(/~0/g, "~")]
	return {
		...objectOf(current),
		...Object.fromEntries(
			Object.entries(schema).filter(([key]) => key !== "$ref"),
		),
	}
})

const seedWithin = (
	schema: JsonObject,
	root: JsonObject,
	depth = 0,
): unknown => {
	if (depth > 10) return undefined
	const resolved = resolveSchema(schema, root)
	if (resolved["default"] !== undefined) return resolved["default"]
	if (resolved["const"] !== undefined) return resolved["const"]
	if (Array.isArray(resolved["enum"]) && resolved["enum"].length === 1)
		return resolved["enum"][0]
	const variants = Array.isArray(resolved["oneOf"])
		? resolved["oneOf"]
		: Array.isArray(resolved["anyOf"])
			? resolved["anyOf"]
			: []
	if (variants.length > 0) {
		const choice = variants
			.map((entry) => resolveSchema(objectOf(entry), root))
			.find((entry) => entry["type"] !== "null")
		return choice === undefined ? null : seedWithin(choice, root, depth + 1)
	}
	if (resolved["type"] === "object" || resolved["properties"] !== undefined) {
		const required = Array.isArray(resolved["required"])
			? resolved["required"]
			: []
		return Object.fromEntries(
			Object.entries(objectOf(resolved["properties"])).flatMap(
				([key, value]) => {
					const property = resolveSchema(objectOf(value), root)
					if (
						property["default"] !== undefined ||
						property["const"] !== undefined ||
						required.includes(key)
					)
						return [[key, seedWithin(property, root, depth + 1)]]
					return []
				},
			),
		)
	}
	if (resolved["type"] === "array") return []
	if (resolved["type"] === "boolean") return false
	return undefined
}

export const seed = (schema: JsonObject): unknown => seedWithin(schema, schema)
export const seedWithRoot: {
	(schema: JsonObject, root: JsonObject): unknown
	(root: JsonObject): (schema: JsonObject) => unknown
} = dual(2, seedWithin)

export const variantIndex: {
	(choices: ReadonlyArray<JsonObject>, value: unknown, root: JsonObject): number
	(
		value: unknown,
		root: JsonObject,
	): (choices: ReadonlyArray<JsonObject>) => number
} = dual(
	3,
	(
		choices: ReadonlyArray<JsonObject>,
		value: unknown,
		root: JsonObject,
	): number => {
		const exact = choices.findIndex((choice) => {
			if (choice["type"] === "null") return value === null
			if (literal(choice) !== undefined) return literal(choice) === value
			const discriminators = Object.entries(objectOf(choice["properties"]))
				.map(
					([key, field]) =>
						[key, literal(resolveSchema(objectOf(field), root))] as const,
				)
				.filter(([, fixed]) => fixed !== undefined)
			return (
				discriminators.length > 0 &&
				discriminators.every(([key, fixed]) => objectOf(value)[key] === fixed)
			)
		})
		if (exact >= 0) return exact
		const primitive = choices.findIndex(
			(choice) =>
				choice["type"] === typeof value ||
				(choice["type"] === "integer" &&
					typeof value === "number" &&
					Number.isInteger(value)) ||
				(choice["type"] === "array" && Array.isArray(value)),
		)
		return primitive >= 0
			? primitive
			: Math.max(
					0,
					choices.findIndex((choice) => choice["type"] !== "null"),
				)
	},
)

import { dual } from "effect/Function"
