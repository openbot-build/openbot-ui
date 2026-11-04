import { Match, Schema } from "effect"
import { objectOf, type JsonObject } from "./SchemaValues.ts"

const Requirement = Schema.Struct({
	key: Schema.String,
	isSecret: Schema.Boolean,
	description: Schema.optionalKey(Schema.NullOr(Schema.String)),
	choices: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
})
const Endpoint = Schema.Struct({
	index: Schema.Natural,
	remote: Schema.JsonObject,
	requirements: Schema.Array(Requirement),
})
const Candidate = Schema.Struct({
	cardUrl: Schema.String,
	card: Schema.JsonObject,
	endpoints: Schema.Array(Endpoint),
})
const Draft = Schema.Struct({
	id: Schema.NonEmptyString,
	revision: Schema.Natural,
	input: Schema.String,
	expiresAt: Schema.Finite,
	imported: Schema.optionalKey(
		Schema.Struct({ name: Schema.String, remoteIndex: Schema.Natural }),
	),
	discovery: Schema.Union([
		Schema.TaggedStruct("Single", { candidate: Candidate }),
		Schema.TaggedStruct("Multiple", { candidates: Schema.Array(Candidate) }),
	]),
})
const Imported = Schema.Struct({
	entries: Schema.Array(
		Schema.Struct({
			entry: Schema.Struct({
				name: Schema.String,
				cardUrl: Schema.String,
				remoteIndex: Schema.Natural,
			}),
			draft: Schema.NullOr(Draft),
			error: Schema.NullOr(Schema.String),
		}),
	),
})
export type ImportedEntry = (typeof Imported.Type.entries)[number]
export interface ConnectionChoice {
	readonly cardUrl: string
	readonly name: string
	readonly endpoint: typeof Endpoint.Type
}

export const importedConnections = (value: unknown) =>
	Schema.decodeUnknownSync(Imported)(value).entries
export const connectionChoices = (
	entry: ImportedEntry,
): ReadonlyArray<ConnectionChoice> => {
	if (entry.draft === null) return []
	const candidates = Match.value(entry.draft.discovery).pipe(
		Match.tag("Single", (value) => [value.candidate]),
		Match.tag("Multiple", (value) => value.candidates),
		Match.exhaustive,
	)
	return candidates.flatMap((candidate) =>
		candidate.endpoints.map((endpoint) => ({
			cardUrl: candidate.cardUrl,
			name:
				typeof candidate.card["name"] === "string"
					? candidate.card["name"]
					: entry.entry.name,
			endpoint,
		})),
	)
}
export const defaultConnectionChoice = (entry: ImportedEntry) => {
	const index = connectionChoices(entry).findIndex(
		(choice) =>
			choice.cardUrl === entry.entry.cardUrl &&
			choice.endpoint.index === entry.entry.remoteIndex,
	)
	return index >= 0 ? index : 0
}
export const connectionValuesSchema = (
	choice: ConnectionChoice,
): JsonObject => ({
	type: "object",
	properties: Object.fromEntries(
		choice.endpoint.requirements.map((requirement) => [
			requirement.key,
			{
				type: "string",
				minLength: 1,
				writeOnly: requirement.isSecret,
				...(typeof requirement.description === "string"
					? { description: requirement.description }
					: {}),
				...(Array.isArray(requirement.choices)
					? { enum: requirement.choices }
					: {}),
			},
		]),
	),
	required: choice.endpoint.requirements.map((requirement) => requirement.key),
	additionalProperties: false,
})

/** Fill only references from the core draft; imported exports never supply credentials. */
export const connectionCommand = ({
	entry,
	choice,
	name,
	values,
}: {
	readonly entry: ImportedEntry
	readonly choice: ConnectionChoice
	readonly name: string
	readonly values: unknown
}) => {
	if (entry.draft === null)
		throw new Error("This connection has no available draft.")
	const supplied = objectOf(values)
	return {
		payload: {
			draftId: entry.draft.id,
			revision: entry.draft.revision,
			cardUrl: choice.cardUrl,
			remoteIndex: choice.endpoint.index,
			name,
			values: Object.fromEntries(
				choice.endpoint.requirements.map((requirement) => [
					requirement.key,
					typeof supplied[requirement.key] === "string"
						? supplied[requirement.key]
						: "",
				]),
			),
			confirmed: true,
		},
	}
}
