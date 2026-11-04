import assert from "node:assert/strict"
import { test } from "node:test"
import { Schema } from "effect"
import {
	ActivityProgress,
	ActivityTool,
	ActivityAppOperation,
} from "../src/Activity.ts"

test("unknown progress remains null and empty totals are invalid", () => {
	assert.equal(Schema.decodeSync(ActivityProgress)(null), null)
	assert.throws(() =>
		Schema.decodeSync(ActivityProgress)({ completed: 0, total: 0 }),
	)
})
test("tool status remains an execution state rather than a display guess", () => {
	assert.throws(() =>
		Schema.decodeUnknownSync(ActivityTool)({
			id: "tool",
			executionId: "execution",
			turnId: null,
			itemId: null,
			name: "tool",
			status: "done",
			startedAt: null,
			completedAt: null,
			computerId: null,
			fileIds: [],
		}),
	)
})
test("App activity requires its saved Turn identity", () => {
	assert.throws(() =>
		Schema.decodeUnknownSync(ActivityAppOperation)({
			id: "app",
			executionId: "execution",
			name: "tool",
			status: "waiting",
		}),
	)
})

test("foreground tool activity has no independent execution ID", () => {
	assert.equal(
		Schema.decodeSync(ActivityTool)({
			id: "history:item:0:0",
			executionId: null,
			turnId: "turn",
			itemId: "item",
			name: "tool",
			status: "completed",
			startedAt: null,
			completedAt: null,
			computerId: null,
			fileIds: [],
		}).executionId,
		null,
	)
})

test("saved App names are optional and preserve the protocol tool name", () => {
	const previous = Schema.decodeSync(ActivityTool)({
		id: "tool",
		executionId: null,
		turnId: "turn",
		itemId: "item",
		name: "openbot_action",
		status: "completed",
		startedAt: null,
		completedAt: null,
		computerId: null,
		fileIds: [],
	})
	assert.equal("displayName" in previous, false)
	assert.equal("appName" in previous, false)
	const named = Schema.decodeSync(ActivityTool)({
		...previous,
		displayName: "search_documents",
		appName: "Documents",
	})
	assert.equal(named.name, "openbot_action")
	assert.equal(named.displayName, "search_documents")
	assert.equal(named.appName, "Documents")
})

test("App operations accept old records and their saved display names", () => {
	const previous = Schema.decodeSync(ActivityAppOperation)({
		id: "app",
		executionId: "execution",
		turnId: "turn",
		name: "openbot_action",
		status: "waiting",
	})
	assert.equal("displayName" in previous, false)
	assert.equal("appName" in previous, false)
	assert.deepEqual(
		Schema.decodeSync(ActivityAppOperation)({
			...previous,
			displayName: "search_documents",
			appName: "Documents",
		}),
		{ ...previous, displayName: "search_documents", appName: "Documents" },
	)
})
