import assert from "node:assert/strict"
import { test } from "node:test"
import type * as Product from "@kaicom/kay-contracts"
import { RequestFailed } from "@kaicom/kay-contracts/Client"
import {
	messageRecoveryKey,
	messageWasRejected,
	readMessageRecoveries,
	recoverMessage,
	writeMessageRecoveries,
	type MessageSnapshot,
	type PendingSend,
} from "../src/next/MessageRecovery.ts"

test("only explicit client errors establish that a message was rejected", () => {
	for (const [status, code] of [
		[400, "invalid_input"],
		[401, "unauthorized"],
		[403, "forbidden"],
		[409, "conflict"],
	] as const) {
		assert.equal(
			messageWasRejected(
				new RequestFailed(status, { code, message: "Rejected" }),
			),
			true,
		)
	}
	for (const status of [0, 500, 503]) {
		assert.equal(
			messageWasRejected(
				new RequestFailed(status, {
					code: "unavailable",
					message: "The proxy or server failed",
				}),
			),
			false,
		)
	}
	for (const status of [0, 400, 409, 500]) {
		assert.equal(
			messageWasRejected(
				new RequestFailed(status, {
					code: "outcome_unknown",
					message: "Receipt could not be read",
				}),
			),
			false,
		)
	}
	for (const error of [
		new TypeError("Failed to fetch"),
		new SyntaxError("Invalid receipt JSON"),
		new Error("Disconnected"),
		{ status: 403, problem: { code: "forbidden" } },
		null,
	]) {
		assert.equal(messageWasRejected(error), false)
	}
})

const pending: PendingSend = {
	id: "send-a",
	viewKey: "conversation:chat-a",
	chatId: "chat-a",
	botId: "bot-a",
	accepted: true,
	turnId: "turn-a",
	itemId: null,
}

const turn = (
	id: string,
	status: typeof Product.Turn.Type.status = "Completed",
): typeof Product.Turn.Type => ({
	id,
	chatId: "chat-a",
	status,
	startedAt: 1,
	completedAt: status === "Running" ? null : 2,
	inputItemIds: ["input-" + id],
	itemIds: ["output-" + id],
})

const snapshot = (
	items: ReadonlyArray<typeof Product.Turn.Type>,
	next: string | null = null,
): MessageSnapshot => ({
	chat: {
		id: "chat-a",
		botId: "bot-a",
		kind: "conversation",
		revision: 7,
		title: "A",
		status: "Completed",
		activity: "active",
		createdAt: 1,
		branch: null,
		memory: { read: true, write: true },
		queuedInputs: 0,
		activeTurnId: null,
		openWork: { tasks: 0, approvals: 0, reminders: 0 },
	},
	turns: { items, next },
})

const defaults = (controller = new AbortController()) => ({
	pending,
	signal: controller.signal,
	read: async (): Promise<MessageSnapshot> => snapshot([turn("turn-a")]),
	turns: async (): Promise<typeof Product.TurnPage.Type> =>
		assert.fail("No history page was expected"),
	findDirect: async (): Promise<string | undefined> =>
		assert.fail("No Bot lookup was expected"),
	wait: async (): Promise<unknown> => assert.fail("No wait was expected"),
	delay: async (): Promise<void> => assert.fail("No retry was expected"),
})

test("a lost receipt is recovered by command identity without sending another message", async () => {
	let reads = 0,
		pauses = 0
	await recoverMessage({
		...defaults(),
		pending: {
			...pending,
			accepted: false,
			turnId: null,
			commandKey: "command-a",
		},
		commandReceipt: async (key) => {
			assert.equal(key, "command-a")
			return { executionId: "execution-a", commandKey: key, sequence: 1 }
		},
		execution: async (id) => {
			assert.equal(id, "execution-a")
			reads++
			return {
				id,
				resource: { kind: "Chat", id: "chat-a" },
				status: reads === 1 ? "running" : "completed",
				sequence: reads,
				createdAt: 1,
				updatedAt: 2,
				failure: null,
			}
		},
		delay: async () => {
			pauses++
		},
	})
	assert.equal(reads, 2)
	assert.equal(pauses, 1)
})

test("an accepted execution with no Turn waits for durable completion", async () => {
	let reads = 0
	await recoverMessage({
		...defaults(),
		pending: { ...pending, turnId: null, executionId: "execution-a" },
		execution: async (id) => ({
			id,
			resource: { kind: "Chat", id: "chat-a" },
			status: ++reads < 3 ? "queued" : "waiting",
			sequence: reads,
			createdAt: 1,
			updatedAt: 2,
			failure: null,
		}),
		delay: async () => {},
	})
	assert.equal(reads, 3)
})

test("a completed queue command follows its moved input to the actual Turn", async () => {
	const reads: string[] = []
	await recoverMessage({
		...defaults(),
		pending: { ...pending, turnId: null, executionId: "queued-a" },
		execution: async (id) => {
			reads.push(id)
			return id === "queued-a"
				? {
						id,
						resource: { kind: "Chat", id: "chat-a" },
						status: "completed",
						forwardedTo: "execution-a",
						sequence: 3,
						createdAt: 1,
						updatedAt: 2,
						failure: null,
					}
				: {
						id,
						resource: { kind: "Turn", id: "turn-a" },
						status: reads.length < 3 ? "running" : "completed",
						sequence: 5,
						createdAt: 1,
						updatedAt: 2,
						failure: null,
					}
		},
		delay: async () => {},
	})
	assert.deepEqual(reads, ["queued-a", "execution-a", "execution-a"])
})

test("message recovery stores only identities and remains separate across accounts and chats", () => {
	const values = new Map<string, string>()
	const storage = {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value)
		},
		removeItem: (key: string) => {
			values.delete(key)
		},
	}
	const key = messageRecoveryKey("org:user")
	const other = {
		...pending,
		id: "send-b",
		viewKey: "conversation:chat-b",
		chatId: "chat-b",
	}
	writeMessageRecoveries({
		storage,
		key,
		value: [
			{ ...pending, ...{ input: "private text", apiKey: "secret" } },
			other,
		],
	})
	assert.deepEqual(readMessageRecoveries({ storage, key }), [pending, other])
	assert.equal(values.get(key)?.includes("private text"), false)
	assert.equal(values.get(key)?.includes("secret"), false)
	assert.deepEqual(
		readMessageRecoveries({ storage, key: messageRecoveryKey("org:other") }),
		[],
	)
	writeMessageRecoveries({ storage, key, value: [other] })
	assert.deepEqual(readMessageRecoveries({ storage, key }), [other])
	writeMessageRecoveries({ storage, key, value: [] })
	assert.equal(values.has(key), false)
})

test("invalid and legacy storage cannot create accepted message receipts", () => {
	for (const raw of [
		"true",
		"null",
		"{",
		JSON.stringify([{ ...pending, accepted: "true" }]),
		JSON.stringify([{ ...pending, input: "private" }]),
		JSON.stringify([{ ...pending, id: "" }]),
	]) {
		assert.deepEqual(
			readMessageRecoveries({ storage: { getItem: () => raw }, key: "key" }),
			[],
		)
	}
	assert.deepEqual(
		readMessageRecoveries({
			storage: {
				getItem: () => {
					throw new Error("Denied")
				},
			},
			key: "key",
		}),
		[],
	)
	assert.doesNotThrow(() =>
		writeMessageRecoveries({
			storage: {
				setItem: () => {
					throw new Error("Denied")
				},
				removeItem: () => {
					throw new Error("Denied")
				},
			},
			key: "key",
			value: [pending],
		}),
	)
})

for (const status of ["Completed", "Failed", "Interrupted"] as const) {
	test(`the saved ${status} state ends recovery for the exact stream Turn`, async () => {
		const seen: string[] = []
		await recoverMessage({
			...defaults(),
			read: async () => snapshot([turn("turn-a", status)]),
			onSnapshot: (value) => {
				seen.push(value.chat.id)
			},
		})
		assert.deepEqual(seen, ["chat-a"])
	})
}

test("an old completed Turn cannot clear a newer running send", async () => {
	const calls: string[] = []
	let reads = 0
	await recoverMessage({
		...defaults(),
		read: async () => {
			calls.push("read")
			return snapshot([
				turn("old-turn"),
				turn("turn-a", ++reads === 1 ? "Running" : "Completed"),
			])
		},
		wait: async (id, revision) => {
			calls.push(`wait:${id}:${revision}`)
		},
		delay: async (milliseconds) => {
			calls.push(`delay:${milliseconds}`)
		},
	})
	assert.deepEqual(calls, ["read", "wait:chat-a:7", "delay:1000", "read"])
})

test("recovery searches older pages for its Turn without confusing another Chat", async () => {
	const pages: string[] = []
	await recoverMessage({
		...defaults(),
		read: async () =>
			snapshot(
				Array.from({ length: 45 }, (_, index) => turn(`recent-${index}`)),
				"older",
			),
		turns: async (id, cursor) => {
			assert.equal(id, "chat-a")
			pages.push(cursor)
			return cursor === "older"
				? { items: [{ ...turn("turn-a"), chatId: "chat-b" }], next: "oldest" }
				: { items: [turn("turn-a")], next: null }
		},
	})
	assert.deepEqual(pages, ["older", "oldest"])
})

test("a missing Turn remains pending despite a completed Chat", async () => {
	const controller = new AbortController()
	let waits = 0
	await assert.rejects(
		recoverMessage({
			...defaults(controller),
			read: async () => snapshot([turn("old-turn")]),
			wait: async () => {
				waits++
				controller.abort()
			},
		}),
		{ name: "AbortError" },
	)
	assert.equal(waits, 1)
})

test("successful stream headers restore observation even when no event arrived", async () => {
	let reads = 0
	await recoverMessage({
		...defaults(),
		pending: { ...pending, turnId: null },
		read: async () => {
			reads++
			return snapshot([])
		},
	})
	assert.equal(reads, 1)
})

test("a direct Chat can be found after its accepted response lost the first event", async () => {
	let finds = 0
	const reads: string[] = []
	const delays: number[] = []
	await recoverMessage({
		...defaults(),
		pending: { ...pending, chatId: null, turnId: null },
		findDirect: async (id) => {
			assert.equal(id, "bot-a")
			return ++finds <= 6 ? undefined : "chat-a"
		},
		delay: async (milliseconds) => {
			delays.push(milliseconds)
		},
		read: async (id) => {
			reads.push(id)
			return snapshot([])
		},
	})
	assert.deepEqual(reads, ["chat-a"])
	assert.equal(finds, 7)
	assert.deepEqual(delays, [1_000, 2_000, 4_000, 8_000, 15_000, 15_000])
})

test("queued and steered receipts restore observation without claiming execution has ended", async () => {
	for (const turnId of [null, "turn-a"]) {
		const running = snapshot([turn("turn-a", "Running")])
		const seen: MessageSnapshot[] = []
		await recoverMessage({
			...defaults(),
			pending: { ...pending, turnId, itemId: "accepted-input" },
			read: async () => ({
				...running,
				chat: { ...running.chat, status: "Running", queuedInputs: 1 },
			}),
			onSnapshot: (value) => {
				seen.push(value)
			},
		})
		assert.equal(seen[0]?.chat.status, "Running")
		assert.equal(seen[0]?.chat.queuedInputs, 1)
	}
})

test("an unacknowledged send never resolves from saved history or submits again", async () => {
	const controller = new AbortController()
	let reads = 0
	let delays = 0
	let waits = 0
	await assert.rejects(
		recoverMessage({
			...defaults(controller),
			pending: { ...pending, accepted: false },
			read: async () => {
				reads++
				return snapshot([turn("turn-a")])
			},
			wait: async (id, revision) => {
				assert.equal(id, "chat-a")
				assert.equal(revision, 7)
				assert.equal(reads, ++waits)
			},
			delay: async () => {
				if (++delays === 3) controller.abort()
			},
		}),
		{ name: "AbortError" },
	)
	assert.equal(reads, 3)
	assert.equal(waits, 3)
	assert.equal(delays, 3)
})

test("an unacknowledged send waits for a revision before reading again", async () => {
	const controller = new AbortController()
	const entered = Promise.withResolvers<void>()
	const waiting = Promise.withResolvers<void>()
	let reads = 0
	let delays = 0
	const recovery = recoverMessage({
		...defaults(controller),
		pending: { ...pending, accepted: false },
		read: async () => {
			reads++
			return snapshot([turn("turn-a")])
		},
		wait: async () => {
			entered.resolve()
			await waiting.promise
		},
		delay: async () => {
			delays++
		},
	})
	await entered.promise
	await Promise.resolve()
	assert.equal(reads, 1)
	assert.equal(delays, 0)
	controller.abort()
	waiting.resolve()
	await assert.rejects(recovery, { name: "AbortError" })
	assert.equal(reads, 1)
})

test("failed revision waits for an unacknowledged send use the same bounded backoff", async () => {
	const controller = new AbortController()
	const delays: number[] = []
	let waits = 0
	await assert.rejects(
		recoverMessage({
			...defaults(controller),
			pending: { ...pending, accepted: false },
			wait: async () => {
				if (++waits === 7) controller.abort()
				throw new RequestFailed(503, {
					code: "unavailable",
					message: "Try later",
				})
			},
			delay: async (milliseconds) => {
				delays.push(milliseconds)
			},
		}),
		{ name: "AbortError" },
	)
	assert.deepEqual(delays, [1_000, 2_000, 4_000, 8_000, 15_000, 15_000])
})

test("temporary read failures keep the receipt and back off before restoring state", async () => {
	const delays: number[] = []
	let reads = 0
	let observed = 0
	await recoverMessage({
		...defaults(),
		read: async () => {
			if (++reads <= 6)
				throw new RequestFailed(503, {
					code: "unavailable",
					message: "Try later",
				})
			return snapshot([turn("turn-a")])
		},
		delay: async (milliseconds) => {
			delays.push(milliseconds)
		},
		onSnapshot: () => {
			observed++
		},
	})
	assert.deepEqual(delays, [1_000, 2_000, 4_000, 8_000, 15_000, 15_000])
	assert.equal(observed, 1)
})

test("authorization errors retain their status for the page", async () => {
	for (const status of [401, 403]) {
		const error = new RequestFailed(status, {
			code: status === 401 ? "unauthorized" : "forbidden",
			message: "Access denied",
		})
		await assert.rejects(
			recoverMessage({
				...defaults(),
				read: async () => {
					throw error
				},
			}),
			(caught) => caught === error,
		)
	}
})

test("a canceled read cannot publish a late snapshot or clear recovery", async () => {
	const controller = new AbortController()
	let observed = false
	await assert.rejects(
		recoverMessage({
			...defaults(controller),
			read: async () => {
				controller.abort()
				return snapshot([turn("turn-a")])
			},
			onSnapshot: () => {
				observed = true
			},
		}),
		{ name: "AbortError" },
	)
	assert.equal(observed, false)
	await assert.rejects(recoverMessage(defaults(controller)), {
		name: "AbortError",
	})
})

test("one Chat's late recovery cannot resolve another Chat's send", async () => {
	let reads = 0
	const seen: string[] = []
	await recoverMessage({
		...defaults(),
		read: async () => {
			const value = snapshot([turn("turn-a")])
			return ++reads === 1
				? { ...value, chat: { ...value.chat, id: "chat-b" } }
				: value
		},
		delay: async () => {},
		onSnapshot: (value) => {
			seen.push(value.chat.id)
		},
	})
	assert.deepEqual(seen, ["chat-a"])
	assert.equal(reads, 2)
})

test("a restored running command keeps observing without displaying recovery until a read fails", async () => {
	const progress: string[] = []
	const error = new RequestFailed(503, {
		code: "unavailable",
		message: "The state could not be read.",
	})
	let reads = 0
	let complete = false
	let observing = false
	let pauses = 0
	await recoverMessage({
		...defaults(),
		pending: { ...pending, executionId: "execution-a" },
		execution: async (id) => {
			if (++reads === 2) throw error
			return {
				id,
				resource: { kind: "Turn", id: "turn-a" },
				status: reads < 4 ? "running" : "completed",
				sequence: reads,
				createdAt: 1,
				updatedAt: reads,
				failure: null,
			}
		},
		read: async () => {
			const value = snapshot([
				turn("turn-a", reads < 4 ? "Running" : "Completed"),
			])
			return {
				...value,
				chat: { ...value.chat, status: reads < 4 ? "Running" : "Completed" },
			}
		},
		onSnapshot: (value) => {
			observing = true
			progress.push("observed:" + value.chat.status)
		},
		onRetry: (caught) => {
			assert.equal(caught, error)
			observing = false
			progress.push("retrying")
		},
		delay: async () => {
			pauses++
			assert.equal(complete, false)
			assert.equal(observing, reads !== 2)
		},
	}).then(() => {
		complete = true
	})
	assert.equal(complete, true)
	assert.equal(pauses, 3)
	assert.deepEqual(progress, [
		"observed:Running",
		"retrying",
		"observed:Running",
		"observed:Completed",
	])
})

test("a snapshot does not restore observation until its execution belongs to the conversation", async () => {
	let reads = 0
	let observed = 0
	let retries = 0
	await recoverMessage({
		...defaults(),
		pending: { ...pending, executionId: "execution-a" },
		execution: async (id) => ({
			id,
			resource: { kind: "Turn", id: ++reads === 1 ? "another-turn" : "turn-a" },
			status: "completed",
			sequence: reads,
			createdAt: 1,
			updatedAt: 2,
			failure: null,
		}),
		onSnapshot: () => {
			observed++
		},
		onRetry: () => {
			retries++
		},
		delay: async () => {},
	})
	assert.equal(observed, 1)
	assert.equal(retries, 1)
})

test("an ended account scope cannot publish a late read failure", async () => {
	const controller = new AbortController()
	let retries = 0
	await assert.rejects(
		recoverMessage({
			...defaults(controller),
			read: async () => {
				controller.abort()
				throw new Error("Late read failure")
			},
			onRetry: () => {
				retries++
			},
		}),
		{ name: "AbortError" },
	)
	assert.equal(retries, 0)
})
