import { Array as EffectArray, Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api"
import { ExperienceErrors } from "./ExperienceErrors.ts"

export const Companion = Schema.Struct({
	id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
	name: Schema.String.check(
		Schema.makeFilter(
			(value) =>
				(Array.from(value.trim()).length >= 1 &&
					Array.from(value.trim()).length <= 20) ||
				"Use a companion name between 1 and 20 characters.",
		),
	),
	color: Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/)),
	sessions: Schema.Array(Schema.String),
})
export type Companion = typeof Companion.Type
export const Project = Schema.Struct({
	id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
	name: Schema.String.check(
		Schema.makeFilter(
			(value) =>
				(Array.from(value.trim()).length >= 1 &&
					Array.from(value.trim()).length <= 60) ||
				"Use a project name between 1 and 60 characters.",
		),
	),
	sessions: Schema.Array(Schema.String),
})
export type Project = typeof Project.Type
export const Workspace = Schema.Struct({
	companions: Schema.Array(Companion).check(
		Schema.makeFilter(
			(items) =>
				(items.length >= 1 &&
					items.length <= 30 &&
					items[0]?.id === "k" &&
					EffectArray.dedupe(items.map((item) => item.id)).length ===
						items.length &&
					EffectArray.dedupe(items.flatMap((item) => item.sessions)).length ===
						items.flatMap((item) => item.sessions).length) ||
				"Keep one default companion and unique companion and conversation identifiers.",
		),
	),
	pinnedSessions: Schema.optionalKey(
		Schema.Array(Schema.String).check(
			Schema.makeFilter(
				(items) =>
					(items.length <= 500 &&
						EffectArray.dedupe(items).length === items.length) ||
					"Keep at most 500 unique pinned conversations.",
			),
		),
	),
	projects: Schema.optionalKey(
		Schema.Array(Project).check(
			Schema.makeFilter(
				(items) =>
					(items.length <= 100 &&
						EffectArray.dedupe(items.map((item) => item.id)).length ===
							items.length &&
						EffectArray.dedupe(items.flatMap((item) => item.sessions))
							.length === items.flatMap((item) => item.sessions).length) ||
					"Keep at most 100 projects with unique identifiers and assign each conversation to one project.",
			),
		),
	),
})
export type Workspace = typeof Workspace.Type

export const Preferences = Schema.Struct({
	dockMagnification: Schema.optionalKey(Schema.Boolean),
	dockMagnificationAmount: Schema.optionalKey(
		Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
	),
	showDeveloperCenter: Schema.optionalKey(Schema.Boolean),
	workspace: Schema.optionalKey(Workspace),
	assistantName: Schema.String.check(
		Schema.makeFilter(
			(value) =>
				(Array.from(value.trim()).length >= 1 &&
					Array.from(value.trim()).length <= 20) ||
				"Use an assistant name between 1 and 20 characters.",
		),
	),
})
export type Preferences = typeof Preferences.Type
export const PreferencesUpdate = Schema.Struct({
	...Preferences.fields,
	expectedWorkspace: Schema.optionalKey(Workspace),
})
export type PreferencesUpdate = typeof PreferencesUpdate.Type
export class PreferencesConflict extends Schema.TaggedError<PreferencesConflict>()(
	"PreferencesConflict",
	{ message: Schema.String },
) {}
export const PreferencesPatch = Schema.Union([
	Schema.TaggedStruct("SetPin", {
		sessionId: Schema.NonEmptyString,
		pinned: Schema.Boolean,
	}),
	Schema.TaggedStruct("MoveToProject", {
		sessionId: Schema.NonEmptyString,
		projectId: Schema.NullOr(Project.fields.id),
	}),
	Schema.TaggedStruct("CreateProject", {
		id: Project.fields.id,
		name: Project.fields.name,
		sessionId: Schema.NonEmptyString,
	}),
	Schema.TaggedStruct("CreateCompanion", {
		id: Companion.fields.id,
		name: Companion.fields.name,
		color: Companion.fields.color,
	}),
	Schema.TaggedStruct("UpdateCompanion", {
		id: Companion.fields.id,
		name: Companion.fields.name,
		color: Companion.fields.color,
	}),
	Schema.TaggedStruct("AssignCompanion", {
		sessionId: Schema.NonEmptyString,
		companionId: Companion.fields.id,
	}),
	Schema.TaggedStruct("InheritOrganization", {
		sessionId: Schema.NonEmptyString,
		sourceSessionId: Schema.NonEmptyString,
	}),
	Schema.TaggedStruct("SetDeveloperCenter", { enabled: Schema.Boolean }),
])
export type PreferencesPatch = typeof PreferencesPatch.Type
export const PreferencesApi = HttpApiGroup.make("preferences").add(
	HttpApiEndpoint.get("getPreferences", "/v1/preferences", {
		success: Preferences,
		error: ExperienceErrors,
	}),
	HttpApiEndpoint.put("updatePreferences", "/v1/preferences", {
		payload: PreferencesUpdate,
		success: Preferences,
		error: [
			...ExperienceErrors,
			PreferencesConflict.pipe(HttpApiSchema.status(409)),
		],
	}),
	HttpApiEndpoint.patch("patchPreferences", "/v1/preferences", {
		payload: Schema.Struct({ change: PreferencesPatch }),
		success: Preferences,
		error: [
			...ExperienceErrors,
			PreferencesConflict.pipe(HttpApiSchema.status(409)),
		],
	}),
	HttpApiEndpoint.delete("resetExperience", "/v1/experience", {
		success: HttpApiSchema.NoContent,
		error: ExperienceErrors,
	}),
)
