import assert from "node:assert/strict"
import { setImmediate } from "node:timers/promises"
import { test } from "node:test"
import { BrowserCrypto } from "@effect/platform-browser"
import { ExecutionsApi } from "@openbot-build/client/Api"
import { Chats, Executions, layer } from "@openbot-build/client"
import { Chat } from "@openbot-build/client/Core"
import { Effect, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { ExecutionFailed, waitForExecution } from "../src/lib/execution.ts"

const { Execution } = ExecutionsApi
const baseUrl = "https://openbot.test"
const receipt = Schema.decodeUnknownSync(Execution.Receipt)({
	executionId: "work",
	commandKey: "command",
	sequence: 3,
})
const record = (
	status: ExecutionsApi.Execution.Status,
	failure: ExecutionsApi.Execution.Failure | null = null,
) => ({
	id: receipt.executionId,
	resource: { kind: "ChatControl", id: "chat" },
	status,
	sequence: 5,
	createdAt: 1,
	updatedAt: 2,
	failure,
})
const stateEvent = (
	sequence: number,
	status: ExecutionsApi.Execution.Status,
	failure: ExecutionsApi.Execution.Failure | null = null,
) =>
	`event: execution\nid: ${sequence}\ndata: ${JSON.stringify({
		executionId: receipt.executionId,
		sequence,
		createdAt: 1,
		body: { _tag: "State", status, failure },
	})}\n\n`
const eventResponse = (body: string | ReadableStream<Uint8Array>) =>
	new Response(body, { headers: { "content-type": "text/event-stream" } })

test("waits for completion from the receipt cursor", async (t) => {
	const seen: Array<string> = []
	t.mock.method(
		globalThis,
		"fetch",
		async (
			input: Parameters<typeof fetch>[0],
			init?: Parameters<typeof fetch>[1],
		) => {
			const request = new Request(input, init)
			const url = new URL(request.url)
			seen.push(url.pathname + url.search)
			assert.equal(request.headers.get("OpenBot-Organization"), "team")
			if (url.pathname.endsWith("/observe"))
				return eventResponse(stateEvent(5, "completed"))
			return Response.json(record("completed"))
		},
	)

	const result = await Effect.runPromise(
		waitForExecution(receipt).pipe(
			Effect.provide(layer({ baseUrl, organization: "team" })),
			Effect.provideService(FetchHttpClient.Fetch, globalThis.fetch),
		),
	)

	assert.equal(result.status, "completed")
	assert.deepEqual(seen, [
		"/v1/executions/work/observe?afterSequence=3",
		"/v1/executions/work",
	])
})

test("keeps the failure record when work fails", async (t) => {
	const failure = {
		errorId: Execution.ErrorId.make("error"),
		category: "external" as const,
	}
	t.mock.method(
		globalThis,
		"fetch",
		async (
			input: Parameters<typeof fetch>[0],
			init?: Parameters<typeof fetch>[1],
		) => {
			const request = new Request(input, init)
			return new URL(request.url).pathname.endsWith("/observe")
				? eventResponse(stateEvent(5, "failed", failure))
				: Response.json(record("failed", failure))
		},
	)

	const result = await Effect.runPromise(
		waitForExecution(receipt).pipe(
			Effect.result,
			Effect.provide(layer({ baseUrl })),
			Effect.provideService(FetchHttpClient.Fetch, globalThis.fetch),
		),
	)

	assert.ok(result._tag === "Failure")
	assert.ok(result.failure instanceof ExecutionFailed)
	assert.equal(result.failure.executionId, receipt.executionId)
	assert.equal(result.failure.status, "failed")
	assert.deepEqual(result.failure.failure, failure)
	assert.match(result.failure.message, /Error ID: error/)
})

test("a cancel waits until the work releases its resources", async (t) => {
	const encoder = new TextEncoder()
	let signalObserved!: () => void
	const observed = new Promise<void>((resolve) => {
		signalObserved = resolve
	})
	let finish: (() => void) | undefined
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(encoder.encode(stateEvent(4, "cancelling")))
			finish = () => {
				controller.enqueue(encoder.encode(stateEvent(5, "cancelled")))
				controller.close()
			}
		},
	})
	const seen: Array<string> = []
	t.mock.method(
		globalThis,
		"fetch",
		async (
			input: Parameters<typeof fetch>[0],
			init?: Parameters<typeof fetch>[1],
		) => {
			const request = new Request(input, init)
			const url = new URL(request.url)
			seen.push(url.pathname)
			if (url.pathname.endsWith("/cancel")) {
				assert.deepEqual(await request.json(), {
					commandKey: receipt.commandKey,
				})
				return Response.json(receipt)
			}
			if (url.pathname.endsWith("/observe")) {
				signalObserved()
				return eventResponse(stream)
			}
			return Response.json(record("cancelled"))
		},
	)

	let done = false
	const pending = Effect.runPromise(
		Effect.gen(function* () {
			const command = yield* Executions.cancel(
				receipt.executionId,
				receipt.commandKey,
			)
			return yield* waitForExecution(yield* command.send, {
				success: ["completed", "cancelled"],
			})
		}).pipe(
			Effect.provide(layer({ baseUrl })),
			Effect.provideService(FetchHttpClient.Fetch, globalThis.fetch),
			Effect.provide(BrowserCrypto.layer),
		),
	).then((value) => {
		done = true
		return value
	})

	try {
		await observed
		await setImmediate()
		assert.equal(done, false)
		assert.deepEqual(seen, [
			"/v1/executions/work/cancel",
			"/v1/executions/work/observe",
		])
	} finally {
		finish?.()
	}
	assert.equal((await pending).status, "cancelled")
	assert.equal(seen.at(-1), "/v1/executions/work")
})

test("message retries keep the same command key after a lost reply", async (t) => {
	const bodies: Array<unknown> = []
	t.mock.method(
		globalThis,
		"fetch",
		async (
			input: Parameters<typeof fetch>[0],
			init?: Parameters<typeof fetch>[1],
		) => {
			const request = new Request(input, init)
			assert.equal(new URL(request.url).pathname, "/v1/chats/chat/messages")
			bodies.push(await request.json())
			if (bodies.length === 1) throw new TypeError("The reply was lost.")
			return Response.json(
				{ ...receipt, chat: "chat", turn: "turn" },
				{ status: 202 },
			)
		},
	)

	const result = await Effect.runPromise(
		Effect.gen(function* () {
			const command = yield* Chats.message(Chat.Id.make("chat"), {
				input: "Hello",
			})
			return { key: command.commandKey, receipt: yield* command.send }
		}).pipe(
			Effect.provide(layer({ baseUrl })),
			Effect.provideService(FetchHttpClient.Fetch, globalThis.fetch),
			Effect.provide(BrowserCrypto.layer),
		),
	)

	assert.equal(bodies.length, 2)
	assert.deepEqual(bodies, [
		{ input: "Hello", commandKey: result.key },
		{ input: "Hello", commandKey: result.key },
	])
	assert.equal(result.receipt.executionId, receipt.executionId)
})
