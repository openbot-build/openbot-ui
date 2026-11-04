import {
	ExperienceInputInvalid,
	ExperienceNotFound,
	ExperienceStorageUnavailable,
	Identity,
	PreferencesApi,
} from "@kaicom/e-platform-api"
import { Context, Effect, Layer, Match, Schema } from "effect"
import { Repository } from "./Repository.ts"
import { applyPatch } from "./PreferencePatch.ts"

export const defaults: PreferencesApi.Preferences = {
	assistantName: "小K",
	showDeveloperCenter: false,
	dockMagnification: true,
	dockMagnificationAmount: 100,
}
/**
 * Identity belongs to the authenticated request, not this application-scoped service.
 * @effect-expect-leaking Identity
 */
export class Preferences extends Context.Service<
	Preferences,
	{
		readonly getPreferences: Effect.Effect<
			PreferencesApi.Preferences,
			ExperienceStorageUnavailable,
			Identity
		>
		readonly patchPreferences: (
			input: PreferencesApi.PreferencesPatch,
		) => Effect.Effect<
			PreferencesApi.Preferences,
			| ExperienceInputInvalid
			| ExperienceNotFound
			| ExperienceStorageUnavailable
			| PreferencesApi.PreferencesConflict,
			Identity
		>
		readonly updatePreferences: (
			input: PreferencesApi.PreferencesUpdate,
		) => Effect.Effect<
			PreferencesApi.Preferences,
			| ExperienceInputInvalid
			| ExperienceNotFound
			| ExperienceStorageUnavailable
			| PreferencesApi.PreferencesConflict,
			Identity
		>
	}
>()("@kaicom/kay-api/preferences/Preferences") {}

export const make: Effect.Effect<
	typeof Preferences.Service,
	never,
	Repository
> = Effect.gen(function* () {
	const repository = yield* Repository
	return Preferences.of({
		getPreferences: Effect.gen(function* () {
			return (yield* repository.getPreferences(yield* Identity)) ?? defaults
		}),
		patchPreferences: (input) =>
			Effect.gen(function* () {
				const patch = yield* Schema.decodeEffect(
					PreferencesApi.PreferencesPatch,
				)(input).pipe(
					Effect.mapError(() =>
						ExperienceInputInvalid.make({
							message: "Review the requested preference change.",
						}),
					),
				)
				return yield* repository.modifyPreferences({
					owner: yield* Identity,
					pruneMissingSessions: true,
					sessionIds: Match.value(patch).pipe(
						Match.tag(
							"InheritOrganization",
							({ sessionId, sourceSessionId }) => [sessionId, sourceSessionId],
						),
						Match.tag(
							"SetPin",
							"MoveToProject",
							"CreateProject",
							"AssignCompanion",
							({ sessionId }) => [sessionId],
						),
						Match.tag(
							"CreateCompanion",
							"UpdateCompanion",
							"SetDeveloperCenter",
							() => [],
						),
						Match.exhaustive,
					),
					update: (previous) =>
						applyPatch({ previous: previous ?? defaults, patch }),
				})
			}),
		updatePreferences: (input) =>
			Effect.gen(function* () {
				const validated = yield* Schema.decodeEffect(
					PreferencesApi.PreferencesUpdate,
				)(input).pipe(
					Effect.mapError(() =>
						ExperienceInputInvalid.make({
							message:
								"Review companion and project names, colors, pins and conversation assignments.",
						}),
					),
				)
				const identity = yield* Identity
				return yield* repository.modifyPreferences({
					owner: identity,
					sessionIds:
						validated.workspace === undefined
							? []
							: [
									...validated.workspace.companions.flatMap(
										(companion) => companion.sessions,
									),
									...(validated.workspace.pinnedSessions ?? []),
									...(validated.workspace.projects ?? []).flatMap(
										(project) => project.sessions,
									),
								],
					update: (previous) =>
						Effect.gen(function* () {
							const mergedWorkspace =
								validated.workspace === undefined
									? previous?.workspace
									: { ...previous?.workspace, ...validated.workspace }
							const workspace =
								mergedWorkspace === undefined
									? undefined
									: {
											...mergedWorkspace,
											companions: mergedWorkspace.companions.map(
												(companion, index) => ({
													...companion,
													name:
														index === 0
															? validated.assistantName.trim()
															: companion.name.trim(),
												}),
											),
											...(mergedWorkspace.projects === undefined
												? {}
												: {
														projects: mergedWorkspace.projects.map(
															(project) => ({
																...project,
																name: project.name.trim(),
															}),
														),
													}),
										}
							if (
								previous?.workspace !== undefined &&
								workspace !== undefined &&
								!Schema.toEquivalence(PreferencesApi.Workspace)(
									workspace,
									previous.workspace,
								) &&
								(validated.expectedWorkspace === undefined ||
									!Schema.toEquivalence(PreferencesApi.Workspace)(
										validated.expectedWorkspace,
										previous.workspace,
									))
							) {
								return yield* PreferencesApi.PreferencesConflict.make({
									message:
										"Your workspace has changed. Refresh before saving organization changes.",
								})
							}
							const amount =
								validated.dockMagnificationAmount ??
								(validated.dockMagnification === true &&
								previous?.dockMagnificationAmount === 0
									? 100
									: (previous?.dockMagnificationAmount ?? 100))
							return {
								assistantName: validated.assistantName.trim(),
								dockMagnification:
									amount > 0 &&
									(validated.dockMagnification ??
										(validated.dockMagnificationAmount === undefined
											? (previous?.dockMagnification ?? true)
											: true)),
								dockMagnificationAmount: amount,
								showDeveloperCenter:
									validated.showDeveloperCenter ??
									previous?.showDeveloperCenter ??
									false,
								...(workspace === undefined ? {} : { workspace }),
							}
						}),
				})
			}),
	})
})
export const layer = Layer.effect(Preferences, make)
