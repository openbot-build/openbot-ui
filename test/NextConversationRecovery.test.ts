import assert from "node:assert/strict"
import { test } from "node:test"
import {
	readPendingConversation,
	recoveryKey,
	writePendingConversation,
} from "../src/next/ConversationRecovery.ts"

test("pending conversation recovery retains only operation identity for its account", () => {
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
	const key = recoveryKey("org:user")
	writePendingConversation({
		storage,
		key,
		value: { kind: "fork", requestId: "operation_123" },
	})
	assert.deepEqual(readPendingConversation({ storage, key }), {
		kind: "fork",
		requestId: "operation_123",
	})
	assert.equal(
		readPendingConversation({ storage, key: recoveryKey("other:user") }),
		null,
	)
	values.set(
		key,
		JSON.stringify({
			kind: "send",
			requestId: "operation_123",
			input: "private message",
		}),
	)
	assert.equal(readPendingConversation({ storage, key }), null)
	writePendingConversation({ storage, key, value: null })
	assert.equal(values.has(key), false)
})
