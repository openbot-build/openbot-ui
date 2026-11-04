import { t } from "@lingui/core/macro"
import { words } from "./SchemaValues"
import { featureTitleKey } from "../FeatureDestinations"

export const groupLabel = (id: string): string => {
	const labels: Record<string, string> = {
		tasks: t`Tasks and approvals`,
		requests: t`Approvals`,
		delegations: t`Delegated tasks`,
		toolCalls: t`Operations`,
		appOperations: t`App operations`,
		codeRuns: t`Code runs`,
		chats: t`Plans and to-dos`,
		files: t`Files`,
		apps: t`App Square`,
		appIndex: t`Discover apps`,
		connections: t`Connected apps`,
		appAuthorization: t`App authorization`,
		appExperience: t`Import and export`,
		appViews: t`App views`,
		automations: t`Automations`,
		triggers: t`Automations`,
		channels: t`Channels`,
		channelLinks: t`Linked accounts`,
		devices: t`Devices`,
		computers: t`Computers`,
		computerProviders: t`Computer providers`,
		live: t`Voice conversation`,
		settings: t`Settings`,
		membership: "Treasure",
		memory: t`Memory`,
		admin: t`Administrator console`,
		bots: "Kay Bot",
		botInvitations: "Kay Bot",
		memberSettings: t`Your preferences`,
		modelProviders: t`Models`,
		usage: t`Usage`,
		budgets: t`Budgets`,
		vaults: t`Vaults`,
		secretProviders: t`Secret providers`,
		organizations: t`Your organizations`,
		organization: t`Organization`,
		sso: t`Single sign-on`,
		userTokens: t`API keys`,
		platform: t`Platform settings`,
		developer: t`Developer tools`,
	}
	return labels[featureTitleKey(id)] ?? words(id)
}
