import { test } from "node:test"
import assert from "node:assert/strict"
import { Schema } from "effect"
import { SessionStore } from "@kaicom/e-core"
import { AuthApi, StartTurnRequest } from "@kaicom/e-platform-api"
import * as Projection from "../src/compatibility/Projection.ts"

const ref = {
	id: "session-1",
	revision: 8,
	head: "version-1",
	metadata: { title: "conversation must stay in user text", archived: false },
	settings: { mode: "default" },
	pending: [],
	turns: [],
	inheritedTurns: [],
	business: {
		"@openbot-build/openbot/session-host": {
			agent: "agt_main",
			kind: "direct",
			chain: {
				organizationId: "kay",
				userId: "user-a",
				agents: ["agt_main"],
				sessions: [],
			},
			memory: { use: false, generate: true },
		},
	},
}

test("projects complete history and exported snapshots without changing graph identities", () => {
	const snapshot = {
		id: "version-1",
		schemaVersion: "timeline/1",
		parents: [],
		snapshotFormatVersion: 2,
		value: {
			conversation: { context: { _tag: "Prompt", prompt: [] }, closed: true },
			"@openbot-build/openbot/memory": { entries: {}, processed: [] },
		},
		history: [],
	}
	const converted = Projection.record({
		formatVersion: 3,
		session: ref,
		versions: [snapshot],
		messages: [],
	})
	const decoded = Schema.decodeUnknownSync(SessionStore.Record)(converted)
	assert.equal(decoded.session.id, "session-1")
	assert.equal(decoded.session.revision, 8)
	assert.equal(decoded.session.settings.memoryEnabled, false)
	assert.equal(decoded.versions[0]?.schemaVersion, "memory/1")
	assert.equal(decoded.versions[0]?.value["conversation"], undefined)
	assert.deepEqual(
		decoded.versions[0]?.value["memory"],
		snapshot.value.conversation,
	)
})

test("one Turn memory override stays in the Turn request", () => {
	assert.deepEqual(
		Projection.request({
			path: "/v1/sessions/session-1/turns",
			value: {
				expected: 8,
				input: "hello",
				stream: true,
				overrides: { memoryEnabled: false },
			},
		}),
		{
			expected: 8,
			input: "hello",
			stream: true,
			overrides: {},
			memory: { use: false },
		},
	)
	assert.equal(
		ref.business["@openbot-build/openbot/session-host"].memory.generate,
		true,
	)
})

test("projects stored Turn switches without overwriting Session defaults", () => {
	const value = Projection.object(
		Projection.response({
			path: "/v1/sessions/s/turns/t",
			value: {
				turn: {
					settings: {
						mode: "default",
						pluginSettings: {
							"@openbot-build/openbot/memory": { use: false, generate: false },
						},
					},
				},
			},
		}),
	)["turn"]
	assert.equal(
		Projection.object(Projection.object(value)["settings"])[
			"memoryGenerationEnabled"
		],
		false,
	)
})

test("maps manual identity only in protocol slots", () => {
	const input = {
		cardUrl: "urn:openbot:manual:123",
		content: { cardUrl: "urn:openbot:manual:123" },
		arguments: { app: "urn:openbot:manual:123" },
	}
	assert.deepEqual(
		Projection.response({ path: "/v1/connections", value: input }),
		{ ...input, cardUrl: "urn:kai:manual:123" },
	)
})

test("keeps stable user cache identity and old account schema", () => {
	const value = Projection.response({
		path: "/auth/session",
		value: {
			identity: { userId: "user-a", organizationId: "org-b" },
			profile: {},
			expiresAt: "2027-01-01",
		},
	})
	assert.equal(
		Schema.decodeUnknownSync(AuthApi.SessionInfo)(value).identity.tenantId,
		"user-a",
	)
})

test("old Turn request remains valid before projection", () => {
	assert.equal(
		Schema.decodeSync(StartTurnRequest)({
			expected: 1,
			input: "hello",
			overrides: { memoryEnabled: false },
		}).overrides?.memoryEnabled,
		false,
	)
})

test("maps manual identities in URL and transfer envelopes, preserving free text", () => {
	const urn = "urn:kai:manual:123",
		target = "urn:openbot:manual:123"
	const query = new URL(
		Projection.requestURL(
			"/v1/connections?" + new URLSearchParams({ cardUrl: urn, query: urn }),
		),
		"https://kay.test",
	)
	assert.equal(query.searchParams.get("cardUrl"), target)
	assert.equal(query.searchParams.get("query"), urn)
	assert.deepEqual(
		Projection.request({
			path: "/v1/app-experience/import",
			value: { format: "kai-apps-v1", apps: [{ cardUrl: urn }] },
		}),
		{ format: "openbot-apps-v1", apps: [{ cardUrl: target }] },
	)
	assert.deepEqual(
		Projection.response({
			path: "/v1/app-experience/export",
			value: { format: "openbot-apps-v1", apps: [{ cardUrl: target }] },
		}),
		{ format: "kai-apps-v1", apps: [{ cardUrl: urn }] },
	)
})

test("record restore responses remain Session views", () => {
	const value = {
		session: ref,
		state: {
			version: { schemaVersion: "timeline/1" },
			value: { conversation: { history: [] } },
		},
	}
	assert.deepEqual(
		Projection.response({ path: "/v1/sessions/session-1/record", value }),
		Projection.sessionView(value),
	)
})

test("paged assistance supports collision aliases and leaves custom results unchanged", () => {
	const result = { _tag: "AppAccess", connections: [] }
	const platformPart = {
		type: "tool-result",
		name: "openbot_app_access_2",
		result,
	}
	const customPart = { type: "tool-result", name: "custom", result }
	const value = {
		items: [
			{
				content: {
					content: [{ role: "tool", content: [platformPart, customPart] }],
				},
			},
		],
		next: null,
	}
	const mapped = Projection.response({
		path: "/v1/sessions/s/turns/t/items",
		value,
	})
	assert.deepEqual(mapped, {
		...value,
		items: [
			{
				content: {
					content: [
						{
							role: "tool",
							content: [
								{
									...platformPart,
									result: { ...result, returnTo: "/sessions/s" },
								},
								customPart,
							],
						},
					],
				},
			},
		],
	})
})

test("operation result provenance maps without changing required input or user output", () => {
	const source = {
		connectionId: "c",
		connectionName: "name",
		cardUrl: "urn:openbot:manual:m",
		appName: "App",
		remoteIndex: 0,
		revision: 1,
		kind: "tool",
		name: "read",
	}
	const request = {
		app: "urn:openbot:manual:opaque",
		source: "urn:openbot:manual:opaque",
		cardUrl: "urn:openbot:manual:opaque",
	}
	for (const result of [
		{ _tag: "InputRequired", source, request },
		{ _tag: "Completed", source, result: request },
	]) {
		const input = { source, result, arguments: request }
		const converted = {
			source: { ...source, cardUrl: "urn:kai:manual:m" },
			result: { ...result, source: { ...source, cardUrl: "urn:kai:manual:m" } },
			arguments: request,
		}
		assert.deepEqual(
			Projection.response({ path: "/v1/app-operations/op", value: input }),
			converted,
		)
		assert.deepEqual(
			Projection.response({
				path: "/v1/sessions/s/app-operations",
				value: [input],
			}),
			[converted],
		)
	}
	assert.deepEqual(
		Projection.request({
			path: "/v1/app-operations/op/inputs",
			value: { round: 1, responses: { cardUrl: "urn:kai:manual:opaque" } },
		}),
		{ round: 1, responses: { cardUrl: "urn:kai:manual:opaque" } },
	)
})

test("known goal business namespace maps without changing goal state or unknown plugin data", () => {
	const goal = { target: "Keep this exact goal", status: "active" }
	const output = Projection.ref({
		settings: {},
		business: {
			"@openbot-build/openbot/goals": goal,
			"custom/plugin": { raw: "@openbot-build/openbot/goals" },
		},
	})
	assert.deepEqual(
		Projection.object(output["business"])["@kaicom/e-plugin-goal"],
		goal,
	)
	assert.deepEqual(Projection.object(output["business"])["custom/plugin"], {
		raw: "@openbot-build/openbot/goals",
	})
})

test("projects native Waiting status in turns and summaries without changing result text", () => {
	const result = { text: "Waiting is user text", finishReason: "stop" }
	const turn = {
		id: "t",
		settings: { mode: "default" },
		status: { _tag: "Waiting", result },
	}
	const projected = Projection.ref({ ...ref, turns: [turn] })
	assert.deepEqual(
		Projection.object((projected["turns"] as Projection.Json[])[0])["status"],
		{ _tag: "WaitingApproval", result },
	)
	assert.deepEqual(Projection.object(projected["business"]), {})
	const rows = Projection.response({
		path: "/v1/sessions",
		value: [{ session: { ...ref, turns: [turn] }, status: "Waiting" }],
	}) as Projection.Json[]
	assert.equal(Projection.object(rows[0])["status"], "WaitingApproval")
})

test("record restore preserves native ownership from the trusted host and refuses missing bindings", () => {
	const host = ref.business["@openbot-build/openbot/session-host"]
	const record = {
		formatVersion: 3,
		session: {
			...Projection.ref(ref),
			business: {
				"@openbot-build/openbot/session-host": {
					agent: "attacker",
					chain: { userId: "someone-else" },
				},
			},
		},
		versions: [
			{
				id: "v",
				schemaVersion: "memory/1",
				parents: [],
				snapshotFormatVersion: 2,
				value: {
					memory: { closed: true },
					"@kaicom/e-plugin-memory": { entries: {}, processed: [] },
				},
				history: [],
			},
		],
		messages: [],
	}
	const value = { expected: null, record }
	assert.throws(
		() => Projection.request({ path: "/v1/sessions/session-1/record", value }),
		/trusted OpenBot Session host/,
	)
	assert.throws(() =>
		Projection.request({
			path: "/v1/sessions/session-1/record",
			value,
			host: { memory: { use: true } },
		}),
	)
	const restored = Projection.object(
		Projection.object(
			Projection.request({
				path: "/v1/sessions/session-1/record",
				value,
				host,
			}),
		)["record"],
	)
	assert.deepEqual(
		Projection.object(Projection.object(restored["session"])["business"])[
			"@openbot-build/openbot/session-host"
		],
		host,
	)
	assert.deepEqual(Projection.record(restored), {
		...record,
		session: Projection.ref(ref),
	})
})

test("untitled native Sessions keep the old empty-title contract", () => {
	const projected = Projection.ref({ ...ref, metadata: { archived: false } })
	assert.equal(Projection.object(projected["metadata"])["title"], "")
	for (const path of ["/v1/sessions", "/v1/sessions/id/fork"])
		assert.deepEqual(Projection.request({ path, value: { title: "  " } }), {})
	assert.deepEqual(
		Projection.request({
			path: "/v1/sessions/id",
			value: { expected: 1, title: "" },
		}),
		{ expected: 1, title: null },
	)
	assert.deepEqual(
		Projection.request({
			path: "/v1/sessions/id",
			value: { expected: 1, title: "Kept title" },
		}),
		{ expected: 1, title: "Kept title" },
	)
})
