import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer } from "node:http"
import { test } from "node:test"
import { handleProductRequest, type NativeCall } from "../src/ProductGateway.ts"

const fixture = async (respond: (call: NativeCall) => Response) => {
	const calls: NativeCall[] = []
	const server = createServer(async (req, res) => {
		const chunks = []
		for await (const chunk of req) chunks.push(chunk)
		const raw = Buffer.concat(chunks).toString()
		await handleProductRequest({
			req,
			res,
			url: new URL(req.url ?? "/", "http://localhost"),
			payload: raw === "" ? undefined : JSON.parse(raw),
			requestId: "request",
			identity: { userId: "owner", organizationId: "kay", displayName: "Sage" },
			client: {
				request: async (call) => {
					calls.push(call)
					return respond(call)
				},
			},
		})
	})
	server.listen(0, "127.0.0.1")
	await once(server, "listening")
	const address = server.address()
	if (address === null || typeof address === "string")
		throw new Error("Expected address")
	return {
		calls,
		request: (path: string, payload?: unknown) =>
			fetch(
				`http://127.0.0.1:${address.port}/api/kay/v1${path}`,
				payload === undefined
					? {}
					: {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify(payload),
						},
			),
		close: async () => {
			server.closeAllConnections()
			await new Promise<void>((resolve) => server.close(() => resolve()))
		},
	}
}

test("durable acceptance preserves identity without inventing started or an input item", async () => {
	const f = await fixture(() =>
		Response.json(
			{
				delivery: "accepted",
				chat: "chat",
				turn: "turn",
				item: null,
				executionId: "execution",
				commandKey: "one-command",
			},
			{ status: 202 },
		),
	)
	try {
		const response = await f.request("/chats/chat/messages", {
			input: "Once",
			stream: false,
			commandKey: "one-command",
		})
		assert.equal(response.status, 202)
		assert.deepEqual(await response.json(), {
			delivery: "accepted",
			chatId: "chat",
			turnId: "turn",
			itemId: null,
			executionId: "execution",
			commandKey: "one-command",
		})
		assert.deepEqual(f.calls[0]?.payload, {
			input: "Once",
			stream: false,
			commandKey: "one-command",
		})
		assert.equal(f.calls.length, 1)
	} finally {
		await f.close()
	}
})

test("the first stream frame carries the durable recovery identity", async () => {
	const f = await fixture(
		() =>
			new Response(
				'event: response.accepted\ndata: {"type":"response.accepted","chat":"chat","turn":"turn","sequence_number":0,"executionId":"execution","commandKey":"one-command"}\n\n',
				{ headers: { "content-type": "text/event-stream" } },
			),
	)
	try {
		const response = await f.request("/chats/chat/messages", {
			input: "Once",
			stream: true,
		})
		const body = await response.text()
		assert.match(body, /"executionId":"execution"/)
		assert.match(body, /"commandKey":"one-command"/)
		assert.match(body, /"turnId":"turn"/)
		assert.match(body, /"sequence":0/)
	} finally {
		await f.close()
	}
})

test("native Chat reads without the retired activity property still project correctly", async () => {
	const f = await fixture(() =>
		Response.json({
			chat: {
				id: "chat",
				bot: "bot",
				kind: "conversation",
				revision: 3,
				createdAt: 1,
			},
			status: "Running",
			turn: { id: "turn" },
			executionId: "execution",
			inbox: 0,
			open: { delegations: 0, requests: 0, reminders: 0 },
		}),
	)
	try {
		const response = await f.request("/chats/chat")
		assert.equal(response.status, 200)
		const value = await response.json()
		assert.equal(value.activity, "active")
		assert.equal(value.activeTurnId, "turn")
	} finally {
		await f.close()
	}
})
