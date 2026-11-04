import { adminDestination } from "./features/SettingsData.ts"

const destinations: Readonly<Record<string, string>> = {
	requests: "tasks",
	delegations: "tasks",
	executions: "tasks",
	operations: "tasks",
	toolCalls: "tasks",
	codeRuns: "tasks",
	appOperations: "tasks",
	appIndex: "apps",
	appExperience: "connections",
	appViews: "connections",
	appAuthorization: "connections",
	triggers: "automations",
	preferences: "settings",
	profile: "settings",
	appearance: "settings",
	channelLinks: "channels",
	memberSettings: "organization",
}
/** Old deep links lead to the user workflow for their resource, never to an API explorer. */
export const featureDestination = (id: string): string => destinations[id] ?? id

/** The console owns its current section; its outer title stays valid on Overview. */
export const featureTitleKey = (id: string): string =>
	id === "admin" ||
	id.startsWith("admin:") ||
	adminDestination(featureDestination(id)) !== undefined
		? "admin"
		: id.startsWith("settings:")
			? "settings"
			: id
