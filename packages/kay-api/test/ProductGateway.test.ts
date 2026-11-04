import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer, type Server } from "node:http"
import { test } from "node:test"
import {
	handleProductRequest,
	type NativeCall,
	type NativeClientFactory,
} from "../src/ProductGateway.ts"
import { createGateway } from "../src/Gateway.ts"
import { runtime } from "../src/Database.ts"
import type { Configuration } from "../src/Configuration.ts"

const listen = async (server: Server) => {
	server.listen(0, "127.0.0.1")
	await once(server, "listening")
	const address = server.address()
	if (address === null || typeof address === "string")
		throw new Error("Expected a TCP address")
	return `http://127.0.0.1:${address.port}`
}
const close = async (server: Server) => {
	server.closeAllConnections()
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error === undefined ? resolve() : reject(error))),
	)
}

test("reminders use native read and cancellation permissions with strict scope inputs", async () => {
	const f = await fixture()
	try {
		f.behavior((call, cookie) => {
			if (cookie !== "session=owner") return Response.json({}, { status: 403 })
			if (call.operation === "cancelReminder")
				return Response.json(
					{
						executionId: "execution-a",
						commandKey: "cancel-key-a",
						sequence: 1,
					},
					{ status: 202 },
				)
			return Response.json({
				items: [
					{
						id: "rem-a",
						chatId: "chat-a",
						turnId: "turn-a",
						executionId: "execution-a",
						note: "Review saved slides",
						dueAt: 1000,
						status: "done",
					},
				],
				next: null,
			})
		})
		const response = await f.request(
			"/reminders?chatId=chat-a&after=rem-before",
		)
		assert.equal(response.status, 200)
		assert.equal((await response.json()).items[0].status, "done")
		assert.deepEqual(f.calls[0], {
			operation: "reminders",
			query: { chatId: "chat-a", after: "rem-before" },
		})
		assert.equal((await f.request("/reminders?chatId=a&chatId=b")).status, 400)
		assert.equal((await f.request("/reminders?accountId=someone")).status, 400)
		assert.equal(
			(await f.request("/reminders", "GET", undefined, "session=other")).status,
			403,
		)
		assert.equal(
			(
				await f.request("/reminders/rem-a/cancel", "POST", {
					commandKey: "cancel-key-a",
				})
			).status,
			202,
		)
		assert.deepEqual(f.calls.at(-1), {
			operation: "cancelReminder",
			id: "rem-a",
			payload: { commandKey: "cancel-key-a" },
		})
	} finally {
		await f.close()
	}
})
const chat = {
	chat: {
		id: "chat-a",
		bot: "bot-a",
		kind: "conversation",
		revision: 2,
		settings: { mode: "default" },
		createdAt: 1,
		parent: null,
	},
	status: "Completed",
	turn: null,
	response: null,
	activity: "inactive",
	inbox: 0,
	open: { delegations: 0, requests: 0, reminders: 0 },
}

const features = [
	{
		id: "files.listFiles",
		group: "files",
		title: "Files",
		description: "",
		method: "GET",
		params: null,
		query: null,
		payload: null,
		response: null,
		transport: "json",
	},
	{
		id: "requests.resolveRequest",
		group: "requests",
		title: "Resolve",
		description: "",
		method: "POST",
		params: null,
		query: null,
		payload: null,
		response: null,
		transport: "json",
	},
]

const fixture = async () => {
	const calls: NativeCall[] = []
	let behavior: (call: NativeCall, cookie: string) => Response = (
		call,
		cookie,
	) => {
		if (cookie !== "session=owner") return Response.json({}, { status: 403 })
		switch (call.operation) {
			case "access":
				return Response.json({ adminConsole: false })
			case "featureCatalog":
			case "visibleFeatureCatalog":
				return Response.json(features)
			case "featureDefinition": {
				const entry = features.find((entry) => entry.id === call.id)
				return Response.json(entry ?? {}, {
					status: entry === undefined ? 404 : 200,
				})
			}
			case "feature":
				return Response.json({ accepted: call.payload })
			case "memberSettings":
				return Response.json({ defaultBot: "bot-a" })
			case "bots":
				return Response.json([
					{
						id: "bot-a",
						name: "Kay",
						role: "A personal helper",
						archived: false,
					},
				])
			case "chats":
			case "branches":
				return Response.json([chat])
			case "send":
			case "sendToBot":
				return Response.json(
					{
						delivery: "queued",
						chat: "chat-a",
						item: "item-a",
						turn: null,
						response: null,
					},
					{ status: 202 },
				)
			case "items":
				return Response.json({
					items: [
						{
							id: "item-a",
							seq: 1,
							origin: { chat: "chat-a", turn: "turn-a", step: 0 },
							content: {
								content: [
									{ role: "user", content: [{ type: "text", text: "Hello" }] },
								],
							},
						},
					],
					next: null,
				})
			case "turns":
				return Response.json({
					items: [
						{
							id: "turn-a",
							chat: "chat-a",
							status: { _tag: "Completed" },
							startedAt: 1,
							completedAt: 2,
							input: ["item-a"],
							items: ["item-a"],
						},
					],
					next: null,
				})
			default:
				return Response.json(chat)
		}
	}
	const backend = createServer(async (req, res) => {
		const chunks = []
		for await (const chunk of req) chunks.push(chunk)
		const call: NativeCall = JSON.parse(Buffer.concat(chunks).toString())
		calls.push(call)
		const result = behavior(call, req.headers.cookie ?? "")
		res.writeHead(result.status, Object.fromEntries(result.headers))
		if (result.body !== null) {
			for await (const chunk of result.body) res.write(chunk)
		}
		res.end()
	})
	const upstream = await listen(backend)
	const factory: NativeClientFactory = ({ headers, signal }) => ({
		request: (call) =>
			fetch(upstream, {
				method: "POST",
				headers: {
					cookie: headers.get("cookie") ?? "",
					"content-type": "application/json",
				},
				body: JSON.stringify(call),
				signal,
			}),
	})
	const gateway = createServer(async (req, res) => {
		const chunks = []
		if (req.headers["content-type"]?.startsWith("multipart/form-data") !== true)
			for await (const chunk of req) chunks.push(chunk)
		const raw = Buffer.concat(chunks).toString()
		await handleProductRequest({
			req,
			res,
			url: new URL(req.url ?? "/", "http://localhost"),
			payload: raw === "" ? undefined : JSON.parse(raw),
			client: factory({
				headers: new Headers({ cookie: req.headers.cookie ?? "" }),
				signal: new AbortController().signal,
			}),
			identity: {
				userId: "owner",
				organizationId: "kay",
				displayName: "Sage",
				avatarUrl: "https://auth.example.test/avatar/sage",
			},
			requestId: "request-a",
		})
	})
	const origin = await listen(gateway)
	const request = (
		path: string,
		method = "GET",
		body?: unknown,
		cookie = "session=owner",
	) =>
		fetch(`${origin}/api/kay/v1${path}`, {
			method,
			headers: { cookie, "content-type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		})
	return {
		calls,
		origin,
		request,
		behavior: (next: typeof behavior) => {
			behavior = next
		},
		close: async () => {
			await close(gateway)
			await close(backend)
		},
	}
}

test("conversation activity preserves authorization and rejects a mixed revision", async () => {
	const f = await fixture()
	let revisionChanges = false,
		chatReads = 0
	f.behavior((call, cookie) => {
		if (cookie !== "session=owner") return Response.json({}, { status: 403 })
		if (call.operation === "chat") {
			chatReads++
			return Response.json({
				...chat,
				chat: { ...chat.chat, revision: revisionChanges ? chatReads : 2 },
			})
		}
		if (call.operation === "items")
			return Response.json({ items: [], next: null })
		if (call.id === "chats.chatTodos") return Response.json({ items: [] })
		return Response.json([])
	})
	try {
		const response = await f.request("/chats/chat-a/activity")
		assert.equal(response.status, 200)
		const activity = await response.json()
		assert.equal(activity.chatId, "chat-a")
		assert.equal(activity.progress, null)
		assert.deepEqual(activity.history, { complete: true, nextBefore: null })
		assert.equal(
			(
				await f.request(
					"/chats/chat-a/activity",
					"GET",
					undefined,
					"session=other",
				)
			).status,
			403,
		)
		assert.equal(
			(await f.request("/chats/chat-a/activity?accountId=other")).status,
			400,
		)
		revisionChanges = true
		assert.equal((await f.request("/chats/chat-a/activity")).status, 409)
		assert.ok(
			f.calls.every((call) =>
				["chat", "items", "feature"].includes(call.operation),
			),
		)
	} finally {
		await f.close()
	}
})

test("device overview uses the verified member's default Bot and rejects scope injection", async () => {
	const f = await fixture()
	f.behavior((call, cookie) => {
		if (cookie !== "session=owner") return Response.json({}, { status: 403 })
		if (call.operation === "memberSettings")
			return Response.json({ defaultBot: "bot-a" })
		assert.equal(call.id, "computers.listComputers")
		return Response.json([])
	})
	try {
		const response = await f.request("/devices")
		assert.equal(response.status, 200)
		const devices = await response.json()
		assert.equal(devices.defaultBotId, "bot-a")
		assert.deepEqual(
			devices.groups.map((group: { category: string }) => group.category),
			["computer", "phone", "smart"],
		)
		assert.deepEqual(f.calls.at(-1)?.payload, { query: { bot: "bot-a" } })
		assert.equal((await f.request("/devices?bot=other")).status, 400)
		assert.equal(
			(await f.request("/devices", "GET", undefined, "session=other")).status,
			403,
		)
	} finally {
		await f.close()
	}
})

test("platform configuration is hidden and denied to ordinary users, including after revocation", async () => {
	const f = await fixture()
	let administrator = false
	const admin = {
		...features[0]!,
		id: "modelProviders.listModelProviders",
		group: "modelProviders",
	}
	f.behavior((call) => {
		if (call.operation === "access")
			return Response.json({ adminConsole: administrator })
		if (call.operation === "visibleFeatureCatalog")
			return Response.json([...features, admin])
		if (call.operation === "featureDefinition") return Response.json(admin)
		return Response.json([])
	})
	try {
		assert.deepEqual(
			await (await f.request("/features/catalog")).json(),
			features,
		)
		assert.equal((await f.request("/features/" + admin.id)).status, 403)
		assert.equal(
			f.calls.filter((call) => call.operation === "feature").length,
			0,
		)
		administrator = true
		assert.equal((await f.request("/features/" + admin.id)).status, 200)
		administrator = false
		assert.equal((await f.request("/features/" + admin.id)).status, 403)
		assert.equal(
			f.calls.filter((call) => call.operation === "feature").length,
			1,
		)
	} finally {
		await f.close()
	}
})

test("execution result reads keep native authorization and never dispatch another command", async () => {
	const f = await fixture()
	const operation = { ...features[1]!, resultMode: "execution" }
	f.behavior((call) => {
		if (call.operation === "featureDefinition") return Response.json(operation)
		if (call.operation === "featureResult")
			return Response.json({ pending: true })
		if (call.operation === "commandReceipt") return Response.json(null)
		return Response.json({}, { status: 403 })
	})
	try {
		assert.equal(
			(
				await f.request(
					"/feature-results/execution-a?operation=requests.resolveRequest",
				)
			).status,
			200,
		)
		assert.equal(
			(
				await f.request(
					"/feature-results/execution-a?operation=requests.resolveRequest&payload=secret",
				)
			).status,
			400,
		)
		assert.equal(
			await (await f.request("/execution-commands/command-a")).json(),
			null,
		)
		assert.equal((await f.request("/executions/other-user")).status, 403)
		assert.equal(
			f.calls.some(
				(call) => call.operation === "feature" || call.operation === "send",
			),
			false,
		)
	} finally {
		await f.close()
	}
})

test("bootstrap and history expose stable product values over HTTP", async () => {
	const f = await fixture()
	try {
		const response = await f.request("/bootstrap")
		assert.equal(response.status, 200)
		const result = await response.json()
		assert.equal(result.defaultBotId, "bot-a")
		assert.deepEqual(result.identity, {
			userId: "owner",
			organizationId: "kay",
			displayName: "Sage",
			avatarUrl: "https://auth.example.test/avatar/sage",
		})
		assert.equal(result.companions[0].isDefault, true)
		assert.equal(result.conversations[0].id, "chat-a")
		assert.equal(result.conversations[0].botId, "bot-a")
		assert.equal(result.features.live, true)
		const page = await (
			await f.request("/chats/chat-a/items?before=2&limit=10")
		).json()
		assert.equal(page.items[0].parts[0].text, "Hello")
		assert.equal(page.items[0].turnId, "turn-a")
		const history = await (await f.request("/chats/chat-a/turns")).json()
		assert.equal(history.items[0].status, "Completed")
	} finally {
		await f.close()
	}
})

test("both conversation modes preserve accepted queued receipts without another send", async () => {
	const f = await fixture()
	try {
		for (const path of ["/bots/bot-a/messages", "/chats/chat-a/messages"]) {
			const response = await f.request(path, "POST", {
				input: [
					{ type: "text", text: "Hello" },
					{ type: "image", fileId: "file-a" },
				],
				stream: true,
			})
			assert.equal(response.status, 202)
			assert.deepEqual(await response.json(), {
				delivery: "queued",
				chatId: "chat-a",
				itemId: "item-a",
				turnId: null,
			})
		}
		assert.equal(f.calls.length, 2)
		assert.deepEqual(f.calls[0]?.payload, {
			input: [
				{
					role: "user",
					content: [
						{ type: "input_text", text: "Hello" },
						{ type: "input_image", file_id: "file-a" },
					],
				},
			],
			stream: true,
		})
	} finally {
		await f.close()
	}
})

test("foreign credentials stay denied and native 401 never becomes 403", async () => {
	const f = await fixture()
	try {
		const denied = await f.request(
			"/chats/chat-a",
			"GET",
			undefined,
			"session=other",
		)
		assert.equal(denied.status, 403)
		assert.equal((await denied.json()).code, "forbidden")
		f.behavior(() => Response.json({}, { status: 401 }))
		const signedOut = await f.request("/chats/chat-a")
		assert.equal(signedOut.status, 401)
		assert.equal((await signedOut.json()).code, "unauthorized")
	} finally {
		await f.close()
	}
})

test("invalid client commands never reach the core and malformed core data is unavailable", async () => {
	const f = await fixture()
	try {
		for (const [path, method, body] of [
			[
				"/chats",
				"POST",
				{ botId: "bot-a", requestId: "one", userId: "forged" },
			],
			["/chats/chat-a/items?limit=1000", "GET", undefined],
			["/chats/chat-a/wait?after=1&after=2", "GET", undefined],
		] as const)
			assert.equal((await f.request(path, method, body)).status, 400)
		assert.equal(f.calls.length, 0)
		assert.equal(
			(await f.request("/internal/execution/acquire", "POST", {})).status,
			404,
		)
		f.behavior(() => Response.json({ invalid: true }))
		assert.equal((await f.request("/chats/chat-a")).status, 503)
	} finally {
		await f.close()
	}
})

test("SSE text is relayed before the core completes the response", async () => {
	const f = await fixture()
	let finish: (() => void) | undefined
	f.behavior(
		() =>
			new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(
							new TextEncoder().encode(
								'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","chat":"chat-a","turn":"turn-a","sequence_number":1,"delta":"Hello"}\n\n',
							),
						)
						finish = () => {
							finish = undefined
							controller.close()
						}
					},
				}),
				{ headers: { "content-type": "text/event-stream" } },
			),
	)
	try {
		const response = await f.request("/chats/chat-a/messages", "POST", {
			input: "Hello",
			stream: true,
		})
		assert.equal(response.headers.get("x-accel-buffering"), "no")
		const reader = response.body!.getReader()
		const first = await reader.read()
		assert.match(new TextDecoder().decode(first.value), /"chatId":"chat-a"/)
		assert.match(new TextDecoder().decode(first.value), /"delta":"Hello"/)
		finish?.()
		while (!(await reader.read()).done) {
			/* Complete the single response. */
		}
		assert.equal(f.calls.length, 1)
	} finally {
		finish?.()
		await f.close()
	}
})

test("read-only Chat events relay safe tool activity and never accept execution scope from the browser", async () => {
	const f = await fixture()
	try {
		f.behavior((call, cookie) => {
			assert.equal(call.operation, "observeChat")
			if (cookie !== "session=owner") return Response.json({}, { status: 403 })
			return new Response(
				`event: response.tool_activity\ndata: ${JSON.stringify({
					type: "response.tool_activity",
					chat: "chat-a",
					turn: "turn-a",
					executionId: "exec-a",
					executionSequence: 12,
					sequence_number: 0,
					toolActivity: {
						step: "tool:4:itemcall",
						attempt: 0,
						itemId: "item",
						callId: "call",
						name: "computer_terminal",
						computerId: "computer-a",
						status: "queued",
						params: "private-token",
					},
				})}\n\n`,
				{ headers: { "content-type": "text/event-stream" } },
			)
		})
		const response = await f.request("/chats/chat-a/events")
		assert.equal(response.status, 200)
		const text = await response.text()
		assert.match(text, /"toolActivity"/)
		assert.match(text, /"status":"queued"/)
		assert.doesNotMatch(text, /private-token|params|accepted/)
		assert.deepEqual(f.calls[0], { operation: "observeChat", id: "chat-a" })
		assert.equal(
			(await f.request("/chats/chat-a/events?executionId=foreign")).status,
			400,
		)
		assert.equal(
			(await f.request("/chats/chat-a/events?afterSequence=99")).status,
			400,
		)
		assert.equal(
			(
				await f.request(
					"/chats/chat-a/events",
					"GET",
					undefined,
					"session=other",
				)
			).status,
			403,
		)
		f.behavior(() => new Response(null, { status: 204 }))
		assert.equal((await f.request("/chats/chat-a/events")).status, 204)
	} finally {
		await f.close()
	}
})

test("the new API is disabled by default and cannot bypass the legacy gateway", async () => {
	let called = false
	const config: Configuration = {
		port: 3100,
		internalPort: 3101,
		internalToken: "fixture-token-with-more-than-32-characters",
		publicOrigin: "https://kay.example",
		eOrigin: "http://127.0.0.1:1",
		openbotOrigin: "http://127.0.0.1:1",
		authBackend: "e",
		backendRouting: "e",
		databaseUrl: "postgres://unused:unused@127.0.0.1:1/unused",
	}
	const db = runtime(config),
		gateway = createGateway({
			config,
			db,
			nativeProduct: () => ({
				request: async () => {
					called = true
					return Response.json({})
				},
			}),
		})
	const origin = await listen(gateway)
	try {
		assert.equal((await fetch(`${origin}/api/kay/v1/bootstrap`)).status, 404)
		assert.equal(called, false)
	} finally {
		await close(gateway)
		await db.dispose()
	}
})

test("feature routes admit only catalog methods and preserve read versus write inputs", async () => {
	const f = await fixture()
	try {
		const catalog = await (await f.request("/features/catalog")).json()
		assert.equal(catalog.length, 2)
		const query = encodeURIComponent(JSON.stringify({ query: { limit: 5 } }))
		const result = await f.request(`/features/files.listFiles?input=${query}`)
		assert.equal(result.status, 200)
		assert.deepEqual(await result.json(), { accepted: { query: { limit: 5 } } })
		const command = {
			params: { requestId: "approval-a" },
			payload: { expected: 2, decision: "deny" },
		}
		assert.equal(
			(await f.request("/features/requests.resolveRequest", "POST", command))
				.status,
			200,
		)
		assert.equal(
			(await f.request("/features/requests.resolveRequest")).status,
			404,
		)
		assert.equal(
			(await f.request("/features/triggerHooks.fireTrigger", "POST", {}))
				.status,
			404,
		)
		assert.equal(
			(await f.request("/features/files.listFiles?input=broken")).status,
			400,
		)
		assert.equal(
			(
				await f.request("/features/requests.resolveRequest", "POST", {
					headers: { "x-user-id": "forged" },
				})
			).status,
			400,
		)
		assert.equal(
			f.calls.filter((call) => call.operation === "feature").length,
			2,
		)
	} finally {
		await f.close()
	}
})

test("a core 5xx after a write stays uncertain while reads remain unavailable", async () => {
	const f = await fixture()
	try {
		f.behavior(() => Response.json({}, { status: 503 }))
		assert.equal(
			(
				await (
					await f.request("/chats/chat-a/messages", "POST", { input: "Once" })
				).json()
			).code,
			"outcome_unknown",
		)
		assert.equal(
			(await (await f.request("/chats/chat-a")).json()).code,
			"unavailable",
		)
		assert.equal(f.calls.length, 2)
	} finally {
		await f.close()
	}
})

test("upload validation preserves safe native Files messages and HTTP status", async () => {
	const f = await fixture()
	let status = 400
	let body: unknown = {
		_tag: "FileInvalid",
		message:
			"The platform does not take files of type application/vnd.openxmlformats-officedocument.presentationml.presentation.",
	}
	try {
		f.behavior((call) =>
			call.operation === "featureDefinition"
				? Response.json({
						id: call.id,
						group: "files",
						title: "Upload",
						description: "",
						method: "POST",
						params: null,
						query: null,
						payload: null,
						response: null,
						transport: call.id === "files.uploadFile" ? "multipart" : "json",
					})
				: Response.json(body, { status }),
		)
		for (const operation of [
			"files.uploadFile",
			"files.createUpload",
			"files.completeUpload",
		]) {
			const form = new FormData()
			form.append(
				"file",
				new Blob(["slides"], { type: "application/octet-stream" }),
				"slides.pptx",
			)
			const response =
				operation === "files.uploadFile"
					? await fetch(`${f.origin}/api/kay/v1/features/${operation}`, {
							method: "POST",
							headers: { cookie: "session=owner" },
							body: form,
						})
					: await f.request(`/features/${operation}`, "POST", {})
			assert.equal(response.status, 400)
			assert.deepEqual(await response.json(), {
				code: "invalid_input",
				message: (body as { message: string }).message,
				requestId: "request-a",
			})
		}
		status = 413
		body = {
			_tag: "FileQuotaExceeded",
			message:
				"You may keep 100 bytes of files. Your files take 90 bytes now, so a file of 20 bytes does not fit. Delete some files first.",
			quotaBytes: 100,
			usedBytes: 90,
		}
		const response = await f.request("/features/files.createUpload", "POST", {})
		assert.equal(response.status, 413)
		assert.deepEqual(await response.json(), {
			code: "invalid_input",
			message: (body as { message: string }).message,
			requestId: "request-a",
		})
		assert.equal(
			f.calls.filter((call) => call.operation === "feature").length,
			4,
		)
	} finally {
		await f.close()
	}
})

test("upload errors never expose provider text or turn uncertain writes into validation failures", async () => {
	const f = await fixture()
	let status = 400
	let body: unknown
	try {
		f.behavior((call) =>
			call.operation === "featureDefinition"
				? Response.json({
						id: call.id,
						group: "files",
						title: "Upload",
						description: "",
						method: "POST",
						params: null,
						query: null,
						payload: null,
						response: null,
						transport: "json",
					})
				: Response.json(body, { status }),
		)
		for (const value of [
			{ _tag: "FilesUnavailable", message: "private provider response" },
			{ _tag: "FileInvalid", message: "private provider response" },
			{
				_tag: "FileInvalid",
				message: "The platform does not take files of type secret token.",
			},
			{
				_tag: "FileQuotaExceeded",
				message: "private provider response",
				quotaBytes: 100,
				usedBytes: 90,
			},
			{
				_tag: "FileQuotaExceeded",
				message:
					"You may keep 100 bytes of files. Your files take 90 bytes now, so a file of 20 bytes does not fit. Delete some files first.",
				quotaBytes: 999,
				usedBytes: 90,
			},
		]) {
			body = value
			status = value._tag === "FileQuotaExceeded" ? 413 : 400
			const response = await f.request(
				"/features/files.createUpload",
				"POST",
				{},
			)
			assert.equal(response.status, status)
			assert.equal(
				(await response.json()).message,
				"Kay could not finish this request.",
			)
		}
		body = { _tag: "FileInvalid", message: "The file is not ready." }
		status = 400
		assert.equal(
			(
				await (
					await f.request("/features/requests.resolveRequest", "POST", {})
				).json()
			).message,
			"Kay could not finish this request.",
		)
		status = 503
		assert.equal(
			(
				await (
					await f.request("/features/files.completeUpload", "POST", {})
				).json()
			).code,
			"outcome_unknown",
		)
		status = 403
		assert.equal(
			(
				await (
					await f.request("/features/files.createUpload", "POST", {})
				).json()
			).message,
			"You do not have access to this item.",
		)
	} finally {
		await f.close()
	}
})

test("attachment routes validate Chat scope and preserve one native attachment command", async () => {
	const f = await fixture()
	try {
		const payload = { fileId: "file-a", requestId: "request-a", expected: 2 }
		const response = await f.request("/chats/chat-a/files", "POST", payload)
		assert.equal(response.status, 200)
		assert.equal((await response.json()).id, "chat-a")
		assert.deepEqual(f.calls, [
			{ operation: "attachFile", id: "chat-a", payload },
		])
		for (const invalid of [
			{ ...payload, expected: -1 },
			{ ...payload, requestId: "" },
			{ ...payload, fileId: "" },
			{ ...payload, userId: "another-user" },
		])
			assert.equal(
				(await f.request("/chats/chat-a/files", "POST", invalid)).status,
				400,
			)
		assert.equal(
			(await f.request("/bots/bot-a/files", "POST", payload)).status,
			404,
		)
		assert.equal((await f.request("/chats/chat-a/files")).status, 404)
		assert.equal(f.calls.length, 1)
		assert.equal(
			(await f.request("/chats/chat-a/files", "POST", payload, "session=other"))
				.status,
			403,
		)
		assert.deepEqual(f.calls.at(-1), {
			operation: "attachFile",
			id: "chat-a",
			payload,
		})
	} finally {
		await f.close()
	}
})

test("attachment failures distinguish permission, conflict and unknown results without dispatching messages", async () => {
	const f = await fixture()
	try {
		const payload = { fileId: "file-a", requestId: "request-a", expected: 2 }
		for (const status of [401, 403, 409, 503, 200]) {
			f.behavior(() =>
				Response.json({ private: "must not expose" }, { status }),
			)
			const response = await f.request("/chats/chat-a/files", "POST", payload)
			const result = await response.json()
			assert.equal(response.status, status === 200 ? 503 : status)
			assert.equal(
				result.code,
				status === 401
					? "unauthorized"
					: status === 403
						? "forbidden"
						: status === 409
							? "conflict"
							: "outcome_unknown",
			)
			assert.doesNotMatch(JSON.stringify(result), /must not expose/)
		}
		assert.equal(f.calls.length, 5)
		assert.ok(f.calls.every((call) => call.operation === "attachFile"))
	} finally {
		await f.close()
	}
})
