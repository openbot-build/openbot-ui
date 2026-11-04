import assert from "node:assert/strict"
import { test } from "node:test"
import { consumeBackPress, registerBackDismiss } from "../src/lib/back.ts"

test("Back closes the last open surface before route history", () => {
	const closed: string[] = []
	assert.equal(consumeBackPress(), false)
	const removeSheet = registerBackDismiss(() => closed.push("sheet"))
	const removeDialog = registerBackDismiss(() => closed.push("dialog"))
	assert.equal(consumeBackPress(), true)
	assert.deepEqual(closed, ["dialog"])
	removeDialog()
	assert.equal(consumeBackPress(), true)
	assert.deepEqual(closed, ["dialog", "sheet"])
	removeSheet()
	removeSheet()
	assert.equal(consumeBackPress(), false)
})
