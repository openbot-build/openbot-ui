import assert from "node:assert/strict"
import { test } from "node:test"
import type { NativeCall } from "@kaicom/kay-contracts/Native"
import { observeChat } from "../src/ObserveChat.ts"

const snapshot = {
	chat: { id: "chat-a" },
	turn: { id: "turn-a", chat: "chat-a" },
	executionId: "exec-a",
	activeExecution: { id: "exec-a", sequence: 12, status: "running" },
}
const execution = {
	id: "exec-a",
	sequence: 13,
	status: "running",
	resource: { kind: "Turn", id: "turn-a" },
}

test("refresh observes the authorized current Turn after its saved cursor", async () => {
	const calls: NativeCall[] = []
	let observation: unknown
	const response = await observeChat({
		chatId: "chat-a",
		client: {
			request: async (call) => {
				calls.push(call)
				return Response.json(call.operation === "chat" ? snapshot : execution)
			},
		},
		observe: async (id, cursor) => {
			observation = [id, cursor]
			return new Response("")
		},
	})
	assert.equal(response.status, 200)
	const text = await response.text()
	assert.match(text, /response.checkpoint/)
	assert.doesNotMatch(text, /accepted|commandKey/)
	assert.deepEqual(observation, ["exec-a", 12])
	assert.deepEqual(
		calls.map((call) => call.operation),
		["chat", "execution"],
	)
})

test("idle and older Core snapshots return no subscription and perform no writes", async () => {
	const response = await observeChat({
		chatId: "chat-a",
		client: {
			request: async () =>
				Response.json({ chat: { id: "chat-a" }, turn: null }),
		},
		observe: async () => {
			throw new Error("Must not observe")
		},
	})
	assert.equal(response.status, 204)
})

test("completed executions return idle after checking their Turn ownership", async () => {
	for (const status of ["completed", "failed", "cancelled", "interrupted"]) {
		const calls: NativeCall[] = []
		const response = await observeChat({
			chatId: "chat-a",
			client: {
				request: async (call) => {
					calls.push(call)
					// The execution may finish after the Chat cursor was read.
					return Response.json(
						call.operation === "chat" ? snapshot : { ...execution, status },
					)
				},
			},
			observe: async () => {
				throw new Error("A terminal execution must not be observed")
			},
		})
		assert.equal(response.status, 204)
		assert.deepEqual(
			calls.map((call) => call.operation),
			["chat", "execution"],
		)
	}
	const response = await observeChat({
		chatId: "chat-a",
		client: {
			request: async (call) =>
				Response.json(
					call.operation === "chat"
						? snapshot
						: {
								...execution,
								status: "completed",
								resource: { kind: "Turn", id: "other" },
							},
				),
		},
		observe: async () => {
			throw new Error("A foreign execution must not be observed")
		},
	})
	assert.equal(response.status, 502)
})

test("closing a refreshed Chat subscription aborts only its observation", async () => {
	const calls: NativeCall[] = []
	let observationSignal: AbortSignal | undefined
	const response = await observeChat({
		chatId: "chat-a",
		client: {
			request: async (call) => {
				calls.push(call)
				return Response.json(call.operation === "chat" ? snapshot : execution)
			},
		},
		observe: async (_id, _cursor, signal) => {
			observationSignal = signal
			return new Response(new ReadableStream({ start() {} }))
		},
	})
	await response.body!.cancel()
	assert.equal(observationSignal?.aborted, true)
	assert.deepEqual(
		calls.map((call) => call.operation),
		["chat", "execution"],
	)
})

test("chat permissions and execution identity are checked before observation", async () => {
	for (const status of [401, 403, 404]) {
		const response = await observeChat({
			chatId: "chat-a",
			client: { request: async () => new Response(null, { status }) },
			observe: async () => {
				throw new Error("Must not observe")
			},
		})
		assert.equal(response.status, status)
	}
	for (const [chat, state] of [
		[{ ...snapshot, chat: { id: "other" } }, execution],
		[{ ...snapshot, executionId: "other" }, execution],
		[snapshot, { ...execution, resource: { kind: "Turn", id: "other" } }],
		[snapshot, { ...execution, sequence: 11 }],
		[snapshot, { ...execution, id: "other" }],
	] as const) {
		let observed = false
		const response = await observeChat({
			chatId: "chat-a",
			client: {
				request: async (call) =>
					Response.json(call.operation === "chat" ? chat : state),
			},
			observe: async () => {
				observed = true
				return new Response("")
			},
		})
		assert.equal(response.status, 502)
		assert.equal(observed, false)
	}
})
