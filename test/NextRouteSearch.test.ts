import assert from "node:assert/strict"
import { test } from "node:test"
import { routeSearch, searchFromView } from "../src/next/RouteSearch.ts"
import { initialView, reduceView } from "../src/next/Model.ts"
import {
	adminDestination,
	adminRoute,
	adminSections,
} from "../src/next/features/SettingsData.ts"

test("administrator category navigation survives URL encoding, refresh, and browser history", () => {
	const history: string[] = []
	for (const section of [null, ...adminSections, null]) {
		const view = reduceView(initialView, {
			type: "navigate",
			destination: {
				kind: "feature",
				id: adminRoute(section),
				title: "Administrator console",
			},
		})
		const search = searchFromView(view)
		assert.deepEqual(search, { feature: adminRoute(section) })
		const url = new URL("https://kay.example/")
		url.searchParams.set("feature", search.feature!)
		history.push(url.toString())
		const restored = routeSearch(Object.fromEntries(url.searchParams))
		assert.deepEqual(restored, search)
		assert.equal(adminDestination(restored.feature!) ?? null, section)
	}
	for (const entries of [[...history].reverse(), history]) {
		for (const address of entries) {
			const url = new URL(address)
			const restored = routeSearch(Object.fromEntries(url.searchParams))
			const view = reduceView(initialView, {
				type: "navigate",
				destination: {
					kind: "feature",
					id: restored.feature!,
					title: "Administrator console",
				},
			})
			assert.deepEqual(searchFromView(view), restored)
			assert.equal(
				adminRoute(adminDestination(restored.feature!) ?? null),
				restored.feature,
			)
		}
	}
})

test("administrator routing rejects unknown sections and arbitrary colon destinations", () => {
	for (const feature of [
		"admin:",
		"admin:unknown",
		"admin:models:edit",
		"admin:Models",
		"admin:models/secret",
		"admin:models?token=secret",
		"tasks:models",
		"admin:%6dodels",
	]) {
		assert.deepEqual(routeSearch({ feature }), {})
		const view = reduceView(initialView, {
			type: "navigate",
			destination: { kind: "feature", id: feature, title: "Unknown" },
		})
		assert.deepEqual(searchFromView(view), {})
	}
	assert.deepEqual(
		routeSearch({ feature: "admin:models", token: "secret", payload: {} }),
		{ feature: "admin:models" },
	)
})

test("navigation URLs preserve only known destinations and resource identities", () => {
	assert.deepEqual(
		routeSearch({ feature: "bots", token: "secret", payload: {} }),
		{ feature: "bots" },
	)
	assert.deepEqual(routeSearch({ feature: "files", chat: "chat_123" }), {
		chat: "chat_123",
	})
	assert.deepEqual(
		routeSearch({ feature: "https://example.com", bot: "bad/id" }),
		{},
	)
	assert.deepEqual(routeSearch({ new: "true", bot: "bot_123" }), {
		new: true,
		bot: "bot_123",
	})
	assert.deepEqual(routeSearch({ chat: "x".repeat(161) }), {})
	assert.deepEqual(
		routeSearch({
			authorization: "flow_123",
			feature: "computers",
			code: "oauth-secret",
		}),
		{ feature: "apps", authorization: "flow_123" },
	)
	assert.deepEqual(
		routeSearch({ developerTest: "test_123", state: "oauth-secret" }),
		{ feature: "developer", developerTest: "test_123" },
	)
	assert.deepEqual(routeSearch({ authorization: "https://example.com" }), {})
})

test("default Chat routes stay simple while retained Bot links remain readable", () => {
	const newChat = reduceView(initialView, {
		type: "navigate",
		destination: { kind: "new" },
	})
	assert.deepEqual(searchFromView(newChat), { new: true })
	assert.deepEqual(routeSearch({ ...searchFromView(newChat) }), { new: true })
	assert.deepEqual(routeSearch({ new: true, bot: "bot_123" }), {
		new: true,
		bot: "bot_123",
	})
	const feature = reduceView(initialView, {
		type: "navigate",
		destination: { kind: "feature", id: "computers", title: "Computers" },
	})
	assert.deepEqual(searchFromView(feature), { feature: "computers" })
	assert.deepEqual(searchFromView(initialView), {})
})

test("a Chat's automation view retains its source through URL serialization", () => {
	const view = reduceView(initialView, {
		type: "navigate",
		destination: {
			kind: "feature",
			id: "automations",
			title: "Automations",
			conversationId: "chat_original-123",
		},
	})
	assert.deepEqual(searchFromView(view), {
		feature: "automations",
		sourceChat: "chat_original-123",
	})
	assert.deepEqual(routeSearch({ ...searchFromView(view) }), {
		feature: "automations",
		sourceChat: "chat_original-123",
	})
	const all = reduceView(view, {
		type: "navigate",
		destination: { kind: "feature", id: "automations", title: "Automations" },
	})
	assert.deepEqual(routeSearch({ ...searchFromView(all) }), {
		feature: "automations",
	})
})

test("automation source identity cannot carry arbitrary URL state", () => {
	for (const sourceChat of [
		undefined,
		null,
		"",
		"https://example.com",
		"chat/123",
		"chat 123",
		"x".repeat(161),
		123,
		["chat_123"],
		{ id: "chat_123" },
	]) {
		assert.deepEqual(routeSearch({ feature: "automations", sourceChat }), {
			feature: "automations",
		})
	}
	assert.deepEqual(routeSearch({ feature: "files", sourceChat: "chat_123" }), {
		feature: "files",
		sourceChat: "chat_123",
	})
	assert.deepEqual(
		routeSearch({
			feature: "automations",
			sourceChat: "chat_123",
			chat: "chat_active",
		}),
		{ chat: "chat_active" },
	)
	assert.deepEqual(
		routeSearch({
			feature: "automations",
			sourceChat: "chat_123",
			authorization: "flow_123",
			prompt: "private draft",
		}),
		{ feature: "apps", authorization: "flow_123" },
	)
})

test("a file library retains its destination Chat across navigation and refresh", () => {
	const view = reduceView(initialView, {
		type: "navigate",
		destination: {
			kind: "feature",
			id: "files",
			title: "Files",
			conversationId: "chat-a",
		},
	})
	assert.deepEqual(routeSearch({ ...searchFromView(view) }), {
		feature: "files",
		sourceChat: "chat-a",
	})
	assert.deepEqual(
		routeSearch({
			feature: "files",
			sourceChat: "https://foreign.invalid/chat",
		}),
		{ feature: "files" },
	)
	assert.deepEqual(routeSearch({ feature: "tasks", sourceChat: "chat-a" }), {
		feature: "tasks",
	})
})
