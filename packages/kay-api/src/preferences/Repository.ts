import { Context, Effect, Schema } from "effect"
import {
	PreferencesApi,
	ExperienceStorageUnavailable,
	ExperienceInputInvalid,
	ExperienceNotFound,
} from "@kaicom/e-platform-api"

export const Owner = Schema.Struct({
	tenantId: Schema.NonEmptyString,
	userId: Schema.NonEmptyString,
})
export type Owner = typeof Owner.Type
export class Repository extends Context.Service<
	Repository,
	{
		readonly getPreferences: (
			owner: Owner,
		) => Effect.Effect<
			PreferencesApi.Preferences | null,
			ExperienceStorageUnavailable
		>
		readonly savePreferences: (
			owner: Owner,
			input: PreferencesApi.Preferences,
		) => Effect.Effect<PreferencesApi.Preferences, ExperienceStorageUnavailable>
		readonly modifyPreferences: (input: {
			readonly owner: Owner
			readonly sessionIds?: ReadonlyArray<string> | undefined
			readonly pruneMissingSessions?: boolean
			readonly update: (
				previous: PreferencesApi.Preferences | null,
			) => Effect.Effect<
				PreferencesApi.Preferences,
				| ExperienceInputInvalid
				| ExperienceNotFound
				| PreferencesApi.PreferencesConflict
			>
		}) => Effect.Effect<
			PreferencesApi.Preferences,
			| ExperienceInputInvalid
			| ExperienceNotFound
			| ExperienceStorageUnavailable
			| PreferencesApi.PreferencesConflict
		>
		readonly reset: (
			owner: Owner,
			expected?: PreferencesApi.Preferences | null,
		) => Effect.Effect<boolean, ExperienceStorageUnavailable>
	}
>()("@kaicom/kay-api/preferences/Repository") {}
