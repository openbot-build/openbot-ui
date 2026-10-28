import assert from "node:assert/strict"
import { test } from "node:test"
import { ExecutionsApi } from "@openbot-build/client/Api"
import { emptyAnswer, reduceAnswer } from "../src/lib/execution-events.ts"

const { Execution } = ExecutionsApi
const event = (
	sequence: number,
	body: ExecutionsApi.Execution.EventBody,
): ExecutionsApi.Execution.Event => ({
	executionId: Execution.Id.make("turn-execution"),
	sequence,
	createdAt: 0,
	body,
})

test("a new model attempt replaces its old text and keeps completed steps", () => {
	const events = [
		event(1, {
			_tag: "Text",
			step: "model:0",
			attempt: 1,
			text: "First step.",
		}),
		event(2, {
			_tag: "Text",
			step: "model:1",
			attempt: 1,
			text: "Failed draft",
		}),
		event(3, { _tag: "StepStarted", step: "model:1", attempt: 2 }),
		event(4, { _tag: "Text", step: "model:1", attempt: 2, text: "New " }),
		event(5, { _tag: "Text", step: "model:1", attempt: 2, text: "answer." }),
	]
	const answer = events.reduce(reduceAnswer, emptyAnswer)
	assert.equal(answer.text, "First step.\n\nNew answer.")
	assert.equal(answer.sequence, 5)
})

test("reconnecting from a saved cursor does not repeat text", () => {
	const text = event(2, {
		_tag: "Text",
		step: "model",
		attempt: 1,
		text: "Hello",
	})
	const answer = reduceAnswer(emptyAnswer, text)
	assert.strictEqual(reduceAnswer(answer, text), answer)
	assert.strictEqual(
		reduceAnswer(
			answer,
			event(1, { _tag: "Text", step: "model", attempt: 1, text: "Old" }),
		),
		answer,
	)
	assert.equal(
		reduceAnswer(
			answer,
			event(3, { _tag: "Text", step: "model", attempt: 1, text: " world" }),
		).text,
		"Hello world",
	)
})

test("late text from an older attempt cannot enter the new answer", () => {
	const answer = reduceAnswer(
		emptyAnswer,
		event(1, { _tag: "Text", step: "model", attempt: 2, text: "New answer" }),
	)
	const next = reduceAnswer(
		answer,
		event(2, { _tag: "Text", step: "model", attempt: 1, text: "Old draft" }),
	)
	assert.equal(next.text, "New answer")
	assert.equal(next.sequence, 2)
})
