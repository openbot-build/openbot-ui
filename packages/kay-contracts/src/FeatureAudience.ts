/** Product visibility does not replace native resource authorization. */
export const administrationGroups: ReadonlyArray<string> = [
	"platform",
	"modelProviders",
	"computerProviders",
	"secretProviders",
	"vaults",
	"organization",
	"organizations",
	"sso",
	"budgets",
	"usage",
	"channels",
	"memberSettings",
]

const personalGroups: ReadonlyArray<string> = [
	"apps",
	"appIndex",
	"appAuthorization",
	"connections",
	"appExperience",
	"appViews",
	"appOperations",
	"chats",
	"files",
	"requests",
	"triggers",
	"delegations",
	"operations",
	"executions",
	"toolCalls",
	"codeRuns",
	"live",
	"computers",
	"channelLinks",
	"userTokens",
	"developer",
	"botInvitations",
]

const personalOperations: ReadonlyArray<string> = [
	"bots.listBots",
	"bots.getBot",
	"bots.botMemory",
	"bots.updateBotMemory",
	"bots.botMemoryLog",
	"bots.purgeBotMemory",
	"bots.listGrants",
	"bots.revokeGrant",
	"organization.getCapabilities",
	"organizations.listMyInvitations",
	"organizations.acceptInvitation",
	"organizations.declineInvitation",
	"organizations.leaveOrganization",
	"modelProviders.getModelCatalog",
]

/** New native groups remain in administration until their user workflow is defined. */
export const isAdministrationOperation = (operation: {
	readonly id: string
	readonly group: string
}): boolean =>
	!personalGroups.includes(operation.group) &&
	!personalOperations.includes(operation.id)
