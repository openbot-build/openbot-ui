import assert from "node:assert/strict"
import { test } from "node:test"
import type { NativeCall } from "@kaicom/kay-contracts/Native"
import {
	readConversationActivity,
	ConversationActivityFailure,
} from "../src/ConversationActivity.ts"

const todo = (status: "pending" | "in_progress" | "done" = "done") => ({
	id: "step-a",
	content: "Prepare the report",
	status,
})
const snapshot = (turnId: string | null = "turn-a", revision = 4) => ({
	chat: {
		id: "chat-a",
		revision,
		settings: {
			model: {
				_tag: "Config.Selection",
				provider: "provider-a",
				model: "model-a",
			},
		},
	},
	status: turnId === null ? "Idle" : "Completed",
	turn: turnId === null ? null : { id: turnId, chat: "chat-a", settings: {} },
})
const running = () => ({
	...snapshot(),
	status: "Running",
	executionId: "execution-a",
	activeExecution: { id: "execution-a", sequence: 12, status: "running" },
	activeTools: [
		{
			executionId: "execution-a",
			step: "tool:6:item-1call-a",
			attempt: 0,
			tool: {
				chatId: "chat-a",
				turnId: "turn-a",
				itemId: "item-1",
				callId: "call-a",
				name: "computer_terminal",
				computerId: "computer-a",
			},
			status: "running",
		},
	],
})

test("current foreground calls appear before their Item is committed and recover after refresh", async () => {
	for (const status of [
		"queued",
		"running",
		"waiting",
		"cancelling",
		"outcome_unknown",
	]) {
		const chat = running()
		chat.activeTools[0]!.status = status
		const f = fixture({ chat })
		const value = await readConversationActivity({
			chatId: "chat-a",
			read: f.read,
		})
		assert.equal(value.tools.length, 1)
		assert.equal(value.tools[0]!.name, "computer_terminal")
		assert.equal(value.tools[0]!.computerId, "computer-a")
		assert.equal(value.tools[0]!.status, status)
		assert.equal(value.tools[0]!.itemId, "item-1")
		assert.deepEqual(value.activeExecution, chat.activeExecution)
	}
})

test("current call metadata replaces its exact committed history occurrence", async () => {
	const f = fixture({
		chat: running(),
		pages: { first: { items: [call(1, "computer_terminal")], next: null } },
	})
	const value = await readConversationActivity({
		chatId: "chat-a",
		read: f.read,
	})
	assert.equal(value.tools.length, 1)
	assert.equal(value.tools[0]!.executionId, "execution-a")
	assert.equal(value.tools[0]!.status, "running")
})

test("execution cursor changes invalidate a read even without a new Chat revision", async () => {
	const chat = running()
	const lastChat = {
		...chat,
		activeExecution: { ...chat.activeExecution, sequence: 13 },
		activeTools: [],
	}
	const f = fixture({ chat, lastChat })
	await assert.rejects(
		readConversationActivity({ chatId: "chat-a", read: f.read }),
		(error) =>
			error instanceof ConversationActivityFailure && error.status === 409,
	)
})

test("foreground snapshots reject foreign scope and malformed metadata", async () => {
	for (const change of [
		{ tool: { ...running().activeTools[0]!.tool, chatId: "other" } },
		{ tool: { ...running().activeTools[0]!.tool, turnId: "other" } },
		{ executionId: "other" },
		{ step: "tool:wrong" },
		{ status: "completed" },
	]) {
		const chat = running()
		const f = fixture({
			chat: { ...chat, activeTools: [{ ...chat.activeTools[0], ...change }] },
		})
		await assert.rejects(
			readConversationActivity({ chatId: "chat-a", read: f.read }),
			(error) =>
				error instanceof ConversationActivityFailure && error.status === 502,
		)
	}
})
const item = (
	seq: number,
	role: string,
	content: unknown[],
	turn = "turn-a",
) => ({
	id: `item-${seq}`,
	seq,
	origin: { chat: "chat-a", turn },
	content: { content: [{ role, content }] },
})
const call = (
	seq: number,
	name = "openbot_todos",
	params: unknown = { items: [todo()] },
	id = "call-a",
	turn = "turn-a",
) => item(seq, "assistant", [{ type: "tool-call", id, name, params }], turn)
const result = (
	seq: number,
	name = "openbot_todos",
	value: unknown = { open: 0, done: 1 },
	id = "call-a",
	turn = "turn-a",
) =>
	item(
		seq,
		"tool",
		[{ type: "tool-result", id, name, result: value, isFailure: false }],
		turn,
	)
const tool = (name = "openbot_todos", status = "completed") => ({
	id: "tool-a",
	executionId: "execution-a",
	callId: "call-a",
	tool: name,
	status,
	position: { chat: "chat-a", turn: "turn-a", item: "item-1" },
	startedAt: 2,
})
const appToolName = `openbot_${"a".repeat(40)}`
const appOperation = (
	id = "app-a",
	displayName = "search_documents",
	appName = "Documents",
) => ({
	id,
	executionId: `execution-${id}`,
	chat: "chat-a",
	turn: "turn-a",
	callId: "call-a",
	toolName: appToolName,
	status: "completed",
	source: {
		name: displayName,
		appName,
		connectionName: "Work account",
		definition: { description: "Not part of the activity label" },
	},
	arguments: { token: "not-for-activity" },
})
const fixture = (
	options: {
		readonly chat?: unknown
		readonly lastChat?: unknown
		readonly todos?: unknown
		readonly tools?: unknown
		readonly delegations?: unknown
		readonly apps?: unknown
		readonly pages?: Readonly<Record<string, unknown>>
		readonly fail?: (call: NativeCall) => void
	} = {},
) => {
	const calls: NativeCall[] = []
	const read = async (request: NativeCall): Promise<unknown> => {
		calls.push(request)
		options.fail?.(request)
		if (request.operation === "chat")
			return calls.filter((entry) => entry.operation === "chat").length === 1
				? (options.chat ?? snapshot())
				: (options.lastChat ?? options.chat ?? snapshot())
		if (request.operation === "items")
			return (
				options.pages?.[request.query?.["before"] ?? "first"] ?? {
					items: [],
					next: null,
				}
			)
		assert.equal(request.operation, "feature")
		assert.deepEqual(request.payload, { params: { chatId: "chat-a" } })
		switch (request.id) {
			case "chats.chatTodos":
				return options.todos ?? { items: [] }
			case "toolCalls.list":
				return options.tools ?? []
			case "chats.chatDelegations":
				return options.delegations ?? []
			case "appOperations.list":
				return options.apps ?? []
			default:
				throw new Error("Unexpected operation")
		}
	}
	return { read, calls }
}
const failure = (status: number) => (error: unknown) =>
	error instanceof ConversationActivityFailure && error.status === status

test("current todos describe only their own list, with no invented Turn source", async () => {
	const source = fixture({
		todos: { items: [todo("done"), { ...todo("in_progress"), id: "step-b" }] },
	})
	const activity = await readConversationActivity({
		chatId: "chat-a",
		read: source.read,
	})
	assert.deepEqual(activity.progress, { completed: 1, total: 2 })
	assert.equal(activity.plan.source, "current")
	assert.equal(activity.plan.turnId, null)
	assert.deepEqual(activity.model, { provider: "provider-a", model: "model-a" })
	assert.deepEqual(activity.updates, [])
})

test("completed history restores a plan across page boundaries without replaying tools", async () => {
	const source = fixture({
		pages: {
			first: { items: [result(2)], next: 2 },
			"2": { items: [call(1)], next: null },
		},
	})
	const activity = await readConversationActivity({
		chatId: "chat-a",
		read: source.read,
	})
	assert.deepEqual(activity.plan, {
		source: "history",
		items: [todo()],
		sourceItemId: "item-1",
		turnId: "turn-a",
	})
	assert.deepEqual(activity.progress, { completed: 1, total: 1 })
	assert.equal(activity.history.complete, true)
	assert.equal(
		source.calls.filter((entry) => entry.operation === "items").length,
		2,
	)
	assert.ok(
		source.calls.every((entry) =>
			["chat", "items", "feature"].includes(entry.operation),
		),
	)
})

test("empty todos alone do not report completion or copy final answers and reasoning", async () => {
	const source = fixture({
		chat: snapshot(null),
		pages: {
			first: {
				items: [
					item(1, "assistant", [
						{ type: "text", text: "Final answer" },
						{ type: "reasoning", text: "Private reasoning" },
					]),
				],
				next: null,
			},
		},
	})
	const activity = await readConversationActivity({
		chatId: "chat-a",
		read: source.read,
	})
	assert.equal(activity.progress, null)
	assert.equal(activity.plan.source, "none")
	assert.equal(activity.turnId, null)
	assert.deepEqual(activity.updates, [])
})

test("a previous plan retains its original Turn when a new Turn exists or no Turn exists", async () => {
	for (const current of [null, "turn-new"]) {
		const source = fixture({
			chat: snapshot(current),
			pages: { first: { items: [result(2), call(1)], next: null } },
		})
		const activity = await readConversationActivity({
			chatId: "chat-a",
			read: source.read,
		})
		assert.equal(activity.turnId, current)
		assert.equal(activity.plan.turnId, "turn-a")
		assert.equal(activity.progress, null)
	}
})

test("failed, unfinished, cross-Turn and duplicate results do not revive a plan", async () => {
	for (const items of [
		[call(1)],
		[result(2, "openbot_todos", { error: "Denied" }), call(1)],
		[
			result(2, "openbot_todos", { open: 0, done: 1 }, "call-a", "other-turn"),
			call(1),
		],
		[result(3), result(2), call(1)],
	]) {
		const source = fixture({ pages: { first: { items, next: null } } })
		const activity = await readConversationActivity({
			chatId: "chat-a",
			read: source.read,
		})
		assert.equal(activity.progress, null)
		assert.equal(activity.plan.source, "none")
	}
})

test("the latest explicit empty list does not restore a superseded plan", async () => {
	const source = fixture({
		pages: {
			first: {
				items: [
					result(4, "openbot_todos", { open: 0, done: 0 }, "call-b"),
					call(3, "openbot_todos", { items: [] }, "call-b"),
					result(2),
					call(1),
				],
				next: null,
			},
		},
	})
	const activity = await readConversationActivity({
		chatId: "chat-a",
		read: source.read,
	})
	assert.equal(activity.plan.sourceItemId, "item-3")
	assert.deepEqual(activity.plan.items, [])
	assert.equal(activity.progress, null)
})

test("approved submit_plan uses its saved items and does not require a synthetic result shape", async () => {
	const source = fixture({
		pages: {
			first: {
				items: [
					result(2, "openbot_submit_plan", {
						approved: true,
						note: "Start a new Turn",
					}),
					call(1, "openbot_submit_plan", {
						items: [todo("pending")],
						summary: "Prepare a report",
					}),
				],
				next: null,
			},
		},
	})
	assert.deepEqual(
		(await readConversationActivity({ chatId: "chat-a", read: source.read }))
			.progress,
		{ completed: 0, total: 1 },
	)
})

test("only an exact saved computer call and ready exported file identify a device and deliverable", async () => {
	const name = "openbot_computer_export_file"
	const source = fixture({
		tools: [tool(name)],
		pages: {
			first: {
				items: [
					result(2, name, {
						file: { id: "file-a", status: "ready" },
						uri: "openbot-file:///file-a",
						path: "/workspace/report.pdf",
					}),
					call(1, name, {
						computer: "computer-a",
						path: "/workspace/report.pdf",
					}),
				],
				next: null,
			},
		},
	})
	const activity = await readConversationActivity({
		chatId: "chat-a",
		read: source.read,
	})
	assert.equal(activity.tools[0]?.computerId, "computer-a")
	assert.deepEqual(activity.tools[0]?.fileIds, ["file-a"])
	assert.ok(!JSON.stringify(activity).includes("/workspace"))
	assert.equal(activity.tools[0]?.completedAt, null)
})

test("failed tool state is preserved without treating a temporary path as a file", async () => {
	const name = "openbot_computer_exec"
	const source = fixture({
		tools: [tool(name, "failed")],
		pages: {
			first: {
				items: [
					result(2, name, { path: "/workspace/report.pdf" }),
					call(1, name, { computer: "computer-a" }),
				],
				next: null,
			},
		},
	})
	const activity = await readConversationActivity({
		chatId: "chat-a",
		read: source.read,
	})
	assert.equal(activity.tools[0]?.status, "failed")
	assert.deepEqual(activity.tools[0]?.fileIds, [])
})

test("changed revisions and Turn IDs reject a mixed refresh", async () => {
	for (const lastChat of [snapshot("turn-a", 5), snapshot("turn-b", 4)]) {
		await assert.rejects(
			readConversationActivity({
				chatId: "chat-a",
				read: fixture({ lastChat }).read,
			}),
			failure(409),
		)
	}
	const source = fixture()
	await assert.rejects(
		readConversationActivity({
			chatId: "chat-a",
			read: source.read,
			expectedTurnId: null,
		}),
		failure(409),
	)
	assert.equal(source.calls.length, 1)
})

test("permission failures, missing data and bad cursors never become an empty success", async () => {
	const denied = new Error("Denied")
	await assert.rejects(
		readConversationActivity({
			chatId: "chat-a",
			read: fixture({
				fail: (call) => {
					if (call.id === "toolCalls.list") throw denied
				},
			}).read,
		}),
		(error) => error === denied,
	)
	for (const options of [
		{ todos: {} },
		{
			tools: [
				{
					...tool(),
					position: { chat: "other-chat", turn: "turn-a", item: "item-1" },
				},
			],
		},
		{ pages: { first: { items: [call(1)], next: 2 } } },
		{ pages: { first: { items: [call(1), result(2)], next: null } } },
	])
		await assert.rejects(
			readConversationActivity({
				chatId: "chat-a",
				read: fixture(options).read,
			}),
			failure(502),
		)
})

test("the history limit remains visible and does not claim a complete empty history", async () => {
	let pages = 0
	const source = fixture()
	const activity = await readConversationActivity({
		chatId: "chat-a",
		read: async (request) => {
			if (request.operation !== "items") return source.read(request)
			const seq = 100 - pages++
			return {
				items: [
					item(seq, "assistant", [{ type: "text", text: "A saved answer" }]),
				],
				next: seq,
			}
		},
	})
	assert.equal(pages, 10)
	assert.deepEqual(activity.history, { complete: false, nextBefore: 91 })
	assert.equal(activity.progress, null)
})

test("an aborted refresh stops further reads", async () => {
	const controller = new AbortController()
	controller.abort()
	const source = fixture()
	await assert.rejects(
		readConversationActivity({
			chatId: "chat-a",
			read: source.read,
			signal: controller.signal,
		}),
		{ name: "AbortError" },
	)
	assert.deepEqual(source.calls, [])
})

test("retained current todos keep their previous source instead of attaching to a new Turn", async () => {
	const source = fixture({
		chat: snapshot("turn-new"),
		todos: { items: [todo("pending")] },
		pages: {
			first: {
				items: [
					result(2, "openbot_todos", { open: 1, done: 0 }),
					call(1, "openbot_todos", { items: [todo("pending")] }),
				],
				next: null,
			},
		},
	})
	const activity = await readConversationActivity({
		chatId: "chat-a",
		read: source.read,
	})
	assert.equal(activity.plan.source, "current")
	assert.equal(activity.plan.turnId, "turn-a")
	assert.equal(activity.progress, null)
})

test("a recovered plan stops older reads and leaves an explicit history cursor", async () => {
	const source = fixture({
		pages: { first: { items: [result(3), call(2)], next: 2 } },
	})
	const activity = await readConversationActivity({
		chatId: "chat-a",
		read: source.read,
	})
	assert.deepEqual(activity.history, { complete: false, nextBefore: 2 })
	assert.equal(
		source.calls.filter((entry) => entry.operation === "items").length,
		1,
	)
})

test("App activities preserve their exact Turn and unresolved execution state", async () => {
	const source = fixture({
		apps: [
			{
				id: "app-a",
				executionId: "execution-app",
				chat: "chat-a",
				turn: "turn-old",
				toolName: "save_note",
				status: "outcome_unknown",
			},
		],
	})
	const activity = await readConversationActivity({
		chatId: "chat-a",
		read: source.read,
	})
	assert.deepEqual(activity.appOperations, [
		{
			id: "app-a",
			executionId: "execution-app",
			turnId: "turn-old",
			name: "save_note",
			status: "outcome_unknown",
		},
	])
})

test("only explicitly public text becomes an activity update", async () => {
	const source = fixture({
		pages: {
			first: {
				items: [
					item(1, "assistant", [
						{
							type: "text",
							channel: "commentary",
							text: "Checking the saved results.",
						},
						{
							type: "reasoning",
							channel: "commentary",
							text: "Private reasoning",
						},
						{ type: "text", channel: "analysis", text: "Private analysis" },
						{ type: "text", channel: "final", text: "The final answer" },
					]),
				],
				next: null,
			},
		},
	})
	const activity = await readConversationActivity({
		chatId: "chat-a",
		read: source.read,
	})
	assert.equal(activity.updates.length, 1)
	assert.equal(activity.updates[0]?.text, "Checking the saved results.")
	assert.equal(activity.updates[0]?.source, "assistant_activity")
})

test("activity identities stay stable when the history window changes", async () => {
	const update = item(3, "assistant", [
		{ type: "text", channel: "commentary", text: "Checking results." },
	])
	const activity = async (older: boolean) =>
		readConversationActivity({
			chatId: "chat-a",
			read: fixture({
				pages: {
					first: {
						items: [
							update,
							...(older
								? [
										item(1, "assistant", [
											{ type: "text", text: "An older answer" },
										]),
									]
								: []),
						],
						next: null,
					},
				},
			}).read,
		})
	assert.equal(
		(await activity(false)).updates[0]?.id,
		(await activity(true)).updates[0]?.id,
	)
})

test("saved pending and denied plan results do not count as successful plans", async () => {
	for (const [name, output] of [
		["openbot_todos", { _tag: "Pending" }],
		["openbot_todos", { open: 1, done: 0 }],
		["openbot_submit_plan", { approved: false }],
		["openbot_submit_plan", { _tag: "Pending" }],
	] as const) {
		const source = fixture({
			pages: {
				first: { items: [result(2, name, output), call(1, name)], next: null },
			},
		})
		const activity = await readConversationActivity({
			chatId: "chat-a",
			read: source.read,
		})
		assert.equal(activity.plan.source, "none")
		assert.equal(activity.progress, null)
	}
})

test("foreground tools with saved results are visible without an invented execution", async () => {
	for (const value of [
		null,
		"done",
		["saved"],
		{ running: false, output: "saved", exitCode: 0 },
	]) {
		const name = "openbot_computer_exec"
		const source = fixture({
			pages: {
				first: {
					items: [
						result(2, name, value),
						call(1, name, { computer: "computer-a", command: "echo saved" }),
					],
					next: null,
				},
			},
		})
		const activity = await readConversationActivity({
			chatId: "chat-a",
			read: source.read,
		})
		assert.equal(activity.tools.length, 1)
		assert.deepEqual(activity.tools[0], {
			id: "history:item-1:0:0",
			executionId: null,
			turnId: "turn-a",
			itemId: "item-1",
			name,
			status: "completed",
			startedAt: null,
			completedAt: null,
			computerId: "computer-a",
			fileIds: [],
		})
		assert.ok(
			source.calls.every(
				(entry) =>
					entry.operation !== "feature" ||
					[
						"chats.chatTodos",
						"chats.chatDelegations",
						"toolCalls.list",
						"appOperations.list",
					].includes(entry.id ?? ""),
			),
		)
	}
})

test("repeated call IDs in different steps retain each result and device", async () => {
	const name = "openbot_computer_exec"
	const failed = result(4, name, { category: "external" })
	failed.content.content[0]!.content = [
		{
			type: "tool-result",
			id: "call-a",
			name,
			result: { category: "external" },
			isFailure: true,
		},
	]
	const source = fixture({
		pages: {
			first: {
				items: [
					failed,
					call(3, name, { computer: "computer-b" }),
					result(2, name, "saved"),
					call(1, name, { computer: "computer-a" }),
				],
				next: null,
			},
		},
	})
	const activity = await readConversationActivity({
		chatId: "chat-a",
		read: source.read,
	})
	assert.deepEqual(
		activity.tools.map(({ id, status, computerId, executionId }) => ({
			id,
			status,
			computerId,
			executionId,
		})),
		[
			{
				id: "history:item-1:0:0",
				status: "completed",
				computerId: "computer-a",
				executionId: null,
			},
			{
				id: "history:item-3:0:0",
				status: "failed",
				computerId: "computer-b",
				executionId: null,
			},
		],
	)
})

test("a durable record replaces only its exact foreground occurrence", async () => {
	const name = "openbot_computer_exec"
	const source = fixture({
		tools: [
			{
				...tool(name),
				position: { chat: "chat-a", turn: "turn-a", item: "item-3" },
			},
		],
		pages: {
			first: {
				items: [
					result(4, name, "second"),
					call(3, name, { computer: "computer-b" }),
					result(2, name, "first"),
					call(1, name, { computer: "computer-a" }),
				],
				next: null,
			},
		},
	})
	const activity = await readConversationActivity({
		chatId: "chat-a",
		read: source.read,
	})
	assert.equal(activity.tools.length, 2)
	assert.equal(activity.tools[0]?.executionId, null)
	assert.equal(activity.tools[0]?.computerId, "computer-a")
	assert.equal(activity.tools[1]?.id, "tool-a")
	assert.equal(activity.tools[1]?.executionId, "execution-a")
	assert.equal(activity.tools[1]?.computerId, "computer-b")
})

test("only the latest pending calls of a running Turn can be shown running", async () => {
	const name = "openbot_computer_exec"
	const running = { ...snapshot(), status: "Running" }
	const source = fixture({
		chat: running,
		pages: {
			first: {
				items: [
					call(3, name, { computer: "computer-a" }, "latest"),
					call(2, name, { computer: "computer-a" }, "older"),
					call(1, name, { computer: "computer-b" }, "old-turn", "turn-old"),
				],
				next: null,
			},
		},
	})
	const activity = await readConversationActivity({
		chatId: "chat-a",
		read: source.read,
	})
	assert.deepEqual(
		activity.tools.map(({ status }) => status),
		["outcome_unknown", "outcome_unknown", "running"],
	)
})

test("foreground pending and failed results preserve their saved meaning", async () => {
	const name = "openbot_computers_acquire"
	for (const [output, expected] of [
		[{ pending: true, note: "This call waits for a decision." }, "waiting"],
		[{ error: "Denied" }, "failed"],
		[{ denied: true }, "failed"],
	] as const) {
		const source = fixture({
			pages: {
				first: {
					items: [
						result(2, name, output),
						call(1, name, { computer: "computer-a" }),
					],
					next: null,
				},
			},
		})
		const activity = await readConversationActivity({
			chatId: "chat-a",
			read: source.read,
		})
		assert.equal(activity.tools[0]?.status, expected)
		assert.equal(activity.tools[0]?.executionId, null)
	}
})

test("a foreground export links only its own saved ready File", async () => {
	const name = "openbot_computer_export_file"
	const source = fixture({
		pages: {
			first: {
				items: [
					result(2, name, {
						file: { id: "file-a", status: "ready" },
						uri: "openbot-file:///file-a",
					}),
					call(1, name, {
						computer: "computer-a",
						path: "/workspace/report.txt",
					}),
				],
				next: null,
			},
		},
	})
	const activity = await readConversationActivity({
		chatId: "chat-a",
		read: source.read,
	})
	assert.equal(activity.tools[0]?.executionId, null)
	assert.deepEqual(activity.tools[0]?.fileIds, ["file-a"])
	assert.ok(!JSON.stringify(activity).includes("/workspace"))
})

test("mixed native and foreground activities follow saved item order", async () => {
	const name = "openbot_computer_exec"
	const source = fixture({
		tools: [
			{
				...tool(name),
				id: "native-late",
				callId: "last",
				position: { chat: "chat-a", turn: "turn-a", item: "item-5" },
			},
			{ ...tool(name), id: "native-early", callId: "first" },
		],
		pages: {
			first: {
				items: [
					result(6, name, "last", "last"),
					call(5, name, { computer: "computer-c" }, "last"),
					result(4, name, "middle", "middle"),
					call(3, name, { computer: "computer-b" }, "middle"),
					result(2, name, "first", "first"),
					call(1, name, { computer: "computer-a" }, "first"),
				],
				next: null,
			},
		},
	})
	const activity = await readConversationActivity({
		chatId: "chat-a",
		read: source.read,
	})
	assert.deepEqual(
		activity.tools.map(({ id }) => id),
		["native-early", "history:item-3:0:0", "native-late"],
	)
})

test("App names come from the exact saved operation without exposing arguments", async () => {
	const source = fixture({
		tools: [tool(appToolName)],
		apps: [appOperation()],
		pages: {
			first: {
				items: [
					result(2, appToolName, { operationId: "app-a" }),
					call(1, appToolName, { token: "not-for-activity" }),
				],
				next: null,
			},
		},
	})
	const activity = await readConversationActivity({
		chatId: "chat-a",
		read: source.read,
	})
	assert.equal(activity.tools[0]?.name, appToolName)
	assert.equal(activity.tools[0]?.displayName, "search_documents")
	assert.equal(activity.tools[0]?.appName, "Documents")
	assert.equal(activity.tools[0]?.executionId, "execution-a")
	assert.deepEqual(activity.appOperations[0], {
		id: "app-a",
		executionId: "execution-app-a",
		turnId: "turn-a",
		name: appToolName,
		displayName: "search_documents",
		appName: "Documents",
		status: "completed",
	})
	assert.equal(source.calls.length, 7)
	for (const excluded of ["not-for-activity", "definition", "connectionName"])
		assert.ok(!JSON.stringify(activity).includes(excluded))
})

test("repeated call IDs use each occurrence's operation ID for App names", async () => {
	const name = "selected_action"
	const source = fixture({
		apps: [
			{ ...appOperation("app-a", "first_action", "First App"), toolName: name },
			{
				...appOperation("app-b", "second_action", "Second App"),
				toolName: name,
			},
		],
		pages: {
			first: {
				items: [
					result(4, name, { operationId: "app-b" }),
					call(3, name, {}),
					result(2, name, { operationId: "app-a" }),
					call(1, name, {}),
				],
				next: null,
			},
		},
	})
	const activity = await readConversationActivity({
		chatId: "chat-a",
		read: source.read,
	})
	assert.deepEqual(
		activity.tools.map(({ displayName, appName }) => ({
			displayName,
			appName,
		})),
		[
			{ displayName: "first_action", appName: "First App" },
			{ displayName: "second_action", appName: "Second App" },
		],
	)
})

test("an unfinished App call uses only its unique saved invocation", async () => {
	for (const status of ["running", "waiting", "failed"]) {
		const source = fixture({
			tools: [tool(appToolName, status)],
			apps: [{ ...appOperation(), status }],
			pages: { first: { items: [call(1, appToolName, {})], next: null } },
		})
		const activity = await readConversationActivity({
			chatId: "chat-a",
			read: source.read,
		})
		assert.equal(activity.tools[0]?.displayName, "search_documents")
		assert.equal(activity.tools[0]?.appName, "Documents")
		assert.equal(activity.tools[0]?.status, status)
	}
})

test("partial history needs an exact operation ID before naming an App call", async () => {
	for (const withResult of [false, true]) {
		const source = fixture({
			apps: [appOperation()],
			pages: {
				first: {
					items: [
						...(withResult
							? [result(4, appToolName, { operationId: "app-a" })]
							: []),
						call(3, appToolName, {}),
						result(2),
						call(1),
					],
					next: 1,
				},
			},
		})
		const activity = await readConversationActivity({
			chatId: "chat-a",
			read: source.read,
		})
		assert.equal(activity.history.complete, false)
		assert.equal(
			activity.tools.find((entry) => entry.name === appToolName)?.displayName,
			withResult ? "search_documents" : undefined,
		)
	}
})

test("ambiguous calls and unrelated operations do not supply tool labels", async () => {
	const savedCall = call(1, appToolName, {})
	for (const options of [
		{
			apps: [appOperation(), appOperation("app-b")],
			items: [savedCall],
		},
		{
			apps: [appOperation()],
			items: [call(3, appToolName, {}), savedCall],
		},
		{
			apps: [appOperation()],
			items: [
				result(3, appToolName, { operationId: "app-b" }),
				result(2, appToolName, { operationId: "app-a" }),
				savedCall,
			],
		},
		{
			apps: [{ ...appOperation(), turn: "other-turn" }],
			items: [result(2, appToolName, { operationId: "app-a" }), savedCall],
		},
		{
			apps: [{ ...appOperation(), callId: "other-call" }],
			items: [result(2, appToolName, { operationId: "app-a" }), savedCall],
		},
		{
			apps: [{ ...appOperation(), toolName: "other_action" }],
			items: [result(2, appToolName, { operationId: "app-a" }), savedCall],
		},
		{
			apps: [appOperation()],
			items: [
				result(2, appToolName, { operationId: "missing-app" }),
				savedCall,
			],
		},
	]) {
		const source = fixture({
			apps: options.apps,
			pages: { first: { items: options.items, next: null } },
		})
		const activity = await readConversationActivity({
			chatId: "chat-a",
			read: source.read,
		})
		for (const entry of activity.tools) {
			assert.equal("displayName" in entry, false)
			assert.equal("appName" in entry, false)
		}
	}
})

test("App metadata remains optional for older records", async () => {
	const source = fixture({
		apps: [
			{
				id: "app-a",
				executionId: "execution-app-a",
				chat: "chat-a",
				turn: "turn-a",
				toolName: appToolName,
				status: "completed",
			},
		],
		pages: {
			first: {
				items: [
					result(2, appToolName, { operationId: "app-a" }),
					call(1, appToolName, {}),
				],
				next: null,
			},
		},
	})
	const activity = await readConversationActivity({
		chatId: "chat-a",
		read: source.read,
	})
	assert.equal("displayName" in activity.tools[0]!, false)
	assert.equal("appName" in activity.tools[0]!, false)
	assert.equal("displayName" in activity.appOperations[0]!, false)
	assert.equal("appName" in activity.appOperations[0]!, false)
})

test("App subcalls do not rename an entire code run", async () => {
	const name = "openbot_run_code"
	const source = fixture({
		apps: [{ ...appOperation(), toolName: name }],
		pages: {
			first: {
				items: [result(2, name, { operationId: "app-a" }), call(1, name, {})],
				next: null,
			},
		},
	})
	const activity = await readConversationActivity({
		chatId: "chat-a",
		read: source.read,
	})
	assert.equal(activity.tools[0]?.name, name)
	assert.equal("displayName" in activity.tools[0]!, false)
	assert.equal("appName" in activity.tools[0]!, false)
	assert.equal(activity.appOperations[0]?.displayName, "search_documents")
})
