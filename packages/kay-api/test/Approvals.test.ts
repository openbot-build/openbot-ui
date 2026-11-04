import assert from "node:assert/strict"
import { test } from "node:test"
import { list } from "../src/compatibility/Approvals.ts"
import type { Json } from "../src/compatibility/Projection.ts"

const item = (id: string, role: string, content: Json[], turn = "t"): Json => ({
	id,
	origin: { session: "s", turn, step: 0 },
	content: { content: [{ role, content }] },
})
const call = (value: string): Json => ({
	type: "tool-call",
	id: "reused",
	name: "write",
	params: { value },
	providerExecuted: false,
})
const wait = (approvalId: string): Json => ({
	type: "tool-approval-request",
	approvalId,
	toolCallId: "reused",
})
const view: Json = {
	session: {
		id: "s",
		head: "v",
		revision: 8,
		metadata: { title: "", archived: false },
		settings: { mode: "default" },
		pending: [],
		inheritedTurns: [],
		business: {},
		turns: [
			{
				id: "t",
				session: "s",
				settings: { mode: "default" },
				status: {
					_tag: "Waiting",
					result: { text: "", finishReason: "tool-calls" },
				},
				steps: 1,
				input: [],
				items: ["old", "new"],
				start: "v0",
				startedAt: 1,
			},
		],
	},
	response: null,
	state: {
		version: { id: "v", schemaVersion: "timeline/1", parents: [] },
		value: {
			conversation: {
				closed: false,
				context: { _tag: "Prompt", prompt: { content: [] } },
				history: [
					item(
						"unrelated",
						"assistant",
						[call("other turn"), wait("prior-turn")],
						"t-old",
					),
					item("old", "assistant", [call("first"), wait("a-first")]),
					item("result", "tool", [
						{
							type: "tool-result",
							id: "reused",
							name: "write",
							result: "done",
							isFailure: false,
						},
					]),
					item("new", "assistant", [call("second"), wait("a-second")]),
				],
			},
		},
	},
}
const request = {
	id: "request-current",
	session: "s",
	turn: "t",
	toolCallId: "reused",
	callOccurrence: 1,
	revision: 0,
	status: "pending",
}

test("projects native Requests only for the exact current Turn occurrence", () => {
	assert.deepEqual(
		list(view, [
			{ ...request, id: "request-old", callOccurrence: 0 },
			{ ...request, id: "request-other-turn", turn: "t-old" },
			{ ...request, id: "request-other-session", session: "private" },
			{ ...request, id: "request-decided", status: "allowed" },
			request,
		]),
		[
			{
				turn: "t",
				approvalId: "request-current",
				toolCallId: "reused",
				toolName: "write",
				arguments: { value: "second" },
			},
		],
	)
})

test("does not infer a missing request occurrence from a reused call ID", () => {
	const { callOccurrence: _, ...missing } = request
	assert.throws(() => list(view, [missing]))
})
