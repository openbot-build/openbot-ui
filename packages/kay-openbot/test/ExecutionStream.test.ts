import assert from "node:assert/strict"
import { test } from "node:test"
import * as Api from "@openbot-build/client/Api"
import { Schema } from "effect"
import { chatExecutionStream } from "../src/ExecutionStream.ts"

const receipt = Schema.decodeSync(Api.ChatCommandReceipt)({
	executionId: "exec",
	commandKey: "key",
	sequence: 1,
	chat: "chat",
	turn: "turn",
})
const event = (sequence: number, body: unknown, executionId = "exec") =>
	`event: execution\ndata: ${JSON.stringify({ executionId, sequence, createdAt: 1, body })}\n\n`

test("tool intent and end expose only safe metadata, never infer success", async () => {
	const tool = {
		chatId: "chat",
		turnId: "turn",
		itemId: "item",
		callId: "call",
		name: "computer_terminal",
		computerId: "computer-a",
		params: { token: "private-token" },
	}
	const response = chatExecutionStream({
		receipt,
		observe: async () =>
			new Response(
				[
					event(1, {
						_tag: "StepStarted",
						step: "tool:4:itemcall",
						attempt: 1,
						tool,
					}),
					event(2, {
						_tag: "StepStarted",
						step: "tool:4:itemcall",
						attempt: 0,
						tool,
					}),
					event(3, {
						_tag: "StepCompleted",
						step: "tool:4:itemcall",
						attempt: 0,
					}),
					event(4, {
						_tag: "StepCompleted",
						step: "tool:4:itemcall",
						attempt: 1,
					}),
				].join(""),
			),
	})
	const text = await response.text()
	const frames = text
		.split("\n")
		.filter((line) => line.startsWith("data: "))
		.map((line) => JSON.parse(line.slice(6)))
	assert.deepEqual(
		frames.slice(1).map((frame) => frame.toolActivity.status),
		["queued", "ended"],
	)
	assert.equal(frames[1].toolActivity.computerId, "computer-a")
	assert.equal(frames[1].executionSequence, 1)
	assert.doesNotMatch(text, /private-token|params|"completed"/)
})

test("invalid and foreign tool metadata never appear as activity", async () => {
	const tool = {
		chatId: "chat",
		turnId: "turn",
		itemId: "item",
		callId: "call",
		name: "computer_terminal",
	}
	for (const changed of [
		{ ...tool, chatId: "other" },
		{ ...tool, turnId: "other" },
		{ ...tool, itemId: "other" },
		{ ...tool, name: null },
		{ ...tool, computerId: 42 },
	]) {
		const response = chatExecutionStream({
			receipt,
			observe: async () =>
				new Response(
					event(1, {
						_tag: "StepStarted",
						step: "tool:4:itemcall",
						attempt: 0,
						tool: changed,
					}),
				),
		})
		assert.doesNotMatch(await response.text(), /tool_activity/)
	}
})

test("read-only observation starts after its cursor without an accepted command", async () => {
	const response = chatExecutionStream({
		receipt: { chat: "chat", turn: "turn", executionId: "exec", sequence: 9 },
		acknowledge: false,
		afterSequence: 9,
		observe: async () =>
			new Response(
				[
					event(9, {
						_tag: "Text",
						step: "model:item",
						attempt: 0,
						text: "already read",
					}),
					event(10, {
						_tag: "StepCompleted",
						step: "tool:4:itemcall",
						attempt: 0,
					}),
				].join(""),
			),
	})
	const text = await response.text()
	assert.match(text, /response.checkpoint/)
	assert.match(text, /"executionSequence":10/)
	assert.doesNotMatch(text, /accepted|commandKey|already read/)
})

test("replayed sequence and stale attempts cannot duplicate or corrupt streamed text", async () => {
	const response = chatExecutionStream({
		receipt,
		observe: async () =>
			new Response(
				[
					event(1, {
						_tag: "Text",
						step: "model:item-a",
						attempt: 0,
						text: "old",
					}),
					event(1, {
						_tag: "Text",
						step: "model:item-a",
						attempt: 0,
						text: "duplicate",
					}),
					event(2, { _tag: "StepStarted", step: "model:item-a", attempt: 1 }),
					event(3, {
						_tag: "Text",
						step: "model:item-a",
						attempt: 0,
						text: "late",
					}),
					event(4, {
						_tag: "Text",
						step: "model:item-a",
						attempt: 1,
						text: "new",
					}),
					event(5, { _tag: "StepCompleted", step: "model:item-a", attempt: 1 }),
					event(6, { _tag: "State", status: "completed", failure: null }),
				].join(""),
			),
	})
	const text = await response.text()
	const frames = text
		.split("\n")
		.filter((line) => line.startsWith("data: "))
		.map((line) => JSON.parse(line.slice(6)))
	assert.deepEqual(
		frames.map((frame) => frame.sequence_number),
		[0, 1, 2, 3, 4, 5],
	)
	assert.equal(frames[0].executionId, "exec")
	assert.equal(frames[0].type, "response.accepted")
	assert.equal(frames[2].text, "")
	assert.equal(frames[1].item_id, "item-a")
	assert.equal(frames[3].executionSequence, 4)
	assert.equal(frames[1].item_id, frames[3].item_id)
	assert.equal(frames[4].text, "new")
	assert.equal(frames[5].response.status, "completed")
	assert.doesNotMatch(text, /duplicate|late/)
})

test("closing observation only aborts its reader", async () => {
	let observationSignal: AbortSignal | undefined
	const response = chatExecutionStream({
		receipt,
		observe: async (signal) => {
			observationSignal = signal
			return new Response(new ReadableStream({ start() {} }))
		},
	})
	const reader = response.body!.getReader()
	await reader.read()
	await reader.cancel()
	assert.equal(observationSignal?.aborted, true)
})

test("an unavailable observation preserves the accepted command before failing", async () => {
	const response = chatExecutionStream({
		receipt,
		observe: async () => new Response(null, { status: 503 }),
	})
	const reader = response.body!.getReader()
	assert.match(
		new TextDecoder().decode((await reader.read()).value),
		/response.accepted/,
	)
	await assert.rejects(reader.read(), /accepted execution/)
})

test("an observer cannot inject another execution's text", async () => {
	const response = chatExecutionStream({
		receipt,
		observe: async () =>
			new Response(
				event(
					1,
					{ _tag: "Text", step: "model:item-a", attempt: 0, text: "foreign" },
					"other",
				),
			),
	})
	const reader = response.body!.getReader()
	await reader.read()
	await assert.rejects(reader.read(), /another command/)
})

test("moved input hands recovery to its new execution and stops the old stream", async () => {
	const response = chatExecutionStream({
		receipt: { ...receipt, turn: null },
		observe: async () =>
			new Response(
				[
					event(1, {
						_tag: "InputMoved",
						executionId: "next-turn-execution",
						items: ["input-a"],
					}),
					event(2, { _tag: "State", status: "completed", failure: null }),
				].join(""),
			),
	})
	const frames = (await response.text())
		.split("\n")
		.filter((line) => line.startsWith("data: "))
		.map((line) => JSON.parse(line.slice(6)))
	assert.equal(frames.length, 2)
	assert.equal(frames[1].type, "response.execution_moved")
	assert.equal(frames[1].executionId, "next-turn-execution")
	assert.equal(frames[1].turn, null)
})

test("an existing Turn cannot transfer another input's recovery ownership", async () => {
	const response = chatExecutionStream({
		receipt,
		observe: async () =>
			new Response(
				[
					event(1, {
						_tag: "InputMoved",
						executionId: "other-input-execution",
						items: ["other-input"],
					}),
					event(2, { _tag: "State", status: "completed", failure: null }),
				].join(""),
			),
	})
	const body = await response.text()
	assert.doesNotMatch(body, /other-input-execution/)
	assert.match(body, /response.checkpoint/)
	assert.match(body, /response.completed/)
})

test("native input identity permits only this command's steered input to continue", async () => {
	let observations = 0
	const response = chatExecutionStream({
		receipt: { ...receipt, inputItems: ["my-input"] },
		observe: async () => {
			observations++
			return new Response(
				[
					event(1, {
						_tag: "InputMoved",
						executionId: "someone-else",
						items: ["other-input"],
					}),
					event(2, {
						_tag: "InputMoved",
						executionId: "my-next-turn",
						items: ["my-input"],
					}),
					event(3, {
						_tag: "Text",
						step: "model:late-old-item",
						attempt: 0,
						text: "Late old output",
					}),
					event(
						1,
						{
							_tag: "Text",
							step: "model:new-item",
							attempt: 0,
							text: "New execution output",
						},
						"my-next-turn",
					),
				].join(""),
			)
		},
	})
	const frames = (await response.text())
		.split("\n")
		.filter((line) => line.startsWith("data: "))
		.map((line) => JSON.parse(line.slice(6)))
	assert.deepEqual(frames[0].inputItems, ["my-input"])
	assert.equal(frames[1].type, "response.checkpoint")
	assert.equal(frames[2].executionId, "my-next-turn")
	assert.equal(frames[2].executionSequence, 2)
	assert.equal(frames[2].turn, null)
	assert.equal(frames.length, 3)
	assert.equal(observations, 1)
})
