import assert from "node:assert/strict"
import { test } from "node:test"
import { Schema } from "effect"
import {
	belongsTo,
	featureScope,
	type FeatureOperation,
} from "../src/next/features/FeatureData.ts"
import {
	adminDestination,
	administrationInput,
	adminSectionFor,
	canOpenAdmin,
	MemoryPage,
	personalMemoryInput,
} from "../src/next/features/SettingsData.ts"
import { routeSearch } from "../src/next/RouteSearch.ts"

const operation = (id: string): FeatureOperation => ({
	id,
	group: id.split(".")[0]!,
	title: id,
	description: "",
	method: "GET",
	params: null,
	query: null,
	payload: null,
	response: null,
	transport: "json",
})

test("personal settings and computer pages do not expose service configuration", () => {
	for (const id of [
		"platform.getPlatformSettings",
		"modelProviders.createModelProvider",
		"computerProviders.createComputerProvider",
		"secretProviders.createSecretProvider",
		"organization.updateSettings",
		"budgets.createBudget",
		"usage.getUsage",
		"channels.createChannel",
	]) {
		const entry = operation(id)
		assert.equal(belongsTo("settings", entry), false, id)
		assert.equal(belongsTo("computers", entry), false, id)
		assert.equal(belongsTo("admin", entry), true, id)
	}
	assert.equal(
		belongsTo("apps", operation("connections.createManualConnection")),
		true,
	)
	assert.equal(
		belongsTo(
			"channelLinks",
			operation("channelLinks.listMyChannelIdentities"),
		),
		true,
	)
})

test("console categories separate shared models, defaults, access, and audit", () => {
	assert.equal(
		adminSectionFor(operation("platform.updatePlatformSettings")),
		"defaults",
	)
	assert.equal(
		adminSectionFor(operation("platform.createPlatformModelProvider")),
		"models",
	)
	assert.equal(
		adminSectionFor(operation("platform.listPlatformAdmins")),
		"people",
	)
	assert.equal(
		adminSectionFor(operation("organization.getSettings")),
		"defaults",
	)
	assert.equal(
		adminSectionFor(operation("organization.listAuditLogs")),
		"audit",
	)
	assert.equal(
		adminSectionFor(operation("connections.createManualConnection")),
		undefined,
	)
	assert.equal(adminDestination("modelProviders"), "models")
	assert.equal(adminDestination("admin:computers"), "computers")
	assert.equal(adminDestination("admin:unknown"), undefined)
	assert.equal(
		adminSectionFor(operation("memberSettings.updateMemberSettings")),
		undefined,
	)
	assert.equal(
		belongsTo(
			"admin:defaults",
			operation("memberSettings.updateMemberSettings"),
		),
		false,
	)
	assert.deepEqual(routeSearch({ feature: "memberSettings" }), {})
	const scope = featureScope({
		id: "admin:models",
		operations: [
			operation("platform.getPlatformSettings"),
			operation("platform.listPlatformModels"),
			operation("modelProviders.listModelProviders"),
		],
	})
	assert.deepEqual(
		scope.operations.map((entry) => entry.id),
		["platform.listPlatformModels", "modelProviders.listModelProviders"],
	)
})

test("memory controls use the current personal Bot without exposing Bot administration", () => {
	assert.equal(belongsTo("memory", operation("bots.botMemory")), true)
	assert.equal(belongsTo("memory", operation("bots.updateBotMemory")), true)
	assert.equal(belongsTo("memory", operation("bots.createBot")), false)
	assert.equal(belongsTo("memory", operation("bots.purgeBotMemory")), false)
	assert.deepEqual(
		personalMemoryInput({
			botId: "default-bot",
			command: {
				_tag: "Remember",
				content: "Use short answers.",
			},
		}),
		{
			params: { botId: "default-bot" },
			payload: { command: { _tag: "Remember", content: "Use short answers." } },
		},
	)
	assert.deepEqual(
		personalMemoryInput({
			botId: "default-bot",
			command: { _tag: "Forget", id: "memory-1" },
		}),
		{
			params: { botId: "default-bot" },
			payload: { command: { _tag: "Forget", id: "memory-1" } },
		},
	)
	assert.throws(() =>
		Schema.decodeUnknownSync(MemoryPage)({
			entries: [{ id: "entry", content: 10, status: "active" }],
			version: 1,
		}),
	)
})

test("missing or revoked administrator access cannot open the console", () => {
	assert.equal(canOpenAdmin(undefined), false)
	assert.equal(canOpenAdmin({ adminConsole: false }), false)
	assert.equal(canOpenAdmin({ adminConsole: true }), true)
})

test("admin and memory destinations preserve identities without allowing configuration in URLs", () => {
	assert.deepEqual(
		routeSearch({
			feature: "admin",
			apiKey: "private",
			payload: { provider: "private" },
		}),
		{ feature: "admin" },
	)
	assert.deepEqual(routeSearch({ feature: "memory", botId: "someone-else" }), {
		feature: "memory",
	})
})

test("cloud provider setup defaults to organization access and preserves an explicit private choice", () => {
	const operation = "computerProviders.createComputerProvider"
	assert.deepEqual(
		administrationInput({ operation, input: { payload: { name: "Cloud" } } }),
		{ payload: { name: "Cloud", shared: true } },
	)
	assert.deepEqual(
		administrationInput({
			operation,
			input: { payload: { name: "Private", shared: false } },
		}),
		{ payload: { name: "Private", shared: false } },
	)
	assert.deepEqual(
		administrationInput({
			operation: "computerProviders.updateComputerProvider",
			input: { payload: { name: "Changed" } },
		}),
		{ payload: { name: "Changed" } },
	)
	assert.deepEqual(
		administrationInput({
			operation: "connections.createManualConnection",
			input: { payload: { name: "My App" } },
		}),
		{ payload: { name: "My App" } },
	)
})
