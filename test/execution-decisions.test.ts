import assert from "node:assert/strict"
import { test } from "node:test"
import { ExecutionsApi } from "@openbot-build/client/Api"
import { HashMap } from "effect"
import {
	emptyDecisions,
	reduceDecisions,
	type Decisions,
} from "../src/lib/execution-decisions.ts"

const { Execution } = ExecutionsApi
const event = (
	sequence: number,
	body: ExecutionsApi.Execution.EventBody,
): ExecutionsApi.Execution.Event => ({
	executionId: Execution.Id.make("tool-execution"),
	sequence,
	createdAt: 0,
	body,
})
const choices = (state: Decisions) =>
	Array.from(HashMap.values(state.pending)).toSorted((a, b) =>
		a.id.localeCompare(b.id),
	)

test("a cancel gives only the choices of its current phase across event pages", () => {
	const firstPage = [
		event(1, { _tag: "State", status: "outcome_unknown", failure: null }),
		event(2, {
			_tag: "DecisionNeeded",
			decisionId: "outside-call",
			choices: ["retry", "stop"],
		}),
	]
	const secondPage = [
		event(3, { _tag: "State", status: "cancelling", failure: null }),
		event(4, { _tag: "State", status: "outcome_unknown", failure: null }),
		event(5, {
			_tag: "DecisionNeeded",
			decisionId: "outside-call:cancel:1",
			choices: ["retry", "stop"],
		}),
	]
	const lastPage = [
		event(6, {
			_tag: "DecisionNeeded",
			decisionId: "outside-call:cancel:1",
			choices: ["stop"],
		}),
	]
	const initial = firstPage.reduce(reduceDecisions, emptyDecisions)
	assert.deepEqual(choices(initial), [
		{ id: "outside-call", choices: ["retry", "stop"] },
	])
	const current = lastPage.reduce(
		reduceDecisions,
		secondPage.reduce(reduceDecisions, initial),
	)
	assert.deepEqual(choices(current), [
		{ id: "outside-call:cancel:1", choices: ["stop"] },
	])
	assert.deepEqual(
		choices(firstPage.reduce(reduceDecisions, current)),
		choices(current),
	)
})

test("saved answers, late results and the end of work remove old actions", () => {
	const pending = [
		event(1, {
			_tag: "DecisionNeeded",
			decisionId: "approval",
			choices: ["allow", "deny"],
		}),
		event(2, {
			_tag: "DecisionNeeded",
			decisionId: "outside-call:cancel:1",
			choices: ["stop"],
		}),
		event(3, {
			_tag: "DecisionNeeded",
			decisionId: "other-call",
			choices: ["retry", "stop"],
		}),
	].reduce(reduceDecisions, emptyDecisions)
	const settled = [
		event(4, { _tag: "DecisionMade", decisionId: "approval", answer: "allow" }),
		event(5, {
			_tag: "CallRecorded",
			callId: Execution.CallId.make("outside-call"),
			step: "tool",
			attempt: 1,
		}),
	].reduce(reduceDecisions, pending)
	assert.deepEqual(choices(settled), [
		{ id: "other-call", choices: ["retry", "stop"] },
	])
	const ended = reduceDecisions(
		settled,
		event(6, { _tag: "State", status: "interrupted", failure: null }),
	)
	assert.deepEqual(choices(ended), [])
})
