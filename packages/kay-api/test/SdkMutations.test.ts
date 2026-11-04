import assert from "node:assert/strict"
import { test } from "node:test"
import { Effect, Layer, ManagedRuntime, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { Session, Turn } from "@kaicom/e-core"
import { Client, layer } from "@kaicom/e-client"

test("the unchanged SDK never retries ambiguous Turn or approval sends", async () => {
	const requests: string[] = []
	await using client = ManagedRuntime.make(
		layer({ baseUrl: "https://kay.example" }).pipe(
			Layer.provide(
				Layer.succeed(FetchHttpClient.Fetch, async (input) => {
					requests.push(String(input))
					throw new TypeError("Connection lost after request was sent")
				}),
			),
		),
	)
	const sessionId = Schema.decodeSync(Session.Id)("session"),
		turnId = Schema.decodeSync(Turn.Id)("turn")
	const send = await client.runPromise(
		Effect.flatMap(Client, ({ api }) =>
			api.sessions.startTurn({
				params: { sessionId },
				payload: {
					input: "hello",
					expected: Schema.decodeSync(Session.Revision)(0),
				},
			}),
		).pipe(Effect.result),
	)
	assert.equal(send._tag, "Failure")
	assert.equal(requests.length, 1)
	const approval = await client.runPromise(
		Effect.flatMap(Client, ({ api }) =>
			api.approvals.resolve({
				params: { sessionId, turnId, approvalId: "approval" },
				payload: {
					expected: Schema.decodeSync(Session.Revision)(0),
					approved: true,
				},
			}),
		).pipe(Effect.result),
	)
	assert.equal(approval._tag, "Failure")
	assert.equal(requests.length, 2)
})
