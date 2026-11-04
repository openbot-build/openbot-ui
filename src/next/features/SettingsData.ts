import { Schema } from "effect"
import type { FeatureInput, FeatureOperation } from "./FeatureData.ts"
import { objectOf } from "./SchemaValues.ts"

export const personalSettingsSections = [
	"general",
	"membership",
	"memory",
	"connections",
	"data",
] as const
export type PersonalSettingsSection = (typeof personalSettingsSections)[number]

export const personalSettingsRoute = (
	section: PersonalSettingsSection,
): string =>
	section === "general"
		? "settings"
		: section === "membership"
			? "membership"
			: section === "memory"
				? "memory"
				: `settings:${section}`

export const personalSettingsDestination = (
	id: string,
): PersonalSettingsSection | undefined =>
	personalSettingsSections.find(
		(section) => personalSettingsRoute(section) === id,
	)

export const adminSections = [
	"feedback",
	"defaults",
	"models",
	"computers",
	"credentials",
	"people",
	"memberships",
	"limits",
	"channels",
	"integrations",
	"audit",
] as const
export type AdminSection = (typeof adminSections)[number]

export const adminRoute = (section: AdminSection | null): string =>
	section === null ? "admin" : `admin:${section}`

const administrationGroups: Readonly<Record<string, AdminSection>> = {
	modelProviders: "models",
	computerProviders: "computers",
	secretProviders: "credentials",
	vaults: "credentials",
	organizations: "people",
	organization: "people",
	sso: "people",
	budgets: "limits",
	usage: "limits",
	channels: "channels",
	userTokens: "integrations",
	platform: "defaults",
}

/** This groups permitted controls for display. The API owns authorization. */
export const adminSectionFor = (
	operation: Pick<FeatureOperation, "id" | "group">,
): AdminSection | undefined => {
	if (operation.group === "platform") {
		if (/Model/.test(operation.id)) return "models"
		if (/Credits/.test(operation.id)) return "limits"
		if (/Admin|Organization/.test(operation.id)) return "people"
	}
	if (operation.group === "organization") {
		if (/Audit/.test(operation.id)) return "audit"
		if (/Settings/.test(operation.id)) return "defaults"
	}
	return administrationGroups[operation.group]
}

export const adminDestination = (id: string): AdminSection | undefined =>
	adminSections.find((section) => id === `admin:${section}`) ??
	administrationGroups[id]

export const canOpenAdmin = (
	access: { readonly adminConsole: boolean } | undefined,
): boolean => access?.adminConsole === true

export const memoryOperations = new Set([
	"bots.botMemory",
	"bots.updateBotMemory",
])

export const MemoryEntry = Schema.Struct({
	id: Schema.String,
	content: Schema.String,
	status: Schema.Literals(["active", "retracted"]),
})
export type MemoryEntry = typeof MemoryEntry.Type
export const MemoryPage = Schema.Struct({
	entries: Schema.Array(MemoryEntry),
	version: Schema.Natural,
})

export const personalMemoryInput = ({
	botId,
	command,
}: {
	readonly botId: string
	readonly command:
		| { readonly _tag: "Remember"; readonly content: string }
		| { readonly _tag: "Forget"; readonly id: string }
}) => ({ params: { botId }, payload: { command } })

/** Console-created cloud resources serve the organization unless an admin chooses otherwise. */
export const administrationInput = ({
	operation,
	input,
}: {
	readonly operation: string
	readonly input: FeatureInput
}): FeatureInput => {
	if (operation !== "computerProviders.createComputerProvider") return input
	const payload = objectOf(input.payload)
	return {
		...input,
		payload: {
			...payload,
			shared: payload["shared"] === undefined ? true : payload["shared"],
		},
	}
}
