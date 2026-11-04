import type { ViewState } from "./Model.ts"
import {
	adminSections,
	personalSettingsSections,
	personalSettingsRoute,
} from "./features/SettingsData.ts"

/** Routes contain resource identities only; forms and credentials never enter a URL. */
export const featureIds = new Set([
	"tasks",
	"requests",
	"delegations",
	"operations",
	"appOperations",
	"codeRuns",
	"chats",
	"files",
	"apps",
	"appIndex",
	"connections",
	"appAuthorization",
	"appExperience",
	"appViews",
	"automations",
	"triggers",
	"channels",
	"channelLinks",
	"devices",
	"computers",
	"computerProviders",
	"live",
	"settings",
	...personalSettingsSections.map(personalSettingsRoute),
	"memory",
	"admin",
	...adminSections.map((section) => `admin:${section}`),
	"bots",
	"botInvitations",
	"modelProviders",
	"usage",
	"budgets",
	"vaults",
	"secretProviders",
	"organizations",
	"organization",
	"sso",
	"userTokens",
	"platform",
	"developer",
])

export interface RouteSearch {
	readonly chat?: string
	readonly feature?: string
	readonly new?: true
	readonly bot?: string
	readonly authorization?: string
	readonly developerTest?: string
	readonly sourceChat?: string
}

const identity = (value: unknown): string | undefined =>
	typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value)
		? value
		: undefined

export const routeSearch = (value: Record<string, unknown>): RouteSearch => {
	const authorization = identity(value["authorization"])
	if (authorization !== undefined) return { feature: "apps", authorization }
	const developerTest = identity(value["developerTest"])
	if (developerTest !== undefined)
		return { feature: "developer", developerTest }
	const chat = identity(value["chat"])
	if (chat !== undefined) return { chat }
	const feature = value["feature"]
	if (typeof feature === "string" && featureIds.has(feature)) {
		const sourceChat =
			feature === "automations" || feature === "files"
				? identity(value["sourceChat"])
				: undefined
		return { feature, ...(sourceChat === undefined ? {} : { sourceChat }) }
	}
	const bot = identity(value["bot"])
	if (value["new"] === true || value["new"] === "true" || bot !== undefined)
		return { new: true, ...(bot === undefined ? {} : { bot }) }
	return {}
}

export const searchFromView = (view: ViewState): RouteSearch => {
	switch (view.destination.kind) {
		case "conversation":
			return { chat: view.destination.id }
		case "feature":
			return featureIds.has(view.destination.id)
				? {
						feature: view.destination.id,
						...((view.destination.id === "automations" ||
							view.destination.id === "files") &&
						view.destination.conversationId !== undefined
							? { sourceChat: view.destination.conversationId }
							: {}),
					}
				: {}
		case "new":
			return {
				new: true,
				...(view.companionId === "kay" ? {} : { bot: view.companionId }),
			}
		default:
			return {}
	}
}
