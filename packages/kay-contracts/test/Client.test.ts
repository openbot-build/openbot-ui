import assert from "node:assert/strict"
import { test } from "node:test"
import { events, make, RequestFailed } from "../src/Client.ts"

test("Chat event subscriptions are cancellable reads and support idle responses", async () => {
	const controller = new AbortController()
	let reads = 0
	const client = make({
		fetch: async (path, init) => {
			assert.equal(path, "/api/kay/v1/chats/chat%2Fa/events")
			assert.equal(init?.method, "GET")
			assert.equal(init?.signal, controller.signal)
			reads++
			if (reads === 1) return new Response(null, { status: 204 })
			return new Response(
				`event: response.tool_activity\ndata: ${JSON.stringify({
					type: "response.tool_activity",
					chatId: "chat/a",
					turnId: "turn",
					executionId: "execution",
					executionSequence: 12,
					sequence: 0,
					toolActivity: {
						step: "tool:4:itemcall",
						attempt: 0,
						itemId: "item",
						callId: "call",
						name: "computer_terminal",
						computerId: "computer",
						status: "queued",
					},
				})}\n\n`,
				{ headers: { "content-type": "text/event-stream" } },
			)
		},
	})
	assert.deepEqual(
		await Array.fromAsync(client.chatEvents("chat/a", controller.signal)),
		[],
	)
	const result = await Array.fromAsync(
		client.chatEvents("chat/a", controller.signal),
	)
	assert.equal(result[0]?.toolActivity?.name, "computer_terminal")
	assert.equal(result[0]?.executionSequence, 12)
	assert.equal(reads, 2)
})

test("activity and device reads retain cancellation and never retry a write", async () => {
	const controller = new AbortController()
	const paths: string[] = []
	const client = make({
		fetch: async (path, init) => {
			assert.equal(init?.method, "GET")
			assert.equal(init.signal, controller.signal)
			paths.push(String(path))
			return Response.json(
				{ code: "conflict", message: "Read again." },
				{ status: 409 },
			)
		},
	})
	await assert.rejects(
		client.chatActivity("chat/a", controller.signal),
		(error: unknown) => error instanceof RequestFailed && error.status === 409,
	)
	await assert.rejects(
		client.devices(controller.signal),
		(error: unknown) => error instanceof RequestFailed && error.status === 409,
	)
	assert.deepEqual(paths, [
		"/api/kay/v1/chats/chat%2Fa/activity",
		"/api/kay/v1/devices",
	])
})

test("reminders keep their source scope and do not repeat an uncertain cancellation", async () => {
	let writes = 0
	const client = make({
		fetch: async (path, init) => {
			if (init?.method === "POST") {
				writes++
				assert.match(
					JSON.parse(String(init.body)).commandKey,
					/^reminder-cancel:/,
				)
				throw new Error("Lost reply")
			}
			assert.equal(path, "/api/kay/v1/reminders?chatId=chat-a&after=rem-a")
			return Response.json({ items: [], next: null })
		},
	})
	assert.deepEqual(
		await client.reminders({ chatId: "chat-a", after: "rem-a" }),
		{ items: [], next: null },
	)
	await assert.rejects(
		client.cancelReminder("rem-a"),
		(error: unknown) =>
			error instanceof RequestFailed &&
			error.problem.code === "outcome_unknown",
	)
	assert.equal(writes, 1)
})

test("asynchronous features wait for their saved result and retry only reads", async () => {
	let writes = 0,
		reads = 0
	const operation = {
		id: "connections.verifyConnection",
		group: "connections",
		title: "Verify",
		description: "",
		method: "POST",
		transport: "json",
		params: null,
		query: null,
		payload: null,
		response: null,
		resultMode: "execution",
	}
	const client = make({
		fetch: async (path, init) => {
			if (String(path).endsWith("/catalog")) return Response.json([operation])
			if (init?.method === "POST") {
				writes++
				return Response.json(
					{ executionId: "execution-a", commandKey: "command-a", sequence: 1 },
					{ status: 202 },
				)
			}
			assert.equal(
				path,
				"/api/kay/v1/feature-results/execution-a?operation=connections.verifyConnection",
			)
			reads++
			if (reads === 1) throw new Error("Disconnected")
			return Response.json({
				pending: false,
				result: { connection: { id: "connection-a" } },
				execution: {
					id: "execution-a",
					resource: { kind: "AppConnection", id: "connection-a" },
					status: "completed",
					sequence: 3,
					createdAt: 1,
					updatedAt: 2,
					failure: null,
				},
			})
		},
	})
	assert.deepEqual(
		await client.featureCall(operation.id, {
			payload: { privateKey: "never-in-url" },
		}),
		{ connection: { id: "connection-a" } },
	)
	assert.equal(writes, 1)
	assert.equal(reads, 2)
})

test("only 401 asks the client to sign in", async () => {
	let status = 403,
		calls = 0,
		signIns = 0
	const client = make({
		fetch: async () => {
			calls++
			return Response.json(
				{
					code: status === 401 ? "unauthorized" : "forbidden",
					message: "Denied",
				},
				{ status },
			)
		},
		onUnauthorized: () => {
			signIns++
		},
	})
	await assert.rejects(
		client.bootstrap(),
		(error: unknown) => error instanceof RequestFailed && error.status === 403,
	)
	assert.equal(signIns, 0)
	status = 401
	await assert.rejects(
		client.bootstrap(),
		(error: unknown) => error instanceof RequestFailed && error.status === 401,
	)
	assert.equal(signIns, 1)
	assert.equal(calls, 2)
})

test("a lost write is unknown and is never sent again", async () => {
	let calls = 0
	const client = make({
		fetch: async () => {
			calls++
			throw new Error("Disconnected")
		},
	})
	await assert.rejects(
		client.send("chat-a", { input: "Hello" }),
		(error: unknown) =>
			error instanceof RequestFailed &&
			error.problem.code === "outcome_unknown",
	)
	assert.equal(calls, 1)
})

test("default assistant initialization is explicit and an uncertain response is checked with a read", async () => {
	const calls: string[] = []
	const client = make({
		fetch: async (path, init) => {
			assert.equal(path, "/api/kay/v1/default-bot")
			calls.push(init?.method ?? "GET")
			if (init?.method === "POST") {
				assert.equal(
					init.body,
					JSON.stringify({ userId: "owner", organizationId: "kay" }),
				)
				throw new Error("Response lost")
			}
			return Response.json({ phase: "ready", botId: "bot-a" })
		},
	})
	await assert.rejects(
		client.ensureDefaultBot({ userId: "owner", organizationId: "kay" }),
		(error: unknown) =>
			error instanceof RequestFailed &&
			error.problem.code === "outcome_unknown",
	)
	assert.deepEqual(await client.defaultBotStatus(), {
		phase: "ready",
		botId: "bot-a",
	})
	assert.deepEqual(calls, ["POST", "GET"])
})

test("queued and steered inputs are accepted without inventing a live stream", async () => {
	for (const delivery of ["queued", "steered"] as const) {
		const client = make({
			fetch: async () =>
				Response.json(
					{
						delivery,
						chatId: "chat-a",
						itemId: "item-a",
						turnId: delivery === "queued" ? null : "turn-a",
					},
					{ status: 202 },
				),
		})
		const result = await client.sendToBot("bot-a", {
			input: "Hello",
			stream: true,
		})
		assert.equal(result.kind, "receipt")
		if (result.kind === "receipt")
			assert.equal(result.receipt.delivery, delivery)
	}
})

test("the shared SSE parser handles split frames and does not treat retry as a write", async () => {
	const chunks = [
		"retry: 100\r\n",
		'\r\nevent: response.output_text.delta\r\ndata: {"type":"response.output_text.delta","chatId":"chat-a",',
		'"turnId":"turn-a","sequence":0,"delta":"Hello"}\r\n\r\n',
	]
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks)
				controller.enqueue(new TextEncoder().encode(chunk))
			controller.close()
		},
	})
	const seen = []
	for await (const event of events(stream)) seen.push(event)
	assert.deepEqual(seen, [
		{
			type: "response.output_text.delta",
			chatId: "chat-a",
			turnId: "turn-a",
			sequence: 0,
			delta: "Hello",
		},
	])
})

test("input validation rejects identity fields before calling the network", async () => {
	let calls = 0
	const client = make({
		fetch: async () => {
			calls++
			return Response.json({})
		},
	})
	await assert.rejects(
		client.send("chat-a", { input: "Hello", userId: "someone-else" } as never),
	)
	assert.equal(calls, 0)
})

test("malformed accepted writes stay unknown while malformed reads remain unavailable", async () => {
	let writes = 0
	const client = make({
		fetch: async (_input, init) => {
			if (init?.method !== "GET") writes++
			return new Response("broken", {
				status: 200,
				headers: { "content-type": "application/json" },
			})
		},
	})
	for (const run of [
		() => client.create({ botId: "bot-a", requestId: "request-a" }),
		() => client.send("chat-a", { input: "Hello" }),
	])
		await assert.rejects(
			run(),
			(error: unknown) =>
				error instanceof RequestFailed &&
				error.problem.code === "outcome_unknown",
		)
	await assert.rejects(
		client.bootstrap(),
		(error: unknown) =>
			error instanceof RequestFailed && error.problem.code === "unavailable",
	)
	assert.equal(writes, 2)
})

test("feature writes and uploads preserve an unknown result after response parsing fails", async () => {
	const entry = {
		group: "files",
		title: "Files",
		description: "",
		params: null,
		query: null,
		payload: null,
		response: null,
	}
	const catalog = [
		{ ...entry, id: "files.listFiles", method: "GET", transport: "json" },
		{
			...entry,
			id: "files.uploadFile",
			method: "POST",
			transport: "multipart",
		},
		{ ...entry, id: "files.deleteFile", method: "DELETE", transport: "json" },
	]
	let writes = 0
	const client = make({
		fetch: async (path, init) => {
			if (String(path).endsWith("/catalog")) return Response.json(catalog)
			if (init?.method !== "GET") writes++
			return new Response("broken", { status: 200 })
		},
	})
	await assert.rejects(
		client.featureCall("files.deleteFile", {}),
		(error: unknown) =>
			error instanceof RequestFailed &&
			error.problem.code === "outcome_unknown",
	)
	await assert.rejects(
		client.featureUpload("files.uploadFile", new File(["file"], "file.txt")),
		(error: unknown) =>
			error instanceof RequestFailed &&
			error.problem.code === "outcome_unknown",
	)
	await assert.rejects(
		client.featureCall("files.listFiles", {}),
		(error: unknown) =>
			error instanceof RequestFailed && error.problem.code === "unavailable",
	)
	assert.equal(writes, 2)
})

test("explicit catalog reload reads current permissions again", async () => {
	let reads = 0
	const client = make({
		fetch: async () => {
			reads++
			return Response.json([])
		},
	})
	await client.featureCatalog()
	await client.featureCatalog()
	assert.equal(reads, 2)
})

test("declared void feature responses accept an empty 200 without masking missing JSON results", async () => {
	const catalog = [
		{
			id: "appViews.message",
			group: "appViews",
			title: "Message",
			description: "",
			method: "POST",
			params: null,
			query: null,
			payload: null,
			response: null,
			transport: "json",
		},
		{
			id: "appViews.confirmContext",
			group: "appViews",
			title: "Confirm context",
			description: "",
			method: "PUT",
			params: null,
			query: null,
			payload: null,
			response: { type: "object" },
			transport: "json",
		},
	]
	let writes = 0
	const client = make({
		fetch: async (path) => {
			if (String(path).endsWith("/catalog")) return Response.json(catalog)
			writes++
			return new Response(null, { status: 200 })
		},
	})
	assert.equal(await client.featureCall("appViews.message"), null)
	await assert.rejects(
		client.featureCall("appViews.confirmContext"),
		(error) =>
			error instanceof RequestFailed &&
			error.problem.code === "outcome_unknown",
	)
	assert.equal(writes, 2)
})

const attachmentChat = {
	id: "chat-a",
	botId: "bot-a",
	kind: "conversation",
	revision: 8,
	title: null,
	status: "Completed",
	activity: "inactive",
	createdAt: 1,
	branch: null,
	memory: { read: true, write: true },
	queuedInputs: 0,
	activeTurnId: null,
	openWork: { tasks: 0, approvals: 0, reminders: 0 },
}
test("file attachments preserve the destination, receipt key, revision, signal and returned Chat", async () => {
	const controller = new AbortController()
	let calls = 0
	const client = make({
		fetch: async (path, init) => {
			calls++
			assert.equal(path, "/api/kay/v1/chats/chat-a/files")
			assert.equal(init?.method, "POST")
			assert.equal(init?.signal, controller.signal)
			assert.equal(init?.credentials, "same-origin")
			assert.deepEqual(JSON.parse(String(init?.body)), {
				fileId: "file-a",
				requestId: "request-a",
				expected: 7,
			})
			return Response.json(attachmentChat)
		},
	})
	assert.deepEqual(
		await client.attachFile(
			"chat-a",
			{ fileId: "file-a", requestId: "request-a", expected: 7 },
			controller.signal,
		),
		attachmentChat,
	)
	assert.equal(calls, 1)
})

test("attachment payloads are checked before transport and uncertain responses are never resubmitted", async () => {
	let calls = 0
	let mode: "valid" | "lost" | "malformed" = "valid"
	const client = make({
		fetch: async () => {
			calls++
			if (mode === "lost") throw new Error("Lost attachment reply")
			return Response.json(
				mode === "malformed" ? { accepted: true } : attachmentChat,
			)
		},
	})
	for (const input of [
		{ fileId: "", requestId: "request-a", expected: 7 },
		{ fileId: "file-a", requestId: "", expected: 7 },
		{ fileId: "file-a", requestId: "request-a", expected: -1 },
		{
			fileId: "file-a",
			requestId: "request-a",
			expected: 7,
			userId: "another-user",
		},
	])
		await assert.rejects(client.attachFile("chat-a", input))
	assert.equal(calls, 0)
	for (const failure of ["lost", "malformed"] as const) {
		mode = failure
		await assert.rejects(
			client.attachFile("chat-a", {
				fileId: "file-a",
				requestId: "request-a",
				expected: 7,
			}),
			(error) =>
				error instanceof RequestFailed &&
				error.problem.code === "outcome_unknown",
		)
	}
	assert.equal(calls, 2)
})

test("attachment permission failures retain status and only 401 requests login", async () => {
	let status = 403
	let signIns = 0
	let calls = 0
	const client = make({
		onUnauthorized: () => {
			signIns++
		},
		fetch: async () => {
			calls++
			return Response.json(
				{
					code: status === 401 ? "unauthorized" : "forbidden",
					message: "Access denied",
				},
				{ status },
			)
		},
	})
	for (const code of [403, 401]) {
		status = code
		await assert.rejects(
			client.attachFile("chat-a", {
				fileId: "file-a",
				requestId: "request-a",
				expected: 7,
			}),
			(error) => error instanceof RequestFailed && error.status === code,
		)
		assert.equal(signIns, code === 401 ? 1 : 0)
	}
	assert.equal(calls, 2)
})
