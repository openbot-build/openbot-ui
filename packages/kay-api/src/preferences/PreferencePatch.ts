import {
	ExperienceInputInvalid,
	ExperienceNotFound,
	PreferencesApi,
} from "@kaicom/e-platform-api"
import { Effect, Match, Schema } from "effect"

export const retainSessions = ({
	workspace,
	keep,
}: {
	readonly workspace: PreferencesApi.Workspace
	readonly keep: (sessionId: string) => boolean
}): PreferencesApi.Workspace => ({
	...workspace,
	companions: workspace.companions.map((companion) => ({
		...companion,
		sessions: companion.sessions.filter(keep),
	})),
	...(workspace.pinnedSessions === undefined
		? {}
		: { pinnedSessions: workspace.pinnedSessions.filter(keep) }),
	...(workspace.projects === undefined
		? {}
		: {
				projects: workspace.projects.map((project) => ({
					...project,
					sessions: project.sessions.filter(keep),
				})),
			}),
})
export const removeSession = ({
	workspace,
	sessionId,
}: {
	readonly workspace: PreferencesApi.Workspace
	readonly sessionId: string
}) => retainSessions({ workspace, keep: (id) => id !== sessionId })

export const applyPatch = ({
	previous,
	patch,
}: {
	readonly previous: PreferencesApi.Preferences
	readonly patch: PreferencesApi.PreferencesPatch
}) =>
	Effect.gen(function* () {
		const workspace = previous.workspace ?? {
			companions: [
				{
					id: "k",
					name: previous.assistantName,
					color: "#252525",
					sessions: [],
				},
			],
		}
		const withWorkspace = (value: PreferencesApi.Workspace) => ({
			...previous,
			workspace: value,
		})
		const updated = yield* Match.value(patch).pipe(
			Match.tag("SetDeveloperCenter", ({ enabled }) =>
				Effect.succeed({ ...previous, showDeveloperCenter: enabled }),
			),
			Match.tag("SetPin", ({ sessionId, pinned }) =>
				Effect.succeed(
					withWorkspace({
						...workspace,
						pinnedSessions: [
							...(workspace.pinnedSessions ?? []).filter(
								(id) => id !== sessionId,
							),
							...(pinned ? [sessionId] : []),
						],
					}),
				),
			),
			Match.tag("MoveToProject", ({ sessionId, projectId }) =>
				projectId !== null &&
				!(workspace.projects ?? []).some((p) => p.id === projectId)
					? Effect.fail(ExperienceNotFound.make({ id: projectId }))
					: Effect.succeed(
							withWorkspace({
								...workspace,
								projects: (workspace.projects ?? []).map((project) => ({
									...project,
									sessions: [
										...project.sessions.filter((id) => id !== sessionId),
										...(project.id === projectId ? [sessionId] : []),
									],
								})),
							}),
						),
			),
			Match.tag("CreateProject", ({ id, name, sessionId }) => {
				const existing = workspace.projects?.find((p) => p.id === id)
				if (existing !== undefined) {
					return existing.name === name.trim() &&
						existing.sessions.includes(sessionId)
						? Effect.succeed(previous)
						: Effect.fail(
								ExperienceInputInvalid.make({
									message: "This project identifier is already in use.",
								}),
							)
				}
				return Effect.succeed(
					withWorkspace({
						...workspace,
						projects: [
							...(workspace.projects ?? []).map((project) => ({
								...project,
								sessions: project.sessions.filter(
									(value) => value !== sessionId,
								),
							})),
							{ id, name: name.trim(), sessions: [sessionId] },
						],
					}),
				)
			}),
			Match.tag("CreateCompanion", ({ id, name, color }) => {
				const existing = workspace.companions.find((c) => c.id === id)
				if (existing !== undefined) {
					return existing.name === name.trim() && existing.color === color
						? Effect.succeed(previous)
						: Effect.fail(
								ExperienceInputInvalid.make({
									message: "This companion identifier is already in use.",
								}),
							)
				}
				return Effect.succeed(
					withWorkspace({
						...workspace,
						companions: [
							...workspace.companions,
							{ id, name: name.trim(), color, sessions: [] },
						],
					}),
				)
			}),
			Match.tag("UpdateCompanion", ({ id, name, color }) =>
				!workspace.companions.some((c) => c.id === id)
					? Effect.fail(ExperienceNotFound.make({ id }))
					: Effect.succeed({
							...previous,
							...(id === "k" ? { assistantName: name.trim() } : {}),
							workspace: {
								...workspace,
								companions: workspace.companions.map((companion) =>
									companion.id === id
										? { ...companion, name: name.trim(), color }
										: companion,
								),
							},
						}),
			),
			Match.tag("AssignCompanion", ({ sessionId, companionId }) =>
				!workspace.companions.some((c) => c.id === companionId)
					? Effect.fail(ExperienceNotFound.make({ id: companionId }))
					: Effect.succeed(
							withWorkspace({
								...workspace,
								companions: workspace.companions.map((companion) => ({
									...companion,
									sessions: [
										...companion.sessions.filter((id) => id !== sessionId),
										...(companion.id === companionId ? [sessionId] : []),
									],
								})),
							}),
						),
			),
			Match.tag("InheritOrganization", ({ sessionId, sourceSessionId }) => {
				const companionId =
					workspace.companions.find((companion) =>
						companion.sessions.includes(sourceSessionId),
					)?.id ?? "k"
				const projectId = workspace.projects?.find((project) =>
					project.sessions.includes(sourceSessionId),
				)?.id
				return Effect.succeed(
					withWorkspace({
						...workspace,
						companions: workspace.companions.map((companion) => ({
							...companion,
							sessions: [
								...companion.sessions.filter((id) => id !== sessionId),
								...(companion.id === companionId ? [sessionId] : []),
							],
						})),
						...(workspace.projects === undefined
							? {}
							: {
									projects: workspace.projects.map((project) => ({
										...project,
										sessions: [
											...project.sessions.filter((id) => id !== sessionId),
											...(project.id === projectId ? [sessionId] : []),
										],
									})),
								}),
					}),
				)
			}),
			Match.exhaustive,
		)
		return yield* Schema.decodeEffect(PreferencesApi.Preferences)(updated).pipe(
			Effect.mapError(() =>
				ExperienceInputInvalid.make({
					message:
						"Review companion and project names, colors, pins and conversation assignments.",
				}),
			),
		)
	})
