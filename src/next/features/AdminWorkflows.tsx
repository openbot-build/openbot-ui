import { writeClipboard } from "../../lib/runtime"
import { t } from "@lingui/core/macro"
import type * as Product from "@kaicom/kay-contracts"
import type { Client } from "@kaicom/kay-contracts/Client"
import { Match } from "effect"
import { useEffect, useRef, useState } from "react"
import {
	ArrowLeft,
	Check,
	ChevronRight,
	Copy,
	Pencil,
	Plus,
	RefreshCw,
	Search,
	Settings2,
	Trash2,
} from "lucide-react"
import { Button } from "../../components/ui/button"
import { AdminFields } from "./AdminFields"
import { AdminVault } from "./AdminVault"
import { AdminPrices } from "./AdminPrices"
import {
	adminDraft,
	adminModelChoices,
	adminPayload,
	adminRecordKey,
	adminRecordName,
	displayDate,
	formatMoney,
	readPath,
	type AdminChoice,
	type AdminField,
} from "./AdminData"
import { rowsOf } from "./FeatureData"
import { objectOf, type JsonObject } from "./SchemaValues"
import type { AdminSection } from "./SettingsData"
import { useWorkspaceWorkflow, WorkflowNotice } from "./Workflow"

type References = Readonly<Record<string, ReadonlyArray<JsonObject>>>
interface Context {
	readonly previous: JsonObject | null
	readonly draft: JsonObject
	readonly refs: References
	readonly bootstrap: Product.Bootstrap
}
interface Resource {
	readonly id: string
	readonly title: string
	readonly description: string
	readonly empty: string
	readonly list: string
	readonly create?: string
	readonly createLabel?: string
	readonly update?: string
	readonly remove?: string
	readonly param?: string
	readonly single?: boolean
	readonly fields: (context: Context) => ReadonlyArray<AdminField>
	readonly defaults?: (context: Context) => JsonObject
	readonly query?: JsonObject
	readonly command?: boolean
}

const choices = (
	values: ReadonlyArray<readonly [string, unknown]>,
): ReadonlyArray<AdminChoice> =>
	values.map(([label, value]) => ({ label, value }))
const pick = (
	path: string,
	label: string,
	values: ReadonlyArray<AdminChoice>,
	extra: Partial<AdminField> = {},
): AdminField => ({ path, label, type: "choice", choices: values, ...extra })
const text = (
	path: string,
	label: string,
	extra: Partial<AdminField> = {},
): AdminField => ({ path, label, ...extra })
const number = (
	path: string,
	label: string,
	extra: Partial<AdminField> = {},
): AdminField => ({
	path,
	label,
	type: "number",
	min: 0,
	integer: true,
	...extra,
})
const secret = (path: string, context: Context): AdminField => ({
	path,
	label: t`API key`,
	type: "password",
	required: context.previous === null,
})
const names = (
	records: ReadonlyArray<JsonObject>,
	value: (record: JsonObject) => unknown = adminRecordKey,
): ReadonlyArray<AdminChoice> =>
	records.map((record) => ({
		label: adminRecordName(record, t`Unnamed resource`),
		value: value(record),
	}))
const accessFields = (context: Context): ReadonlyArray<AdminField> => [
	pick(
		"availability._tag",
		t`Who can use this service?`,
		choices([
			[t`All organizations`, "All"],
			[t`Selected organizations`, "Selected"],
			[t`Keep unavailable`, "None"],
		]),
		{ defaultValue: "None", required: true },
	),
	...(context.draft["availability._tag"] === "Selected"
		? [
				{
					path: "availability.organizations",
					label: t`Organizations with access`,
					type: "multiple" as const,
					choices: names(context.refs["organizations"] ?? []),
					required: true,
				},
			]
		: []),
]

const modelFields = (
	context: Context,
	platform: boolean,
): ReadonlyArray<AdminField> => [
	text("name", t`Display name`, { required: true }),
	text("id", t`Model name from the provider`, {
		required: true,
		createOnly: true,
		hint: t`Use the model name shown by your model service, for example gpt-5.`,
	}),
	pick(
		"type",
		t`What does this model do?`,
		choices([
			[t`Text and tools`, "language"],
			[t`Realtime voice`, "live"],
			[t`Policy decisions`, "decision"],
		]),
		{ createOnly: true, defaultValue: "language" },
	),
	number("contextWindow", t`Context window (tokens)`, {
		min: 1,
		nullable: true,
	}),
	number("maxOutputTokens", t`Maximum response (tokens)`, {
		min: 1,
		nullable: true,
	}),
	text("reasoningEfforts", t`Reasoning levels`, {
		type: "lines",
		defaultValue: [],
		hint: t`One value per line. Leave empty if the model does not offer this choice.`,
	}),
	text("serviceTiers", t`Service tiers`, { type: "lines", defaultValue: [] }),
	...(platform ? accessFields(context) : []),
]

const modelProviderFields = (
	context: Context,
	platform: boolean,
): ReadonlyArray<AdminField> => {
	const links = Array.isArray(context.previous?.["models"])
		? context.previous["models"]
		: []
	const available = [
		...(context.refs["platformModels"] ?? []),
		...(platform ? [] : (context.refs["models"] ?? [])),
	]
	return [
		text("name", t`Service name`, { required: true }),
		pick(
			"kind",
			t`Service type`,
			choices([
				["OpenAI", "openai"],
				["Anthropic", "anthropic"],
				[t`OpenAI-compatible service`, "openai-compat"],
				["TypeSafe", "typesafe"],
			]),
			{
				defaultValue: "openai",
				required: context.previous === null,
				createOnly: true,
			},
		),
		text("endpoint", t`Service address`, {
			type: "url",
			nullable: true,
			hint: t`Leave empty to use the provider's standard address.`,
		}),
		secret("apiKey", context),
		{
			path: "models",
			label: t`Models available through this account`,
			type: "multiple",
			defaultValue: [],
			choices: names(
				available,
				(model) =>
					links.find(
						(link) =>
							objectOf(link)["model"] === model["id"] &&
							objectOf(link)["modelOwner"] === model["owner"],
					) ?? { model: model["id"], modelOwner: model["owner"] },
			),
		},
		...(platform ? accessFields(context) : []),
	]
}

const providerFields = (
	context: Context,
	category: "computer" | "secret",
): ReadonlyArray<AdminField> => {
	const kind = String(
		context.draft["credentials.kind"] ??
			readPath(context.previous, "credentials.kind") ??
			(category === "computer" ? "e2b" : "onepassword"),
	)
	return [
		text("name", t`Service name`, { required: true }),
		pick(
			"credentials.kind",
			t`Service type`,
			category === "computer"
				? choices([
						[t`E2B-compatible service`, "e2b"],
						["Daytona", "daytona"],
					])
				: choices([
						["1Password Connect", "onepassword"],
						["Bitwarden / Vaultwarden", "bitwarden"],
						["HashiCorp Vault / OpenBao", "hashicorp"],
					]),
			{
				createOnly: true,
				required: context.previous === null,
				defaultValue: category === "computer" ? "e2b" : "onepassword",
			},
		),
		text(
			category === "computer" ? "credentials.apiUrl" : "credentials.url",
			t`Service address`,
			{
				type: "url",
				blank: "omit",
				required: category === "secret",
				hint:
					category === "computer"
						? t`Leave empty for the hosted provider. A self-hosted service needs its address.`
						: undefined,
			},
		),
		{
			...secret(
				category === "computer" ? "credentials.apiKey" : "credentials.token",
				context,
			),
			label: category === "computer" ? t`API key` : t`Access token`,
			required:
				context.previous === null &&
				(category === "computer" || kind !== "bitwarden"),
		},
		...(kind === "e2b"
			? [
					text("credentials.sandboxDomain", t`Workspace domain`, {
						blank: "omit",
						hint: t`Only needed for a self-hosted E2B-compatible service.`,
					}),
				]
			: []),
		...(kind === "daytona"
			? [
					text("credentials.target", t`Region`, {
						blank: "omit",
						hint: t`For example us or eu. Leave empty for the provider default.`,
					}),
				]
			: []),
		...(kind === "hashicorp"
			? [
					text("credentials.mount", t`Secret engine`, {
						blank: "omit",
						defaultValue: "secret",
					}),
					text("credentials.namespace", t`Enterprise namespace`, {
						blank: "omit",
					}),
				]
			: []),
		text("shared", t`Available to organization members`, {
			type: "boolean",
			defaultValue: true,
			createOnly: true,
		}),
	]
}

const channelFields = (context: Context): ReadonlyArray<AdminField> => {
	const kind = String(
		context.draft["credentials.kind"] ??
			readPath(context.previous, "credentials.kind") ??
			"telegram",
	)
	const credentials = Match.value(kind).pipe(
		Match.when("slack", () => [
			text("credentials.botToken", t`Bot token`, {
				type: "password",
				required: context.previous === null,
			}),
			text("credentials.signingSecret", t`Signing secret`, {
				type: "password",
				required: context.previous === null,
			}),
		]),
		Match.when("lark", () => [
			pick(
				"credentials.domain",
				t`Service region`,
				choices([
					["Lark", "lark"],
					[t`Feishu`, "feishu"],
				]),
				{ defaultValue: "lark" },
			),
			text("credentials.appId", t`App ID`, { required: true }),
			...[
				["appSecret", t`App secret`],
				["verificationToken", t`Verification token`],
				["encryptKey", t`Encryption key`],
			].map(([key, label]) =>
				text("credentials." + key, label!, {
					type: "password",
					required: context.previous === null,
				}),
			),
		]),
		Match.when("custom", () => [
			text("credentials.endpoint", t`Reply address`, {
				type: "url",
				required: true,
			}),
		]),
		Match.orElse(() => [
			text("credentials.botToken", t`Bot token`, {
				type: "password",
				required: context.previous === null,
			}),
		]),
	)
	return [
		text("name", t`Channel name`, { required: true }),
		pick(
			"credentials.kind",
			t`Messaging service`,
			choices([
				["Telegram", "telegram"],
				["Slack", "slack"],
				["Lark / Feishu", "lark"],
				[t`Custom channel`, "custom"],
			]),
			{ defaultValue: "telegram", createOnly: true },
		),
		pick(
			"bot",
			t`Who replies?`,
			names(
				context.bootstrap.companions.map((bot) => ({
					id: bot.id,
					name:
						bot.id === context.bootstrap.defaultBotId ? "Kay Bot" : bot.name,
				})),
			),
			{ required: true, defaultValue: context.bootstrap.defaultBotId },
		),
		...credentials,
		text("enabled", t`Accept incoming messages`, {
			type: "boolean",
			defaultValue: false,
		}),
		text("linkPath", t`Account linking page`, {
			hint: t`A path on this site, such as /link. Leave empty to show a linking code.`,
		}),
	]
}

function resources(
	section: Exclude<AdminSection, "feedback" | "memberships">,
): ReadonlyArray<Resource> {
	const model = (platform: boolean): Resource => ({
		id: platform ? "platform-models" : "models",
		title: platform ? t`Shared models` : t`Organization models`,
		description: t`Add the models people can choose. Then connect them to a provider account.`,
		empty: t`No models have been added yet.`,
		list: platform
			? "platform.listPlatformModels"
			: "modelProviders.listModels",
		create: platform
			? "platform.createPlatformModel"
			: "modelProviders.createModel",
		update: platform
			? "platform.updatePlatformModel"
			: "modelProviders.updateModel",
		remove: platform
			? "platform.deletePlatformModel"
			: "modelProviders.deleteModel",
		param: "modelId",
		createLabel: t`Add model`,
		fields: (context) => modelFields(context, platform),
	})
	const provider = (platform: boolean): Resource => ({
		id: platform ? "platform-providers" : "providers",
		title: platform
			? t`Shared provider accounts`
			: t`Organization provider accounts`,
		description: platform
			? t`The platform pays for these services. Choose which organizations may use them.`
			: t`These services use your organization's own provider account.`,
		empty: t`Connect a provider account to make models available.`,
		list: platform
			? "platform.listPlatformModelProviders"
			: "modelProviders.listModelProviders",
		create: platform
			? "platform.createPlatformModelProvider"
			: "modelProviders.createModelProvider",
		update: platform
			? "platform.updatePlatformModelProvider"
			: "modelProviders.updateModelProvider",
		remove: platform
			? "platform.deletePlatformModelProvider"
			: "modelProviders.deleteModelProvider",
		param: "providerId",
		createLabel: t`Connect provider`,
		fields: (context) => modelProviderFields(context, platform),
	})
	return Match.value(section).pipe(
		Match.when("models", () => [
			model(true),
			provider(true),
			model(false),
			provider(false),
		]),
		Match.when("computers", () => [
			{
				id: "computer-providers",
				title: t`Cloud computer services`,
				description: t`Connect cloud computer services for your team. Manage access to each computer in its workspace.`,
				empty: t`No cloud computer service is connected. Connect E2B or Daytona when an account is ready.`,
				list: "computerProviders.listComputerProviders",
				create: "computerProviders.createComputerProvider",
				update: "computerProviders.updateComputerProvider",
				remove: "computerProviders.deleteComputerProvider",
				param: "providerId",
				createLabel: t`Connect computer service`,
				fields: (context: Context) => providerFields(context, "computer"),
			},
		]),
		Match.when("credentials", () => [
			{
				id: "vaults",
				title: t`Vaults`,
				description: t`Keep service credentials together and choose which work can use them. Secret values never appear in lists.`,
				empty: t`Create a vault for the credentials your work needs.`,
				list: "vaults.listVaults",
				create: "vaults.createVault",
				update: "vaults.updateVault",
				remove: "vaults.deleteVault",
				param: "vaultId",
				createLabel: t`Create vault`,
				fields: () => [
					text("name", t`Vault name`, { required: true }),
					text("shared", t`Available to organization members`, {
						type: "boolean",
						createOnly: true,
						defaultValue: true,
					}),
				],
			},
			{
				id: "secret-providers",
				title: t`Connected secret services`,
				description: t`Use an existing password manager or secret service without copying credentials into chat.`,
				empty: t`No secret service is connected.`,
				list: "secretProviders.listSecretProviders",
				create: "secretProviders.createSecretProvider",
				update: "secretProviders.updateSecretProvider",
				remove: "secretProviders.deleteSecretProvider",
				param: "providerId",
				createLabel: t`Connect secret service`,
				fields: (context: Context) => providerFields(context, "secret"),
			},
		]),
		Match.when("people", () => [
			{
				id: "domains",
				title: t`Email domains`,
				description: t`Verify the domains your organization owns before using them for organization sign-in.`,
				empty: t`No email domains have been added.`,
				list: "sso.listDomains",
				create: "sso.addDomain",
				remove: "sso.removeDomain",
				param: "domain",
				createLabel: t`Add email domain`,
				fields: () => [
					text("domain", t`Email domain`, {
						required: true,
						hint: t`Enter the part after @, for example company.com.`,
					}),
				],
			},
			{
				id: "sso",
				title: t`Organization sign-in`,
				description: t`Connect your identity service for people with verified organization email addresses.`,
				empty: t`No organization sign-in service is connected.`,
				list: "sso.listSsoConnections",
				create: "sso.createSsoConnection",
				update: "sso.updateSsoConnection",
				remove: "sso.deleteSsoConnection",
				param: "connectionId",
				createLabel: t`Connect sign-in service`,
				fields: (context: Context) => [
					text("name", t`Service name`, { required: true }),
					text("issuer", t`Identity provider address`, {
						type: "url",
						required: true,
					}),
					text("clientId", t`Application client ID`, { required: true }),
					text("clientSecret", t`Application secret`, { type: "password" }),
					{
						path: "domains",
						label: t`Verified email domains`,
						type: "multiple" as const,
						required: true,
						choices: names(
							(context.refs["domains"] ?? []).filter(
								(domain) => domain["verifiedAt"] !== null,
							),
							(domain) => domain["domain"],
						),
					},
					text("enforce", t`Require this sign-in method for these domains`, {
						type: "boolean",
						defaultValue: false,
						hint: t`When enabled, people with these email domains must use this service instead of the platform sign-in.`,
					}),
				],
			},
			{
				id: "roles",
				title: t`Roles and permissions`,
				description: t`Give a role a clear name and reuse an existing access level. Built-in roles remain read-only.`,
				empty: t`No roles are available.`,
				list: "organization.listRoles",
				create: "organization.createRole",
				update: "organization.updateRole",
				remove: "organization.deleteRole",
				param: "roleId",
				createLabel: t`Create role`,
				fields: (context: Context) => [
					text("name", t`Role name`, { required: true }),
					text("description", t`What is this role for?`, { defaultValue: "" }),
					pick(
						"policy",
						t`Use permissions from`,
						names(context.refs["roles"] ?? [], (role) => role["policy"]),
						{
							required: true,
							hint: t`Members receive the selected access. You cannot grant permissions you do not have.`,
						},
					),
				],
			},
			{
				id: "members",
				title: t`Members`,
				description: t`Choose a person to manage their role or pause their access.`,
				empty: t`No members match this view.`,
				list: "organization.listMembers",
				update: "organization.updateMember",
				remove: "organization.removeMember",
				param: "userId",
				query: { limit: 100 },
				fields: (context: Context) => [
					text("name", t`Name`, { readOnly: true }),
					text("email", t`Email`, { readOnly: true }),
					pick(
						"status",
						t`Account access`,
						choices([
							[t`Active`, "active"],
							[t`Suspended`, "suspended"],
						]),
					),
					{
						path: "roles",
						label: t`Roles`,
						type: "multiple" as const,
						choices: names(context.refs["roles"] ?? []),
						required: true,
					},
				],
			},
			{
				id: "invitations",
				title: t`Invitations`,
				description: t`Invite a person by email and choose the access they will receive.`,
				empty: t`There are no pending invitations.`,
				list: "organization.listInvitations",
				create: "organization.createInvitation",
				remove: "organization.revokeInvitation",
				param: "invitationId",
				createLabel: t`Invite member`,
				fields: (context: Context) => [
					text("email", t`Email address`, { type: "email", required: true }),
					{
						path: "roles",
						label: t`Roles`,
						type: "multiple" as const,
						choices: names(context.refs["roles"] ?? []),
						hint: t`Leave empty to use the organization's default roles.`,
					},
				],
			},
			{
				id: "organizations",
				title: t`Organizations`,
				description: t`Review each organization and control whether its members can use the platform.`,
				empty: t`No organizations are available.`,
				list: "platform.listPlatformOrganizations",
				update: "platform.updatePlatformOrganization",
				param: "organizationId",
				fields: () => [
					text("name", t`Organization name`, { readOnly: true }),
					pick(
						"status",
						t`Organization access`,
						choices([
							[t`Active`, "active"],
							[t`Suspended`, "suspended"],
						]),
					),
				],
			},
			{
				id: "admins",
				title: t`Platform administrators`,
				description: t`Administrators can manage settings for everyone. Grant this access only to the team operating Kay.`,
				empty: t`No platform administrators are listed.`,
				list: "platform.listPlatformAdmins",
				create: "platform.addPlatformAdmin",
				remove: "platform.removePlatformAdmin",
				param: "email",
				createLabel: t`Add administrator`,
				fields: () => [
					text("email", t`Verified email address`, {
						required: true,
						type: "email",
					}),
				],
			},
		]),
		Match.when("limits", () => [
			{
				id: "usage",
				title: t`This month's usage`,
				description: t`Model calls and estimated cost for the current month. Unconfirmed usage remains separate.`,
				empty: t`No model usage has been recorded this month.`,
				list: "usage.getUsage",
				query: { groupBy: "model" },
				fields: () => [],
			},
			{
				id: "budgets",
				title: t`Spending limits`,
				description: t`Set a daily or monthly limit. Choose whether reaching it stops new model calls or only records a warning.`,
				empty: t`No spending limits are set.`,
				list: "budgets.listBudgets",
				create: "budgets.createBudget",
				update: "budgets.updateBudget",
				remove: "budgets.deleteBudget",
				param: "budgetId",
				createLabel: t`Set spending limit`,
				fields: (context: Context) => [
					pick(
						"scope",
						t`Who is this limit for?`,
						choices([
							[t`Entire organization`, "organization"],
							[t`A member`, "member"],
							["Kay Bot", "bot"],
							[t`An integration`, "token"],
						]),
						{ defaultValue: "organization", createOnly: true },
					),
					...(context.previous === null &&
					context.draft["scope"] !== undefined &&
					context.draft["scope"] !== "organization"
						? [
								pick(
									"scopeId",
									t`Apply to`,
									names(
										context.draft["scope"] === "member"
											? (context.refs["members"] ?? [])
											: context.draft["scope"] === "token"
												? (context.refs["tokens"] ?? [])
												: context.bootstrap.companions.map((bot) => ({
														id: bot.id,
														name:
															bot.id === context.bootstrap.defaultBotId
																? "Kay Bot"
																: bot.name,
													})),
									),
									{ required: true },
								),
							]
						: []),
					pick(
						"period",
						t`Reset limit`,
						choices([
							[t`Every day (UTC)`, "day"],
							[t`Every month (UTC)`, "month"],
						]),
						{ defaultValue: "month", createOnly: true },
					),
					number("limitMicros", t`Limit (USD)`, {
						required: true,
						scale: 1_000_000,
					}),
					pick(
						"mode",
						t`When the limit is reached`,
						choices([
							[t`Stop new model calls`, "hard"],
							[t`Record a warning and continue`, "soft"],
						]),
						{ defaultValue: "hard", required: true },
					),
				],
			},
		]),
		Match.when("channels", () => [
			{
				id: "channels",
				title: t`Connected messaging services`,
				description: t`Choose where people can talk with Kay. New channels start paused until you enable them.`,
				empty: t`Connect a messaging service to make Kay available there.`,
				list: "channels.listChannels",
				create: "channels.createChannel",
				update: "channels.updateChannel",
				remove: "channels.deleteChannel",
				param: "channelId",
				createLabel: t`Connect channel`,
				command: true,
				fields: channelFields,
			},
		]),
		Match.when("integrations", () => [
			{
				id: "tokens",
				title: t`Integration access tokens`,
				description: t`Tokens use your current account permissions. Limit their lifetime and revoke them when an integration is no longer needed.`,
				empty: t`No access tokens are active.`,
				list: "userTokens.listTokens",
				create: "userTokens.createToken",
				remove: "userTokens.revokeToken",
				param: "tokenId",
				createLabel: t`Create access token`,
				fields: (context: Context) => [
					text("name", t`Integration name`, { required: true }),
					number("expiresInDays", t`Expires after (days)`, {
						min: 1,
						max: 365,
						defaultValue: 30,
						required: true,
					}),
					pick(
						"policy",
						t`Limit access to a role`,
						names(context.refs["roles"] ?? [], (role) => role["policy"]),
						{
							hint: t`Leave unset to use your current access, except token management.`,
						},
					),
				],
			},
		]),
		Match.when("audit", () => [
			{
				id: "audit",
				title: t`Recent activity`,
				description: t`See who changed a service or an account, and when.`,
				empty: t`There is no activity to show.`,
				list: "organization.listAuditLogs",
				query: { limit: 100 },
				fields: () => [],
			},
		]),
		Match.when("defaults", () => defaultResources()),
		Match.exhaustive,
	)
}

function defaultResources(): ReadonlyArray<Resource> {
	const organization = (
		id: string,
		title: string,
		description: string,
		fields: Resource["fields"],
	): Resource => ({
		id,
		title,
		description,
		empty: t`Settings are not available.`,
		list: "organization.getSettings",
		update: "organization.updateSettings",
		single: true,
		fields,
	})
	const platform = (
		id: string,
		title: string,
		description: string,
		fields: Resource["fields"],
	): Resource => ({
		id,
		title,
		description,
		empty: t`Settings are not available.`,
		list: "platform.getPlatformSettings",
		update: "platform.updatePlatformSettings",
		single: true,
		fields,
	})
	return [
		organization(
			"conversation-defaults",
			t`Conversations and memory`,
			t`Choose the models and memory behavior used when a conversation has no custom settings.`,
			(context) => {
				const models = context.refs["catalogModels"] ?? []
				const choicesFor = (
					field: string,
					purpose: "chat" | "rules" | "memory",
				) =>
					adminModelChoices({
						models,
						selected: context.previous?.[field],
						purpose,
					})
				return [
					pick(
						"chatModel",
						t`Default conversation model`,
						choicesFor("chatModel", "chat"),
						{
							nullable: true,
						},
					),
					pick(
						"rulesModel",
						t`Permission decision model`,
						choicesFor("rulesModel", "rules"),
						{
							nullable: true,
						},
					),
					pick(
						"botMemoryModel",
						t`Memory model`,
						choicesFor("botMemoryModel", "memory"),
						{
							nullable: true,
						},
					),
					text("botMemory", t`Learn from conversations`, { type: "boolean" }),
				]
			},
		),
		organization(
			"task-defaults",
			t`Tasks and approvals`,
			t`Set how long work may run and how plans receive approval.`,
			() => [
				number("requestTimeoutMs", t`Approval wait (minutes)`, {
					scale: 60_000,
					min: 1 / 60,
				}),
				number("delegationTimeLimitMs", t`Task time limit (minutes)`, {
					scale: 60_000,
					min: 1,
				}),
				number("toolMaxDurationMs", t`Tool time limit (minutes)`, {
					scale: 60_000,
					min: 1 / 60,
				}),
				number("maxBackgroundOperations", t`Background tools per conversation`),
				pick(
					"planApproval.approver",
					t`Who approves a plan?`,
					choices([
						[t`The person requesting the work`, "person"],
						[t`The assigned decision chain`, "chain"],
					]),
				),
				pick(
					"planApproval.onTimeout",
					t`When no one answers`,
					choices([
						[t`Keep waiting for a decision`, "stay"],
						[t`Continue with the plan`, "run"],
					]),
				),
				number("planApproval.timeoutMs", t`Plan approval wait (hours)`, {
					scale: 3_600_000,
					min: 1 / 3600,
				}),
			],
		),
		platform(
			"code-settings",
			t`Basic code tasks`,
			t`Control the built-in JavaScript environment. It is separate from cloud computers.`,
			() => [
				text("codeMode.enabled", t`Enable basic code tasks`, {
					type: "boolean",
				}),
				number("codeMode.timeoutMs", t`Time limit (seconds)`, {
					scale: 1000,
					min: 0.1,
					max: 600,
				}),
				number("codeMode.memoryMb", t`Memory limit (MB)`, {
					min: 8,
					max: 1024,
				}),
				number("codeMode.outputBytes", t`Maximum result size (KiB)`, {
					scale: 1024,
					min: 1,
					max: 4096,
				}),
			],
		),
		platform(
			"file-settings",
			t`Files and uploads`,
			t`Choose upload limits and how long unused files are kept. Existing storage credentials are retained.`,
			() => [
				text("files.uploads.server", t`Allow uploads through Kay`, {
					type: "boolean",
				}),
				text("files.uploads.direct", t`Allow direct uploads to storage`, {
					type: "boolean",
				}),
				number("files.maxBytes", t`Maximum file size (MiB)`, {
					scale: 1024 ** 2,
					min: 1 / 1024 ** 2,
				}),
				number("files.quotaBytes", t`Storage per member (GiB)`, {
					scale: 1024 ** 3,
					nullable: true,
				}),
				number("files.unusedMs", t`Keep unused files for (days)`, {
					scale: 86_400_000,
					min: 1 / 1440,
					max: 365,
				}),
				text("files.mediaTypes", t`Allowed file types`, {
					type: "lines",
					hint: t`One media type per line, for example image/* or application/pdf.`,
				}),
			],
		),
		platform(
			"sign-in-settings",
			t`Sign-in service`,
			t`Review the identity provider used by everyone. Changing the public address signs people out.`,
			() => [
				text("publicOrigin", t`Public service address`, {
					type: "url",
					required: true,
				}),
				text("identityProvider.issuer", t`Identity provider address`, {
					type: "url",
				}),
				text("identityProvider.clientId", t`Application client ID`),
				text("identityProvider.clientSecret", t`Application secret`, {
					type: "password",
				}),
				text("identityProvider.scopes", t`Requested sign-in permissions`, {
					type: "lines",
				}),
				pick(
					"organizationCreation",
					t`Who may create organizations?`,
					choices([
						[t`Platform administrators`, "platform_admins"],
						[t`Anyone who can sign in`, "anyone"],
					]),
				),
			],
		),
	]
}

const referenceSources = [
	["domains", "sso.listDomains"],
	["models", "modelProviders.listModels"],
	["platformModels", "platform.listPlatformModels"],
	["roles", "organization.listRoles"],
	["members", "organization.listMembers"],
	["organizations", "platform.listPlatformOrganizations"],
	["tokens", "userTokens.listTokens"],
	["catalogModels", "modelProviders.getModelCatalog"],
] as const

function recordCaption(record: JsonObject): string {
	if (typeof record["email"] === "string") return record["email"]
	if (typeof record["endpoint"] === "string") return record["endpoint"]
	if (typeof record["kind"] === "string") return record["kind"]
	if (typeof record["description"] === "string") return record["description"]
	return ""
}

function statusLabel(record: JsonObject): string {
	if (record["enabled"] === true) return t`Enabled`
	if (record["enabled"] === false) return t`Paused`
	if (record["exceeded"] === true) return t`Limit reached`
	return Match.value(record["status"]).pipe(
		Match.when("active", () => t`Active`),
		Match.when("suspended", () => t`Suspended`),
		Match.when("pending", () => t`Pending`),
		Match.when("accepted", () => t`Accepted`),
		Match.when("revoked", () => t`Revoked`),
		Match.when("expired", () => t`Expired`),
		Match.orElse(() => ""),
	)
}

export function AdminWorkflows({
	section,
	client,
	bootstrap,
	onChanged,
}: {
	readonly section: Exclude<AdminSection, "feedback" | "memberships">
	readonly client: Client
	readonly bootstrap: Product.Bootstrap
	readonly onChanged?: (() => void | Promise<void>) | undefined
}) {
	const workflow = useWorkspaceWorkflow({ client, bootstrap })
	const available = resources(section)
		.filter((resource) => workflow.can(resource.list))
		.sort((a, b) =>
			section !== "people"
				? 0
				: [
						"members",
						"invitations",
						"roles",
						"domains",
						"sso",
						"organizations",
						"admins",
					].indexOf(a.id) -
					[
						"members",
						"invitations",
						"roles",
						"domains",
						"sso",
						"organizations",
						"admins",
					].indexOf(b.id),
		)
	const [active, setActive] = useState("")
	const resource =
		available.find((entry) => entry.id === active) ?? available[0]
	const [refs, setRefs] = useState<References>({})
	const [refsVersion, setRefsVersion] = useState(0)
	const [records, setRecords] = useState<ReadonlyArray<JsonObject>>([])
	const [summary, setSummary] = useState<JsonObject>({})
	const [selected, setSelected] = useState<JsonObject | null>(null)
	const [editor, setEditor] = useState<"new" | "edit" | null>(null)
	const [draft, setDraft] = useState<JsonObject>({})
	const [search, setSearch] = useState("")
	const [reading, setReading] = useState(false)
	const [loaded, setLoaded] = useState(false)
	const [loadError, setLoadError] = useState(false)
	const [notice, setNotice] = useState<string | null>(null)
	const [formError, setFormError] = useState<string | null>(null)
	const [confirmRemove, setConfirmRemove] = useState(false)
	const [revealed, setRevealed] = useState<string | null>(null)
	const [next, setNext] = useState<string | null>(null)
	const generation = useRef(0)
	const editorGeneration = useRef(0)
	const view = useRef(resource?.id)
	view.current = resource?.id
	const previous = editor === "new" ? null : selected
	const context = { previous, draft, refs, bootstrap }
	const fields = resource?.fields(context) ?? []
	const refresh = async (signal?: AbortSignal, after?: string) => {
		if (resource === undefined || view.current !== resource.id) return
		const current = ++generation.current
		setReading(true)
		setLoadError(false)
		try {
			const value = await workflow.read(
				resource.list,
				{
					query: {
						...resource.query,
						...(after === undefined ? {} : { after }),
					},
				},
				signal,
			)
			if (
				signal?.aborted === true ||
				current !== generation.current ||
				view.current !== resource.id
			)
				return
			const result = rowsOf(value).map(objectOf)
			setRecords((old) => (after === undefined ? result : [...old, ...result]))
			setSummary(objectOf(value))
			setLoaded(true)
			setNext(
				typeof objectOf(value)["next"] === "string"
					? String(objectOf(value)["next"])
					: null,
			)
			if (resource.single === true) setSelected(objectOf(value))
		} catch {
			if (signal?.aborted !== true && current === generation.current)
				setLoadError(true)
		} finally {
			if (signal?.aborted !== true && current === generation.current)
				setReading(false)
		}
	}
	useEffect(() => {
		if (!workflow.ready) return
		const controller = new AbortController()
		void Promise.allSettled(
			referenceSources
				.filter(([, operation]) => workflow.can(operation))
				.map(async ([key, operation]) => {
					let after: string | undefined
					const seen = new Set<string>()
					const records: JsonObject[] = []
					do {
						const value = await workflow.read(
							operation,
							after === undefined ? {} : { query: { after } },
							controller.signal,
						)
						if (controller.signal.aborted) return
						records.push(
							...rowsOf(
								key === "catalogModels" ? objectOf(value)["models"] : value,
							).map(objectOf),
						)
						const next = objectOf(value)["next"]
						after =
							typeof next === "string" && !seen.has(next) ? next : undefined
						if (after !== undefined) seen.add(after)
					} while (after !== undefined)
					setRefs((old) => ({ ...old, [key]: records }))
				}),
		)
		return () => controller.abort()
	}, [workflow.ready, workflow.can, workflow.read, refsVersion])
	useEffect(() => {
		editorGeneration.current++
		setRecords([])
		setSelected(null)
		setEditor(null)
		setRevealed(null)
		setLoaded(false)
		setNotice(null)
		setSearch("")
		if (!workflow.ready || resource === undefined) return
		const controller = new AbortController()
		void refresh(controller.signal)
		return () => {
			controller.abort()
			generation.current++
		}
	}, [
		workflow.ready,
		resource?.id,
		bootstrap.identity.userId,
		bootstrap.identity.organizationId,
	])
	const edit = (record: JsonObject | null) => {
		if (resource === undefined) return
		editorGeneration.current++
		setSelected(record)
		setEditor(record === null ? "new" : "edit")
		setFormError(null)
		setNotice(null)
		const initial = adminDraft(
			resource.fields({ previous: record, draft: {}, refs, bootstrap }),
			record,
		)
		setDraft(
			adminDraft(
				resource.fields({ previous: record, draft: initial, refs, bootstrap }),
				record,
			),
		)
	}
	const save = async () => {
		if (resource === undefined) return
		const currentEditor = editorGeneration.current
		const currentResource = resource.id
		const operation = previous === null ? resource.create : resource.update
		if (operation === undefined || !workflow.can(operation)) return
		try {
			let payload = adminPayload({
				fields,
				draft,
				previous,
				defaults: resource.defaults?.(context),
			})
			if (
				objectOf(payload["availability"])["_tag"] !== "Selected" &&
				payload["availability"] !== undefined
			)
				payload = {
					...payload,
					availability: { _tag: objectOf(payload["availability"])["_tag"] },
				}
			if (
				resource.id === "invitations" &&
				Array.isArray(payload["roles"]) &&
				payload["roles"].length === 0
			)
				payload = Object.fromEntries(
					Object.entries(payload).filter(([key]) => key !== "roles"),
				)
			if (previous !== null && payload["credentials"] !== undefined) {
				const credentials = objectOf(payload["credentials"])
				const expected =
					resource.id === "computer-providers"
						? ["apiKey"]
						: resource.id === "secret-providers"
							? credentials["kind"] === "bitwarden" &&
								objectOf(readPath(previous, "credentials.token"))["set"] !==
									true
								? []
								: ["token"]
							: resource.id === "channels"
								? Match.value(credentials["kind"]).pipe(
										Match.when("slack", () => ["botToken", "signingSecret"]),
										Match.when("lark", () => [
											"appSecret",
											"verificationToken",
											"encryptKey",
										]),
										Match.when("telegram", () => ["botToken"]),
										Match.orElse(() => []),
									)
								: []
				if (
					expected.some(
						(key) =>
							typeof credentials[key] !== "string" || credentials[key] === "",
					)
				)
					throw new Error(
						t`Enter new credentials to change this connection. To keep the connection unchanged, leave its fields as they were.`,
					)
			}
			if (resource.command === true)
				payload = { ...payload, commandKey: crypto.randomUUID() }
			const params =
				previous === null || resource.param === undefined
					? undefined
					: { [resource.param]: adminRecordKey(previous) }
			const result = objectOf(
				await workflow.call(operation, {
					...(params === undefined ? {} : { params }),
					payload,
				}),
			)
			if (
				view.current !== currentResource ||
				currentEditor !== editorGeneration.current
			)
				return
			setRevealed(
				typeof result["secret"] === "string" ? result["secret"] : null,
			)
			setEditor(null)
			setDraft({})
			setNotice(t`Changes saved.`)
			setRefsVersion((version) => version + 1)
			void onChanged?.()
			await refresh()
			if (
				view.current !== currentResource ||
				currentEditor !== editorGeneration.current
			)
				return
			if (resource.single !== true)
				setSelected(
					resource.id === "domains" || resource.id === "sso" ? result : null,
				)
		} catch (failure) {
			if (
				view.current !== currentResource ||
				currentEditor !== editorGeneration.current
			)
				return
			setFormError(
				failure instanceof Error
					? failure.message
					: t`This request could not be completed.`,
			)
		}
	}
	const remove = async () => {
		if (
			resource?.remove === undefined ||
			resource.param === undefined ||
			selected === null
		)
			return
		const currentResource = resource.id
		const currentEditor = editorGeneration.current
		try {
			await workflow.call(resource.remove, {
				params: { [resource.param]: adminRecordKey(selected) },
				...(resource.command === true
					? { payload: { commandKey: crypto.randomUUID() } }
					: {}),
			})
			if (
				view.current !== currentResource ||
				currentEditor !== editorGeneration.current
			)
				return
			setSelected(null)
			setConfirmRemove(false)
			setNotice(t`Access or resource removed.`)
			setRefsVersion((version) => version + 1)
			void onChanged?.()
			await refresh()
		} catch {
			/* The shared workflow keeps failed and unconfirmed writes visible. */
		}
	}
	if (!workflow.ready)
		return (
			<div
				className="admin-loading"
				role="status"
			>{t`Loading your console…`}</div>
		)
	return (
		<section className="admin-workflows">
			<WorkflowNotice workflow={workflow} />
			{available.length === 0 ? (
				<div className="admin-empty">
					<Settings2 size={30} />
					<h3>{t`No controls are available for this account`}</h3>
					<p>{t`Your permissions may have changed. Personal settings remain available.`}</p>
				</div>
			) : (
				resource !== undefined && (
					<>
						{available.length > 1 && (
							<nav
								className="admin-resource-tabs"
								aria-label={t`Manage resources`}
							>
								{available.map((entry) => (
									<button
										key={entry.id}
										aria-current={entry.id === resource.id ? "page" : undefined}
										onClick={() => setActive(entry.id)}
									>
										{entry.title}
									</button>
								))}
							</nav>
						)}
						<div className="admin-resource-heading">
							<div>
								<h3>{resource.title}</h3>
								<p>{resource.description}</p>
							</div>
							<div className="admin-actions">
								<Button
									variant="ghost"
									aria-label={t`Refresh`}
									disabled={reading}
									onClick={() => void refresh()}
								>
									<RefreshCw size={16} />
								</Button>
								{resource.create !== undefined &&
									workflow.can(resource.create) &&
									editor === null && (
										<Button onClick={() => edit(null)}>
											<Plus size={16} />
											{resource.createLabel ?? t`Add`}
										</Button>
									)}
							</div>
						</div>
						{notice !== null && (
							<p className="admin-success" role="status">
								<Check size={16} />
								{notice}
							</p>
						)}
						{revealed !== null && (
							<div className="admin-secret-once">
								<strong>{t`Copy this token now`}</strong>
								<p>{t`It will not be shown again after you leave this page.`}</p>
								<input
									aria-label={t`New access token`}
									type="password"
									value={revealed}
									readOnly
									autoComplete="off"
								/>
								<Button
									variant="outline"
									onClick={() => void writeClipboard(revealed)}
								>
									<Copy size={15} />
									{t`Copy token`}
								</Button>
								<Button
									variant="ghost"
									onClick={() => setRevealed(null)}
								>{t`Done`}</Button>
							</div>
						)}
						{loadError && (
							<div className="admin-empty" role="alert">
								<p>{t`This information could not be loaded. Try again.`}</p>
								<Button
									variant="outline"
									onClick={() => void refresh()}
								>{t`Try again`}</Button>
							</div>
						)}
						{editor !== null ? (
							<form
								className="admin-editor"
								onSubmit={(event) => {
									event.preventDefault()
									void save()
								}}
							>
								<div className="admin-detail-heading">
									<Button
										variant="ghost"
										onClick={() => {
											editorGeneration.current++
											setEditor(null)
											setDraft({})
											setFormError(null)
										}}
										type="button"
									>
										<ArrowLeft size={16} />
										{t`Back`}
									</Button>
									<h4>
										{previous === null
											? (resource.createLabel ?? t`Add`)
											: adminRecordName(previous, resource.title)}
									</h4>
								</div>
								<AdminFields
									disabled={workflow.busy}
									fields={fields}
									draft={draft}
									previous={previous}
									onChange={(path, value) =>
										setDraft((old) => ({ ...old, [path]: value }))
									}
								/>
								{formError !== null && (
									<p className="admin-form-error" role="alert">
										{t`Check these details before saving:`} {formError}
									</p>
								)}
								<div className="admin-form-footer">
									<Button
										type="submit"
										disabled={workflow.busy || workflow.unconfirmed !== null}
									>
										{workflow.busy ? t`Saving…` : t`Save changes`}
									</Button>
									<Button
										type="button"
										variant="ghost"
										onClick={() => {
											editorGeneration.current++
											setEditor(null)
											setDraft({})
										}}
									>{t`Cancel`}</Button>
								</div>
							</form>
						) : (
							<>
								{resource.id === "usage" && loaded && (
									<UsageSummary value={summary} />
								)}
								{selected !== null ? (
									<div className="admin-detail">
										<div className="admin-detail-heading">
											{resource.single !== true && (
												<Button
													variant="ghost"
													onClick={() => {
														editorGeneration.current++
														setSelected(null)
													}}
												>
													<ArrowLeft size={16} />
													{t`All resources`}
												</Button>
											)}
											<h4>{adminRecordName(selected, resource.title)}</h4>
											<div className="admin-actions">
												{resource.update !== undefined &&
													selected["builtin"] !== true &&
													workflow.can(resource.update) && (
														<Button
															variant="outline"
															onClick={() => edit(selected)}
														>
															<Pencil size={15} />
															{t`Edit`}
														</Button>
													)}
												{resource.remove !== undefined &&
													selected["builtin"] !== true &&
													workflow.can(resource.remove) && (
														<Button
															variant="ghost"
															onClick={() => setConfirmRemove(true)}
														>
															<Trash2 size={15} />
															{t`Remove`}
														</Button>
													)}
											</div>
										</div>
										<RecordDetails
											resource={resource}
											value={selected}
											refs={refs}
											bootstrap={bootstrap}
										/>
										{resource.id === "domains" && (
											<div className="admin-domain-instructions">
												<h4>
													{selected["verifiedAt"] !== null
														? t`Domain verified`
														: t`Verify domain ownership`}
												</h4>
												<p>{t`In your domain provider's DNS settings, add this TXT record. Then check verification here.`}</p>
												<dl className="admin-detail-grid">
													<div>
														<dt>{t`Record name`}</dt>
														<dd>{String(selected["recordName"] ?? "")}</dd>
													</div>
													<div>
														<dt>{t`Record value`}</dt>
														<dd>{String(selected["recordValue"] ?? "")}</dd>
													</div>
												</dl>
												{workflow.can("sso.verifyDomain") && (
													<Button
														disabled={
															workflow.busy || workflow.unconfirmed !== null
														}
														onClick={() => {
															const id = resource.id
															const domain = selected["domain"]
															const currentEditor = editorGeneration.current
															void workflow
																.call("sso.verifyDomain", {
																	params: { domain },
																})
																.then((result) => {
																	if (
																		view.current === id &&
																		editorGeneration.current === currentEditor
																	) {
																		setSelected(objectOf(result))
																		setNotice(t`Domain verified.`)
																		setRefsVersion((version) => version + 1)
																	}
																})
																.catch(() => {})
														}}
													>{t`Check verification`}</Button>
												)}
											</div>
										)}
										{resource.id === "sso" && (
											<div className="admin-domain-instructions">
												<h4>{t`Finish at your identity service`}</h4>
												<p>{t`Add this callback address to the allowed redirect addresses in your identity service.`}</p>
												<p className="admin-readable-value">
													{String(selected["redirectUri"] ?? "")}
												</p>
											</div>
										)}
										{(resource.id === "platform-providers" ||
											resource.id === "providers") && (
											<AdminPrices
												provider={selected}
												platform={resource.id === "platform-providers"}
												workflow={workflow}
												models={[
													...(refs["platformModels"] ?? []),
													...(refs["models"] ?? []),
												]}
											/>
										)}
										{resource.id === "vaults" &&
											workflow.can("vaults.listVaultItems") && (
												<AdminVault
													vault={selected}
													workflow={workflow}
													bootstrap={bootstrap}
												/>
											)}
										{confirmRemove && (
											<div className="admin-remove-confirm" role="alert">
												<p>{t`Remove this resource or revoke its access? This can affect people and work that use it.`}</p>
												<Button
													variant="destructive"
													disabled={
														workflow.busy || workflow.unconfirmed !== null
													}
													onClick={() => void remove()}
												>{t`Remove`}</Button>
												<Button
													variant="ghost"
													onClick={() => setConfirmRemove(false)}
												>{t`Cancel`}</Button>
											</div>
										)}
									</div>
								) : (
									resource.single !== true && (
										<>
											{records.length > 0 && (
												<label className="admin-search">
													<Search size={17} />
													<input
														aria-label={t`Search this list`}
														placeholder={
															["members", "invitations", "admins"].includes(
																resource.id,
															)
																? t`Search by name or email`
																: t`Search this list`
														}
														value={search}
														onChange={(event) => setSearch(event.target.value)}
													/>
												</label>
											)}
											{!loaded && reading ? (
												<div
													className="admin-loading"
													role="status"
												>{t`Loading…`}</div>
											) : loaded && records.length === 0 ? (
												<div className="admin-empty">
													<Settings2 size={30} />
													<h4>{resource.empty}</h4>
													{resource.create !== undefined &&
														workflow.can(resource.create) && (
															<Button
																variant="outline"
																onClick={() => edit(null)}
															>
																{resource.createLabel ?? t`Add`}
															</Button>
														)}
												</div>
											) : (
												<div className="admin-resource-list">
													{records
														.filter((record) =>
															[
																adminRecordName(record, ""),
																recordCaption(record),
															]
																.join(" ")
																.toLocaleLowerCase()
																.includes(search.toLocaleLowerCase()),
														)
														.map((record, index) => (
															<button
																className="admin-resource-row"
																key={adminRecordKey(record) + index}
																onClick={() => {
																	editorGeneration.current++
																	setSelected(record)
																	setConfirmRemove(false)
																}}
															>
																<span className="admin-row-icon">
																	<Settings2 size={18} />
																</span>
																<span className="admin-row-copy">
																	<strong>
																		{resource.id === "audit"
																			? auditTitle(record["action"])
																			: resource.id === "usage"
																				? String(record["key"] ?? t`Other`)
																				: resource.id === "budgets"
																					? budgetTitle(record, refs, bootstrap)
																					: adminRecordName(
																							record,
																							resource.title,
																						)}
																	</strong>
																	<span>
																		{resource.id === "audit"
																			? displayDate(record["createdAt"])
																			: resource.id === "usage"
																				? formatMoney(record["costMicros"])
																				: resource.id === "budgets"
																					? `${formatMoney(record["spentMicros"])} / ${formatMoney(record["limitMicros"])}`
																					: recordCaption(record)}
																	</span>
																</span>
																{statusLabel(record) !== "" && (
																	<span className="admin-status">
																		{statusLabel(record)}
																	</span>
																)}
																<ChevronRight size={17} />
															</button>
														))}
												</div>
											)}
											{next !== null && (
												<Button
													variant="outline"
													disabled={reading}
													onClick={() => void refresh(undefined, next)}
												>{t`Load more`}</Button>
											)}
										</>
									)
								)}
							</>
						)}
					</>
				)
			)}
		</section>
	)
}

function UsageSummary({ value }: { readonly value: JsonObject }) {
	const total = objectOf(value["total"])
	return (
		<div className="admin-metrics">
			{[
				[t`Model calls`, total["calls"]],
				[t`Estimated cost`, formatMoney(total["costMicros"])],
				[t`Awaiting confirmation`, total["pendingCalls"]],
				[t`Usage not confirmed`, total["unknownCalls"]],
			].map(([label, number]) => (
				<div key={String(label)}>
					<span>{String(label)}</span>
					<strong>{String(number ?? "—")}</strong>
				</div>
			))}
		</div>
	)
}

function budgetTitle(
	record: JsonObject,
	refs: References,
	bootstrap: Product.Bootstrap,
): string {
	const id = record["scopeId"]
	const target = Match.value(record["scope"]).pipe(
		Match.when("organization", () => t`Organization`),
		Match.when("bot", () =>
			id === bootstrap.defaultBotId ? "Kay Bot" : t`Bot`,
		),
		Match.when("member", () =>
			adminRecordName(
				refs["members"]?.find((member) => member["userId"] === id) ?? {},
				t`Member`,
			),
		),
		Match.when("token", () =>
			adminRecordName(
				refs["tokens"]?.find((token) => token["id"] === id) ?? {},
				t`Integration`,
			),
		),
		Match.orElse(() => t`Spending limit`),
	)
	return target + " · " + (record["period"] === "day" ? t`Daily` : t`Monthly`)
}

function auditTitle(value: unknown): string {
	const [resource, action] = String(value ?? "").split(".")
	const subjects: Readonly<Record<string, string>> = {
		member: t`Member`,
		invitation: t`Invitation`,
		organization: t`Organization`,
		settings: t`Settings`,
		role: t`Role`,
		model: t`Model`,
		model_provider: t`Model provider`,
		computer_provider: t`Computer service`,
		computer: t`Computer`,
		secret_provider: t`Secret service`,
		vault: t`Vault`,
		channel: t`Channel`,
		token: t`Access token`,
		budget: t`Spending limit`,
		credits: t`Credits`,
		bot: "Kay Bot",
		trigger: t`Automation`,
		request: t`Approval`,
		grant: t`Permission`,
		delegation: t`Task`,
		model_price: t`Model price`,
	}
	const actions: Readonly<Record<string, string>> = {
		created: t`Created`,
		updated: t`Updated`,
		deleted: t`Removed`,
		removed: t`Removed`,
		revoked: t`Revoked`,
		granted: t`Granted`,
		joined: t`Joined`,
		left: t`Left`,
		accepted: t`Accepted`,
		declined: t`Declined`,
		completed: t`Completed`,
		started: t`Started`,
		resolved: t`Resolved`,
		set: t`Updated`,
		verified: t`Verified`,
		added: t`Added`,
	}
	return `${subjects[resource ?? ""] ?? t`Service activity`} · ${actions[action ?? ""] ?? t`Changed`}`
}

function RecordDetails({
	resource,
	value,
	refs,
	bootstrap,
}: {
	readonly resource: Resource
	readonly value: JsonObject
	readonly refs: References
	readonly bootstrap: Product.Bootstrap
}) {
	const fields = resource.fields({
		previous: value,
		draft: adminDraft(
			resource.fields({ previous: value, draft: {}, refs, bootstrap }),
			value,
		),
		refs,
		bootstrap,
	})
	const display = (field: AdminField): string => {
		const data = readPath(value, field.path)
		if (field.type === "password")
			return objectOf(data)["set"] === true ? t`Configured` : t`Not set`
		if (data === null || data === undefined || data === "") return t`Not set`
		if (field.type === "boolean") return data === true ? t`On` : t`Off`
		if (field.type === "number")
			return typeof data === "number"
				? new Intl.NumberFormat().format(data / (field.scale ?? 1))
				: "—"
		if (field.type === "choice")
			return (
				field.choices?.find(
					(choice) => JSON.stringify(choice.value) === JSON.stringify(data),
				)?.label ?? t`Configured`
			)
		if (field.type === "multiple")
			return Array.isArray(data) && data.length > 0
				? data
						.map(
							(item) =>
								field.choices?.find(
									(choice) =>
										JSON.stringify(choice.value) === JSON.stringify(item),
								)?.label ?? t`Configured item`,
						)
						.join(", ")
				: t`None`
		if (Array.isArray(data))
			return data.length > 0 ? data.map(String).join(", ") : t`None`
		return typeof data === "string" || typeof data === "number"
			? String(data)
			: t`Configured`
	}
	return (
		<dl className="admin-details">
			{resource.id === "audit" ? (
				<>
					<div>
						<dt>{t`Change`}</dt>
						<dd>{auditTitle(value["action"])}</dd>
					</div>
					<div>
						<dt>{t`Changed by`}</dt>
						<dd>
							{adminRecordName(
								refs["members"]?.find(
									(member) =>
										member["userId"] === objectOf(value["actor"])["userId"],
								) ?? {},
								t`Platform service`,
							)}
						</dd>
					</div>
				</>
			) : (
				fields
					.filter((field) => field.path !== "name")
					.map((field) => (
						<div key={field.path}>
							<dt>{field.label}</dt>
							<dd>{display(field)}</dd>
						</div>
					))
			)}
			{resource.id === "tokens" && (
				<>
					<div>
						<dt>{t`Token prefix`}</dt>
						<dd>{String(value["prefix"] ?? "—")}</dd>
					</div>
					<div>
						<dt>{t`Expires`}</dt>
						<dd>{displayDate(value["expiresAt"])}</dd>
					</div>
					<div>
						<dt>{t`Last used`}</dt>
						<dd>{displayDate(value["lastUsedAt"])}</dd>
					</div>
				</>
			)}
			{value["createdAt"] !== undefined && (
				<div>
					<dt>{t`Created`}</dt>
					<dd>{displayDate(value["createdAt"])}</dd>
				</div>
			)}
			{value["updatedAt"] !== undefined && (
				<div>
					<dt>{t`Last changed`}</dt>
					<dd>{displayDate(value["updatedAt"])}</dd>
				</div>
			)}
		</dl>
	)
}
