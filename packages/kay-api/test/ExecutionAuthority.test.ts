import { test } from "node:test"
import assert from "node:assert/strict"
import { allows } from "../src/ExecutionAuthority.ts"

test("drain admits no new work while allowing the current epoch to finish", () => {
	const row = { active_backend: "e", phase: "DRAINING", epoch: "7" }
	const base = { accountId: "a", backend: "e" as const, epoch: 7 }
	assert.equal(allows({ row, request: { ...base, intent: "admit" } }), false)
	assert.equal(allows({ row, request: { ...base, intent: "write" } }), true)
	assert.equal(allows({ row, request: { ...base, intent: "send" } }), true)
	assert.equal(
		allows({ row, request: { ...base, epoch: 6, intent: "send" } }),
		false,
	)
})

test("freeze and target activation reject all old runtime activity", () => {
	const request = {
		accountId: "a",
		backend: "e" as const,
		epoch: 7,
		intent: "send" as const,
	}
	assert.equal(
		allows({
			row: { active_backend: "e", phase: "FROZEN", epoch: "8" },
			request,
		}),
		false,
	)
	assert.equal(
		allows({
			row: { active_backend: "openbot", phase: "OPENBOT_ACTIVE", epoch: "9" },
			request,
		}),
		false,
	)
	assert.equal(
		allows({
			row: { active_backend: "openbot", phase: "OPENBOT_ACTIVE", epoch: "9" },
			request: { ...request, backend: "openbot", epoch: 9 },
		}),
		true,
	)
})
