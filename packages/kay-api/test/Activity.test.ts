import assert from "node:assert/strict"
import { test } from "node:test"
import * as Activity from "../src/compatibility/Activity.ts"
import * as Projection from "../src/compatibility/Projection.ts"
const hostKey = "@openbot-build/openbot/session-host"
const view = ({
	id,
	agent = "main",
	ancestors = [],
	agents = ["main"],
	parent,
	status = "Waiting",
	revision = 3,
}: {
	id: string
	agent?: string
	ancestors?: string[]
	agents?: string[]
	parent?: string
	status?: string
	revision?: number
}): Projection.Json => ({
	session: {
		id,
		head: "v",
		revision,
		metadata: { title: "", archived: false },
		settings: { mode: "default" },
		pending: [],
		inheritedTurns: [],
		business: {
			[hostKey]: {
				agent,
				kind: parent === undefined ? "direct" : "delegated",
				...(parent === undefined
					? {}
					: {
							parent: {
								session: parent,
								turn: "original-reused-turn",
								toolCallId: "original-call",
							},
						}),
				chain: {
					organizationId: "org",
					userId: "user",
					agents,
					sessions: ancestors,
				},
			},
		},
		turns: [
			{
				id: id + "-turn",
				session: id,
				settings: { mode: "default" },
				status: {
					_tag: status,
					result: { text: "", finishReason: "tool-calls" },
				},
				steps: 1,
				input: [],
				items: [id + "-item"],
				start: "v0",
				startedAt: 1,
			},
		],
	},
	activity: "inactive",
	response: null,
	state: {
		version: { id: "v", schemaVersion: "timeline/1", parents: [] },
		value: {
			conversation: {
				closed: false,
				context: { _tag: "Prompt", prompt: { content: [] } },
				history: [
					{
						id: id + "-item",
						origin: { session: id, turn: id + "-turn", step: 0 },
						content: {
							content: [
								{
									role: "assistant",
									content: [
										{
											type: "tool-call",
											id: "call",
											name: "write",
											params: { value: id },
											providerExecuted: false,
										},
										{
											type: "tool-approval-request",
											approvalId: "approval-" + id,
											toolCallId: "call",
										},
									],
								},
							],
						},
					},
				],
			},
		},
	},
})
const parent = view({ id: "parent" })
const child = view({
	id: "child",
	agent: "child-agent",
	ancestors: ["parent"],
	agents: ["main", "child-agent"],
	parent: "parent",
})
const nested = view({
	id: "nested",
	agent: "nested-agent",
	ancestors: ["parent", "child"],
	agents: ["main", "child-agent", "nested-agent"],
	parent: "child",
})
const link = (
	parent: string,
	child: string,
	agent: string,
): Projection.Json => ({
	id: parent + "-delegation",
	parent: {
		session: parent,
		turn: parent + "-turn",
		toolCallId: "call",
		callOccurrence: 0,
	},
	agent,
	child: { session: child, turn: child + "-turn" },
	status: "running",
})
const request = (session: string) => ({
	id: session + "-request",
	session,
	turn: session + "-turn",
	toolCallId: "call",
	callOccurrence: 0,
	revision: 2,
	status: "pending",
})
const responses: Record<string, Projection.Json> = {
	"/v1/sessions/parent/delegations": [link("parent", "child", "child-agent")],
	"/v1/sessions/child": child,
	"/v1/sessions/child/delegations": [link("child", "nested", "nested-agent")],
	"/v1/sessions/nested": nested,
	"/v1/sessions/nested/delegations": [],
	"/v1/requests?status=pending": [
		request("parent"),
		request("child"),
		request("nested"),
		request("unrelated"),
	],
}
const reader =
	(overrides: Record<string, Projection.Json> = {}): Activity.Read =>
	async (path) => {
		const result = { ...responses, ...overrides }[path]
		if (result === undefined) throw new Error("Unexpected read: " + path)
		return result
	}

test("native descendant approvals stay in the parent conversation with exact request targets", async () => {
	const inspected = await Activity.inspect({ view: parent, read: reader() })
	assert.equal(inspected.view["activity"], "active")
	assert.deepEqual(
		inspected.view["session"],
		Projection.object(parent)["session"],
	)
	assert.equal(inspected.descendants.length, 2)
	assert.deepEqual(
		inspected.approvals
			.map(Projection.object)
			.map((row) => [row["turn"], row["approvalId"], row["arguments"]]),
		[
			["parent-turn", "parent-request", { value: "parent" }],
			["parent-turn", "child-request", { value: "child" }],
			["parent-turn", "nested-request", { value: "nested" }],
		],
	)
	assert.deepEqual(inspected.requestTargets, [
		{
			id: "parent-request",
			session: "parent",
			turn: "parent-turn",
			revision: 3,
		},
		{ id: "child-request", session: "child", turn: "child-turn", revision: 3 },
		{
			id: "nested-request",
			session: "nested",
			turn: "nested-turn",
			revision: 3,
		},
	])
})

test("stale delegation Turn and occurrence cannot surface a child's request", async () => {
	for (const stale of [
		{
			...Projection.object(link("parent", "child", "child-agent")),
			parent: {
				session: "parent",
				turn: "previous-turn",
				toolCallId: "call",
				callOccurrence: 0,
			},
		},
		{
			...Projection.object(link("parent", "child", "child-agent")),
			parent: {
				session: "parent",
				turn: "parent-turn",
				toolCallId: "call",
				callOccurrence: 1,
			},
		},
	]) {
		const inspected = await Activity.inspect({
			view: parent,
			read: reader({ "/v1/sessions/parent/delegations": [stale] }),
		})
		assert.deepEqual(
			inspected.requestTargets.map((target) => target.session),
			["parent"],
		)
	}
})

test("child ownership, ancestor chain, link identity and cycles fail closed", async () => {
	const raw = Projection.object(child),
		session = Projection.object(raw["session"]),
		business = Projection.object(session["business"]),
		host = Projection.object(business[hostKey]),
		chain = Projection.object(host["chain"])
	for (const changed of [
		{ ...host, chain: { ...chain, userId: "other" } },
		{ ...host, chain: { ...chain, organizationId: "other" } },
		{ ...host, chain: { ...chain, sessions: [] } },
		{ ...host, agent: "other" },
		{ ...host, parent: { session: "other", turn: "t", toolCallId: "call" } },
	]) {
		await assert.rejects(
			Activity.inspect({
				view: parent,
				read: reader({
					"/v1/sessions/child": {
						...raw,
						session: { ...session, business: { [hostKey]: changed } },
					},
				}),
			}),
			/ancestor chain/,
		)
	}
	await assert.rejects(
		Activity.inspect({
			view: parent,
			read: reader({
				"/v1/sessions/parent/delegations": [link("parent", "parent", "main")],
			}),
		}),
		/cycle/,
	)
})

test("terminal parent does not enumerate or expose descendants", async () => {
	const finished = view({ id: "parent", status: "Completed" })
	const inspected = await Activity.inspect({
		view: finished,
		read: async () => {
			throw new Error("No read expected")
		},
	})
	assert.deepEqual(inspected, {
		view: finished,
		descendants: [],
		approvals: [],
		requestTargets: [],
	})
})

test("native wait uses its real inactive cursor and bounds unchanged projected activity", async () => {
	const paths: string[] = []
	const started = performance.now()
	const inspected = await Activity.wait({
		sessionId: "parent",
		after: 3,
		afterActivity: "active",
		timeoutMs: 30000,
		read: async (path) => {
			paths.push(path)
			if (path === "/v1/sessions/parent") return parent
			if (path.startsWith("/v1/sessions/parent/wait?")) {
				const query = new URL(path, "https://test.invalid").searchParams
				assert.equal(query.get("afterActivity"), "inactive")
				assert.equal(query.get("after"), "3")
				assert.equal(query.get("timeoutMs"), "1000")
				return parent
			}
			return reader()(path)
		},
	})
	assert.ok(
		performance.now() - started >= 200,
		"unchanged responses cannot form a busy loop",
	)
	assert.equal(inspected.view["activity"], "active")
	assert.equal(paths.filter((path) => path.includes("/wait?")).length, 1)
})

test("closed or replaced child Turns cannot surface old approvals", async () => {
	for (const stale of [
		{
			...Projection.object(link("parent", "child", "child-agent")),
			status: "completed",
		},
		{
			...Projection.object(link("parent", "child", "child-agent")),
			child: { session: "child", turn: "previous-child-turn" },
		},
	]) {
		const inspected = await Activity.inspect({
			view: parent,
			read: reader({ "/v1/sessions/parent/delegations": [stale] }),
		})
		assert.deepEqual(
			inspected.requestTargets.map((target) => target.session),
			["parent"],
		)
	}
})

test("a descendant read failure is not reported as finished activity", async () => {
	await assert.rejects(
		Activity.inspect({
			view: parent,
			read: async (path) => {
				if (path === "/v1/sessions/child")
					throw new Error("Native read unavailable")
				return reader()(path)
			},
		}),
		/Native read unavailable/,
	)
})

test("descendant reads have an explicit depth and total-node bound", async () => {
	const chainRoot = view({ id: "node0", agent: "agent0", agents: ["agent0"] })
	await assert.rejects(
		Activity.inspect({
			view: chainRoot,
			read: async (path) => {
				const match = /^\/v1\/sessions\/node(\d+)(\/delegations)?$/.exec(path)
				assert.ok(match)
				const index = Number(match[1])
				if (match[2] !== undefined)
					return [
						link("node" + index, "node" + (index + 1), "agent" + (index + 1)),
					]
				return view({
					id: "node" + index,
					agent: "agent" + index,
					parent: "node" + (index - 1),
					ancestors: Array.from({ length: index }, (_, i) => "node" + i),
					agents: Array.from({ length: index + 1 }, (_, i) => "agent" + i),
				})
			},
		}),
		/depth limit/,
	)
	let reads = 0
	await assert.rejects(
		Activity.inspect({
			view: parent,
			read: async (path) => {
				if (path === "/v1/sessions/parent/delegations")
					return Array.from({ length: 65 }, (_, i) =>
						link("parent", "child" + i, "agent" + i),
					)
				const match = /^\/v1\/sessions\/child(\d+)$/.exec(path)
				assert.ok(match)
				reads++
				return view({
					id: "child" + match[1],
					agent: "agent" + match[1],
					parent: "parent",
					ancestors: ["parent"],
					agents: ["main", "agent" + match[1]],
				})
			},
		}),
		/read limit/,
	)
	assert.equal(reads, 63)
})

test("a visible local human approval preserves native inactive activity", async () => {
	const inspected = await Activity.inspect({
		view: parent,
		read: reader({ "/v1/sessions/parent/delegations": [] }),
	})
	assert.equal(inspected.view["activity"], "inactive")
	assert.equal(inspected.approvals.length, 1)
	const reviewing = await Activity.inspect({
		view: parent,
		read: reader({
			"/v1/sessions/parent/delegations": [],
			"/v1/requests?status=pending": [],
		}),
	})
	assert.equal(reviewing.view["activity"], "active")
})
