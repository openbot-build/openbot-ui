import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer, type Server } from "node:http"
import { test } from "node:test"
import { createNativeClient } from "../src/index.ts"

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

test("native SDK uses the native Chat API and only forwards admitted credentials", async () => {
	const requests: Array<{ method: string; path: string; body: unknown }> = []
	const backend = createServer(async (req, res) => {
		assert.equal(req.headers.cookie, "session=owner")
		assert.equal(req.headers["openbot-organization"], "kay")
		assert.equal(req.headers["x-kay-epoch"], "2")
		assert.equal(req.headers["x-user-id"], undefined)
		const chunks = []
		for await (const chunk of req) chunks.push(chunk)
		const raw = Buffer.concat(chunks).toString()
		requests.push({
			method: req.method ?? "",
			path: req.url ?? "",
			body: raw === "" ? undefined : JSON.parse(raw),
		})
		res.writeHead(202, { "content-type": "application/json" })
		res.end(
			JSON.stringify({
				executionId: "execution-a",
				commandKey: "command-a",
				sequence: 1,
				chat: "chat-a",
				turn: "turn-a",
			}),
		)
	})
	const origin = await listen(backend)
	try {
		const client = createNativeClient({ origin })({
			headers: new Headers({
				cookie: "session=owner",
				"openbot-organization": "kay",
				"x-kay-epoch": "2",
				"x-user-id": "forged",
			}),
			signal: new AbortController().signal,
		})
		await (
			await client.request({
				operation: "create",
				payload: {
					botId: "bot-a",
					requestId: "request-a",
					memory: { read: false, write: false },
				},
			})
		).json()
		await (
			await client.request({
				operation: "fork",
				id: "chat-a",
				payload: { expected: 2, requestId: "request-b", reason: "fork" },
			})
		).json()
		await (await client.request({ operation: "branches", id: "chat-a" })).json()
		const result = await client.request({
			operation: "sendToBot",
			id: "bot-a",
			payload: {
				input: "Hello",
				stream: false,
				commandKey: "command-a",
				memory: { read: false, write: false },
			},
		})
		assert.equal(result.status, 202)
		assert.deepEqual(await result.json(), {
			executionId: "execution-a",
			commandKey: "command-a",
			sequence: 1,
			chat: "chat-a",
			turn: "turn-a",
			delivery: "accepted",
			item: null,
		})
		assert.deepEqual(requests[3]?.body, {
			input: "Hello",
			commandKey: "command-a",
			memory: { read: false, write: false },
		})
		assert.deepEqual(
			requests.map((r) => [r.method, r.path]),
			[
				["POST", "/v1/chats"],
				["POST", "/v1/chats/chat-a/forks"],
				["GET", "/v1/chats/chat-a/branches"],
				["POST", "/v1/bots/bot-a/messages"],
			],
		)
		assert.deepEqual(requests[0]?.body, {
			botId: "bot-a",
			requestId: "request-a",
			memory: { read: false, write: false },
		})
	} finally {
		await close(backend)
	}
})

test("native SDK preserves authorization failures without redirecting or resending", async () => {
	let count = 0
	let status = 401
	const backend = createServer((_req, res) => {
		count++
		res.writeHead(status, {
			"content-type": "application/json",
			location: "/login",
		})
		res.end("{}")
	})
	const origin = await listen(backend)
	try {
		const client = createNativeClient({ origin })({
			headers: new Headers(),
			signal: new AbortController().signal,
		})
		for (const next of [401, 403, 307]) {
			status = next
			const result = await client.request({
				operation: "send",
				id: "chat-a",
				payload: { input: "Hello" },
			})
			assert.equal(result.status, next)
			await result.text()
		}
		assert.equal(count, 3)
	} finally {
		await close(backend)
	}
})

test("a malformed accepted receipt remains uncertain and never becomes a rejected input", async () => {
	let writes = 0
	const backend = createServer((_req, res) => {
		writes++
		res.writeHead(202, { "content-type": "application/json" })
		res.end("{}")
	})
	const origin = await listen(backend)
	try {
		const client = createNativeClient({ origin })({
			headers: new Headers(),
			signal: new AbortController().signal,
		})
		const response = await client.request({
			operation: "send",
			id: "chat",
			payload: { input: "Once", commandKey: "one-command" },
		})
		assert.equal(response.status, 503)
		assert.equal((await response.json()).code, "outcome_unknown")
		assert.equal(writes, 1)
	} finally {
		await close(backend)
	}
})

test("an accepted command streams its durable execution without another send", async () => {
	let writes = 0
	let observations = 0
	let finish: (() => void) | undefined
	const backend = createServer((req, res) => {
		if (req.method === "POST") {
			writes++
			res.writeHead(202, { "content-type": "application/json" })
			res.end(
				JSON.stringify({
					executionId: "execution-a",
					commandKey: "command-a",
					sequence: 1,
					chat: "chat-a",
					turn: "turn-a",
				}),
			)
			return
		}
		observations++
		assert.equal(req.url, "/v1/executions/execution-a/observe?afterSequence=0")
		res.writeHead(200, { "content-type": "text/event-stream" })
		res.write(
			`event: execution\ndata: ${JSON.stringify({ executionId: "execution-a", sequence: 2, createdAt: 1, body: { _tag: "Text", step: "model:0", attempt: 0, text: "Hello" } })}\n\n`,
		)
		finish = () => {
			finish = undefined
			res.end()
		}
	})
	const origin = await listen(backend)
	try {
		const client = createNativeClient({ origin })({
			headers: new Headers(),
			signal: new AbortController().signal,
		})
		const result = await client.request({
			operation: "send",
			id: "chat-a",
			payload: { input: "Hello", stream: true },
		})
		const reader = result.body!.getReader()
		assert.match(
			new TextDecoder().decode((await reader.read()).value),
			/response.accepted/,
		)
		assert.match(new TextDecoder().decode((await reader.read()).value), /Hello/)
		assert.equal(writes, 1)
		assert.equal(observations, 1)
		finish?.()
		while (!(await reader.read()).done) {
			/* Read only this observation. */
		}
	} finally {
		finish?.()
		await close(backend)
	}
})

test("feature catalog covers native product services with resolvable schemas and no machine hooks", async () => {
	const client = createNativeClient({ origin: "http://127.0.0.1:1" })({
		headers: new Headers(),
		signal: new AbortController().signal,
	})
	const catalog = await (
		await client.request({ operation: "featureCatalog" })
	).json()
	assert.ok(catalog.length > 200)
	for (const name of [
		"requests.resolveRequest",
		"files.uploadFile",
		"computers.exec",
		"bots.createRule",
		"channels.createChannel",
		"triggers.createTrigger",
		"platform.updatePlatformSettings",
		"vaults.createVaultItem",
	])
		assert.ok(
			catalog.some((entry: { id: string }) => entry.id === name),
			name,
		)
	assert.ok(
		catalog.every(
			(entry: { id: string }) =>
				!/Hooks\.|^signIn\.|^account\.|platform\.(?:update|grant)PlatformOrganizationCredits$/.test(
					entry.id,
				),
		),
	)
	for (const entry of catalog)
		for (const slot of ["params", "query", "payload", "response"]) {
			const schema = entry[slot]
			if (schema === null) continue
			const inspect = (value: unknown): void => {
				if (Array.isArray(value)) {
					value.forEach(inspect)
					return
				}
				if (typeof value !== "object" || value === null) return
				for (const [key, child] of Object.entries(value)) {
					if (key === "$ref") {
						assert.equal(typeof child, "string")
						assert.match(String(child), /^#\/\$defs\//)
						assert.ok(schema.$defs[String(child).slice(8)])
					} else inspect(child)
				}
			}
			inspect(schema)
		}
})

test("partial platform settings keep optional policy fields and use the SDK runtime", async () => {
	const requests: Array<unknown> = []
	const backend = createServer(async (req, res) => {
		assert.equal(req.url, "/v1/platform/settings")
		assert.equal(req.method, "PATCH")
		const chunks = []
		for await (const chunk of req) chunks.push(chunk)
		requests.push(JSON.parse(Buffer.concat(chunks).toString()))
		res.writeHead(200, { "content-type": "application/json" })
		res.end("{}")
	})
	try {
		const client = createNativeClient({ origin: await listen(backend) })({
			headers: new Headers(),
			signal: new AbortController().signal,
		})
		const payload = { expectedVersion: 3, files: { maxBytes: 1024 } }
		const result = await client.request({
			operation: "feature",
			id: "platform.updatePlatformSettings",
			payload: { payload },
		})
		assert.equal(result.status, 200)
		assert.deepEqual(requests, [payload])
	} finally {
		await close(backend)
	}
})

test("feature executor validates native writes and handles files without another protocol", async () => {
	const requests: Array<{ path: string; type: string; body: string }> = []
	const backend = createServer(async (req, res) => {
		const chunks = []
		for await (const chunk of req) chunks.push(chunk)
		requests.push({
			path: req.url ?? "",
			type: req.headers["content-type"] ?? "",
			body: Buffer.concat(chunks).toString(),
		})
		res.writeHead(200, { "content-type": "application/json" })
		res.end("{}")
	})
	const origin = await listen(backend)
	try {
		const client = createNativeClient({ origin })({
			headers: new Headers(),
			signal: new AbortController().signal,
		})
		await (
			await client.request({
				operation: "feature",
				id: "bots.createBot",
				payload: {
					payload: {
						name: "Research",
						role: "Read sources",
						instructions: "Cite the sources you use.",
					},
				},
			})
		).json()
		await (
			await client.request({
				operation: "feature",
				id: "requests.resolveRequest",
				payload: {
					params: { requestId: "request-a" },
					payload: { expected: 1, decision: "deny" },
				},
			})
		).json()
		const body = new FormData()
		body.set("file", new File(["hello"], "hello.txt", { type: "text/plain" }))
		await (
			await client.request({
				operation: "feature",
				id: "files.uploadFile",
				payload: { payload: body },
			})
		).json()
		assert.equal(
			(
				await client.request({
					operation: "feature",
					id: "bots.createBot",
					payload: { payload: { name: "Invalid" } },
				})
			).status,
			400,
		)
		await (
			await client.request({
				operation: "feature",
				id: "appIndex.searchApps",
				payload: { query: { query: "cloud", limit: 3 } },
			})
		).json()
		assert.equal(requests.length, 4)
		assert.equal(requests[1]?.path, "/v1/requests/request-a")
		assert.match(requests[2]?.type ?? "", /multipart\/form-data/)
		assert.match(requests[2]?.body ?? "", /hello.txt/)
	} finally {
		await close(backend)
	}
})

test("the visible catalog asks native identity and current permissions without inferring roles", async () => {
	let status = 200
	let admin = false
	let resources = [{ kind: "Organization", actions: ["read"] }]
	const backend = createServer((req, res) => {
		assert.equal(req.headers.cookie, "session=owner")
		res.writeHead(status, { "content-type": "application/json" })
		if (status !== 200) {
			res.end("{}")
			return
		}
		res.end(
			JSON.stringify(
				req.url === "/auth/session"
					? {
							userId: "owner",
							profile: {},
							memberships: [
								{
									organizationId: "kay",
									name: "Kay",
									status: "active",
									roles: ["super_administrator"],
								},
							],
							platformAdmin: admin,
							expiresAt: "2027-01-01T00:00:00Z",
						}
					: { resources },
			),
		)
	})
	const origin = await listen(backend)
	try {
		const client = createNativeClient({ origin })({
			headers: new Headers({
				cookie: "session=owner",
				"openbot-organization": "kay",
			}),
			signal: new AbortController().signal,
		})
		const load = async () => {
			const response = await client.request({
				operation: "visibleFeatureCatalog",
			})
			assert.equal(response.status, 200)
			const value: Array<{ id: string }> = await response.json()
			return new Set(value.map((entry) => entry.id))
		}
		const limited = await load()
		assert.ok(limited.has("organization.getOrganization"))
		assert.ok(!limited.has("organization.updateOrganization"))
		assert.ok(!limited.has("platform.getPlatformSettings"))
		admin = true
		resources = [{ kind: "Organization", actions: ["read", "write"] }]
		const changed = await load()
		assert.ok(changed.has("organization.updateOrganization"))
		assert.ok(changed.has("platform.getPlatformSettings"))
		assert.ok(!changed.has("organization.createRole"))
		for (const denied of [401, 403, 503]) {
			status = denied
			const response = await client.request({
				operation: "visibleFeatureCatalog",
			})
			assert.equal(response.status, denied)
			await response.body?.cancel()
		}
	} finally {
		await close(backend)
	}
})

test("product attachment and reminder calls dispatch through their native SDK endpoints once", async () => {
	const requests: Array<{ method: string; path: string; body: unknown }> = []
	const backend = createServer(async (req, res) => {
		assert.equal(req.headers.cookie, "session=owner")
		assert.equal(req.headers["openbot-organization"], "kay")
		const chunks = []
		for await (const chunk of req) chunks.push(chunk)
		const body = Buffer.concat(chunks).toString()
		requests.push({
			method: req.method ?? "",
			path: req.url ?? "",
			body: body === "" ? undefined : JSON.parse(body),
		})
		res.writeHead(200, { "content-type": "application/json" })
		res.end(JSON.stringify({ nativeEndpointReached: req.url }))
	})
	const origin = await listen(backend)
	try {
		const client = createNativeClient({ origin })({
			headers: new Headers({
				cookie: "session=owner",
				"openbot-organization": "kay",
			}),
			signal: new AbortController().signal,
		})
		const calls = [
			{
				operation: "attachFile" as const,
				id: "chat-a",
				payload: {
					fileId: "file-a",
					requestId: "attachment-request",
					expected: 2,
				},
			},
			{
				operation: "reminders" as const,
				query: { chatId: "chat-a", after: "rem-before" },
			},
			{ operation: "reminder" as const, id: "rem-a" },
			{
				operation: "cancelReminder" as const,
				id: "rem-a",
				payload: { commandKey: "cancel-request" },
			},
		]
		for (const call of calls) {
			const response = await client.request(call)
			assert.equal(response.status, 200)
			assert.equal(
				typeof (await response.json()).nativeEndpointReached,
				"string",
			)
		}
		assert.deepEqual(requests, [
			{
				method: "POST",
				path: "/v1/chats/chat-a/files",
				body: {
					fileId: "file-a",
					requestId: "attachment-request",
					expected: 2,
				},
			},
			{
				method: "GET",
				path: "/v1/reminders?chatId=chat-a&after=rem-before",
				body: undefined,
			},
			{ method: "GET", path: "/v1/reminders/rem-a", body: undefined },
			{
				method: "POST",
				path: "/v1/reminders/rem-a/cancel",
				body: { commandKey: "cancel-request" },
			},
		])
	} finally {
		await close(backend)
	}
})

test("native attachment and reminder failures preserve permissions and never fall back to another command", async () => {
	let writes = 0
	const backend = createServer((_req, res) => {
		writes++
		res.writeHead(403, { "content-type": "application/json" })
		res.end("{}")
	})
	const origin = await listen(backend)
	try {
		const client = createNativeClient({ origin })({
			headers: new Headers(),
			signal: new AbortController().signal,
		})
		for (const call of [
			{
				operation: "attachFile" as const,
				id: "chat-a",
				payload: { fileId: "file-a", requestId: "request-a", expected: 2 },
			},
			{
				operation: "cancelReminder" as const,
				id: "rem-a",
				payload: { commandKey: "cancel-a" },
			},
		]) {
			const response = await client.request(call)
			assert.equal(response.status, 403)
			await response.text()
		}
		assert.equal(writes, 2)
	} finally {
		await close(backend)
	}
})
