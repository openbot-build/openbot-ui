import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { setImmediate } from "node:timers/promises"
import { after, mock, test } from "node:test"
import { ChatView } from "@openbot-build/client/Api"
import { Schema } from "effect"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import type { ChatState } from "../src/atoms/chat.ts"

const hooks = registerHooks({
	resolve(specifier, context, nextResolve) {
		return nextResolve(
			specifier.startsWith("@/")
				? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href
				: specifier,
			context,
		)
	},
})
let handleFetch: (request: Request) => Promise<Response> = async (request) => {
	throw new Error(`Unexpected request: ${request.url}`)
}
mock.method(
	globalThis,
	"fetch",
	(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
		handleFetch(new Request(input, init)),
)
Object.defineProperty(globalThis, "location", {
	configurable: true,
	value: new URL("https://openbot.test"),
})
after(() => {
	hooks.deregister()
	mock.restoreAll()
	Reflect.deleteProperty(globalThis, "location")
})
const { chatAtom, chatWatcherAtom, sendMessageAtom } =
	await import("../src/atoms/chat.ts")

const deferred = <A>() => {
	let resolve!: (value: A) => void
	const promise = new Promise<A>((done) => {
		resolve = done
	})
	return { promise, resolve }
}
const chatId = "chat"
const view = Schema.decodeUnknownSync(ChatView)({
	chat: {
		id: chatId,
		revision: 1,
		kind: "direct",
		bot: "bot",
		parent: null,
		settings: { mode: "build" },
		createdAt: 1,
	},
	status: "Running",
	turn: null,
	response: null,
	executionId: "execution",
	inbox: 0,
	open: { delegations: 0, requests: 0, reminders: 0 },
})
const receipt = (commandKey: string) =>
	Response.json(
		{
			executionId: "execution",
			commandKey,
			sequence: 1,
			chat: chatId,
			turn: "turn",
		},
		{ status: 202 },
	)
const terminal = () =>
	`event: execution\nid: 2\ndata: ${JSON.stringify({
		executionId: "execution",
		sequence: 2,
		createdAt: 1,
		body: { _tag: "State", status: "completed", failure: null },
	})}\n\n`
const events = (body: string | ReadableStream<Uint8Array>) =>
	new Response(body, { headers: { "content-type": "text/event-stream" } })
const savedChat = (request: Request) => {
	const path = new URL(request.url).pathname
	if (path.endsWith("/items"))
		return Response.json({
			items: [{ id: "saved", seq: 1, content: { content: [] } }],
			next: null,
		})
	if (path.endsWith("/turns")) return Response.json({ items: [], next: null })
	if (path.endsWith("/tool-calls")) return Response.json([])
	if (path === `/v1/chats/${chatId}`)
		return Response.json({ ...view, status: "Idle", executionId: null })
	throw new Error(`Unexpected request: ${path}`)
}
const waitForChat = (
	registry: AtomRegistry.AtomRegistry,
	predicate: (state: ChatState) => boolean,
) => {
	const atom = chatAtom(chatId)
	const current = registry.get(atom)
	if (predicate(current)) return Promise.resolve(current)
	return new Promise<ChatState>((resolve) => {
		const unsubscribe = registry.subscribe(atom, (state) => {
			if (!predicate(state)) return
			unsubscribe()
			resolve(state)
		})
	})
}

for (const oldResult of ["receipt", "failure"] as const)
	test(
		`an old ${oldResult} cannot replace the next message`,
		{ timeout: 5_000 },
		async (t) => {
			const registry = AtomRegistry.make()
			t.after(() => registry.dispose())
			const oldReply = deferred<Response>()
			const oldPosted = deferred<void>()
			const stream = deferred<ReadableStreamDefaultController<Uint8Array>>()
			const body = new ReadableStream<Uint8Array>({ start: stream.resolve })
			const keys: Array<string> = []
			handleFetch = async (request) => {
				const path = new URL(request.url).pathname
				if (path.endsWith("/messages")) {
					const payload = await request.json()
					keys.push(payload.commandKey)
					if (payload.input === "First") {
						oldPosted.resolve()
						return oldReply.promise
					}
					return receipt(payload.commandKey)
				}
				if (path.endsWith("/observe")) return events(body)
				return savedChat(request)
			}

			registry.set(sendMessageAtom, { id: chatId, text: "First" })
			await oldPosted.promise
			registry.set(sendMessageAtom, { id: chatId, text: "Second" })
			const current = await waitForChat(
				registry,
				(state) => state.streaming?.status === "streaming",
			)
			assert.equal(current.streaming?.input, "Second")
			oldReply.resolve(
				oldResult === "receipt"
					? receipt(keys[0]!)
					: Response.json({ _tag: "ExecutionKeyConflict" }, { status: 409 }),
			)
			await setImmediate()
			await setImmediate()
			const latest = registry.get(chatAtom(chatId)).streaming
			assert.equal(latest?.input, "Second")
			assert.equal(latest?.status, "streaming")
			assert.equal(latest?.request, current.streaming?.request)
			assert.equal(latest?.receipt?.commandKey, keys[1])
			const controller = await stream.promise
			controller.enqueue(new TextEncoder().encode(terminal()))
			controller.close()
			await waitForChat(
				registry,
				(state) =>
					state.history[0]?.id === "saved" && state.streaming === undefined,
			)
		},
	)

test(
	"Try again keeps the command key after an unknown network result",
	{ timeout: 5_000 },
	async (t) => {
		const registry = AtomRegistry.make()
		t.after(() => registry.dispose())
		let online = false
		const keys: Array<string> = []
		handleFetch = async (request) => {
			const path = new URL(request.url).pathname
			if (path.endsWith("/messages")) {
				const payload = await request.json()
				keys.push(payload.commandKey)
				if (!online) throw new TypeError("The reply was lost.")
				return receipt(payload.commandKey)
			}
			if (path.endsWith("/observe")) return events(terminal())
			return savedChat(request)
		}

		registry.set(sendMessageAtom, { id: chatId, text: "Hello" })
		const failed = await waitForChat(
			registry,
			(state) => state.streaming?.status === "failed",
		)
		const key = failed.streaming?.commandKey
		assert.ok(key)
		assert.equal(failed.streaming?.receipt, undefined)
		online = true
		registry.set(sendMessageAtom, { id: chatId, text: "Hello" })
		await waitForChat(
			registry,
			(state) =>
				state.history[0]?.id === "saved" && state.streaming === undefined,
		)
		assert.equal(keys.length, 4)
		assert.ok(keys.every((value) => value === key))
	},
)

test(
	"retrying an accepted message observes it without sending it again",
	{ timeout: 5_000 },
	async (t) => {
		const registry = AtomRegistry.make()
		t.after(() => registry.dispose())
		let online = false
		let posts = 0
		let observations = 0
		handleFetch = async (request) => {
			const path = new URL(request.url).pathname
			if (path.endsWith("/messages")) {
				posts++
				return receipt((await request.json()).commandKey)
			}
			if (path.endsWith("/observe")) observations++
			if (!online) throw new TypeError("The connection was lost.")
			if (path.endsWith("/observe")) return events(terminal())
			return savedChat(request)
		}

		registry.set(sendMessageAtom, { id: chatId, text: "Hello" })
		const failed = await waitForChat(
			registry,
			(state) =>
				state.streaming?.status === "failed" && state.error !== undefined,
		)
		assert.ok(failed.streaming?.receipt)
		online = true
		registry.set(sendMessageAtom, { id: chatId, text: "Hello" })
		await waitForChat(
			registry,
			(state) =>
				state.history[0]?.id === "saved" && state.streaming === undefined,
		)
		assert.equal(posts, 1)
		assert.equal(observations, 4)
	},
)

test(
	"a failed observer refreshes saved history when the network returns",
	{ timeout: 5_000 },
	async (t) => {
		const registry = AtomRegistry.make()
		t.after(() => registry.dispose())
		registry.set(chatAtom(chatId), { ...registry.get(chatAtom(chatId)), view })
		let online = false
		let posts = 0
		handleFetch = async (request) => {
			const path = new URL(request.url).pathname
			if (path.endsWith("/messages")) {
				posts++
				return receipt((await request.json()).commandKey)
			}
			if (!online) throw new TypeError("The connection was lost.")
			return savedChat(request)
		}

		registry.set(sendMessageAtom, { id: chatId, text: "Hello" })
		await waitForChat(
			registry,
			(state) =>
				state.streaming?.status === "failed" && state.error !== undefined,
		)
		online = true
		const unmount = registry.mount(chatWatcherAtom(chatId))
		t.after(unmount)
		const refreshed = await waitForChat(
			registry,
			(state) =>
				state.history[0]?.id === "saved" && state.streaming === undefined,
		)
		assert.equal(refreshed.error, undefined)
		assert.equal(posts, 1)
	},
)
