import assert from "node:assert/strict"
import { once } from "node:events"
import { createHash } from "node:crypto"
import { createServer, request, type Server } from "node:http"
import type { Duplex } from "node:stream"
import { test } from "node:test"
import {
	attachNativeLiveProxy,
	closeNativeLiveProxy,
	LiveProxyFailure,
	type LiveAdmission,
} from "../src/NativeLiveProxy.ts"
import { makeTelemetry } from "../src/Telemetry.ts"

const listen = async (server: Server) => {
	server.listen(0, "127.0.0.1")
	await once(server, "listening")
	const address = server.address()
	if (address === null || typeof address === "string")
		throw new Error("Expected TCP address")
	return `http://127.0.0.1:${address.port}`
}
const close = async (server: Server) => {
	server.closeAllConnections()
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error !== undefined ? reject(error) : resolve())),
	)
}
const upgrade = (
	origin: string,
	headers: Record<string, string> = {},
	path = "/api/kay/v1/chats/chat-a/live",
) =>
	new Promise<{ status: number; socket?: Duplex; body?: string }>(
		(resolve, reject) => {
			const req = request(new URL(path, origin), {
				headers: {
					origin: "https://kay.example",
					connection: "Upgrade",
					upgrade: "websocket",
					"sec-websocket-version": "13",
					"sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
					...headers,
				},
			})
			req.once("upgrade", (response, socket) =>
				resolve({ status: response.statusCode!, socket }),
			)
			req.once("response", async (response) => {
				let body = ""
				for await (const chunk of response) body += chunk.toString()
				resolve({ status: response.statusCode!, body })
			})
			req.once("error", reject)
			req.end()
		},
	)
const waitFor = async (predicate: () => boolean) => {
	for (let attempt = 0; attempt < 100 && !predicate(); attempt++)
		await new Promise((resolve) => setTimeout(resolve, 10))
	assert.ok(predicate(), "Condition did not become true")
}

test("native Live upgrades once and relays binary frames without rewriting or replay", async () => {
	let connections = 0,
		released = 0
	let remote: Duplex | undefined
	const backend = createServer()
	backend.on("upgrade", (req, socket) => {
		connections++
		remote = socket
		assert.equal(req.url, "/v1/chats/chat-a/live?organization=kay")
		assert.equal(req.headers.cookie, "session=verified")
		assert.equal(req.headers["x-kay-epoch"], "4")
		const accept = createHash("sha1")
			.update(
				`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`,
			)
			.digest("base64")
		socket.write(
			`HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
		)
		socket.on("data", (chunk) => socket.write(chunk))
	})
	const upstream = await listen(backend)
	const gateway = createServer()
	const stop = attachNativeLiveProxy({
		server: gateway,
		publicOrigin: "https://kay.example",
		telemetry: makeTelemetry(),
		authorize: async () => ({
			target: new URL("/v1/chats/chat-a/live?organization=kay", upstream),
			headers: new Headers({ cookie: "session=verified", "x-kay-epoch": "4" }),
			release: async () => {
				released++
			},
			revalidate: async () => true,
		}),
	})
	const origin = await listen(gateway)
	try {
		const result = await upgrade(origin)
		assert.equal(result.status, 101)
		const frame = Buffer.from([0x82, 0x83, 1, 2, 3, 4, 0xff, 0x00, 0x81])
		const received = once(result.socket!, "data")
		result.socket!.write(frame)
		assert.deepEqual((await received)[0], frame)
		closeNativeLiveProxy(gateway)
		await once(result.socket!, "close")
		await waitFor(() => released === 1)
		assert.equal(connections, 1)
	} finally {
		stop()
		remote?.destroy()
		await close(gateway)
		await close(backend)
	}
})

test("origin and route rejection happens before authentication or opening the backend", async () => {
	let calls = 0
	const gateway = createServer()
	attachNativeLiveProxy({
		server: gateway,
		publicOrigin: "https://kay.example",
		telemetry: makeTelemetry(),
		authorize: async () => {
			calls++
			throw new LiveProxyFailure(401, "unauthorized", "Sign in.")
		},
	})
	const origin = await listen(gateway)
	try {
		assert.equal(
			(await upgrade(origin, { origin: "https://foreign.example" })).status,
			403,
		)
		assert.equal((await upgrade(origin, {}, "/internal/live")).status, 404)
		assert.equal(calls, 0)
		const denied = await upgrade(origin)
		assert.equal(denied.status, 401)
		assert.equal(JSON.parse(denied.body!).code, "unauthorized")
		assert.equal(calls, 1)
	} finally {
		await close(gateway)
	}
})

test("a denied upstream handshake releases admission and never retries", async () => {
	let calls = 0,
		released = 0
	const backend = createServer()
	backend.on("upgrade", (_req, socket) => {
		calls++
		socket.end(
			"HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
		)
	})
	const upstream = await listen(backend)
	const gateway = createServer()
	attachNativeLiveProxy({
		server: gateway,
		publicOrigin: "https://kay.example",
		telemetry: makeTelemetry(),
		authorize: async () => ({
			target: new URL(upstream),
			headers: new Headers(),
			release: async () => {
				released++
			},
			revalidate: async () => true,
		}),
	})
	const origin = await listen(gateway)
	try {
		assert.equal((await upgrade(origin)).status, 403)
		await waitFor(() => released === 1)
		assert.equal(calls, 1)
	} finally {
		await close(gateway)
		await close(backend)
	}
})

test("revocation or epoch change closes an established stream and releases it once", async () => {
	let released = 0,
		checks = 0
	let remote: Duplex | undefined
	const backend = createServer()
	backend.on("upgrade", (_req, socket) => {
		remote = socket
		socket.write(
			"HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
		)
	})
	const upstream = await listen(backend)
	const gateway = createServer()
	const stop = attachNativeLiveProxy({
		server: gateway,
		publicOrigin: "https://kay.example",
		telemetry: makeTelemetry(),
		revalidateEveryMs: 20,
		authorize: async () => ({
			target: new URL(upstream),
			headers: new Headers(),
			release: async () => {
				released++
			},
			revalidate: async () => {
				checks++
				return false
			},
		}),
	})
	const origin = await listen(gateway)
	try {
		const result = await upgrade(origin)
		await once(result.socket!, "close")
		await waitFor(() => released === 1)
		assert.equal(checks, 1)
	} finally {
		stop()
		remote?.destroy()
		await close(gateway)
		await close(backend)
	}
})

test("a timed out admission is released when its pending check eventually finishes", async () => {
	let resolveAdmission: ((value: LiveAdmission) => void) | undefined
	let released = 0
	const gateway = createServer()
	attachNativeLiveProxy({
		server: gateway,
		publicOrigin: "https://kay.example",
		telemetry: makeTelemetry(),
		handshakeTimeoutMs: 20,
		authorize: () =>
			new Promise((resolve) => {
				resolveAdmission = resolve
			}),
	})
	const origin = await listen(gateway)
	try {
		assert.equal((await upgrade(origin)).status, 504)
		resolveAdmission!({
			target: new URL("http://127.0.0.1:1"),
			headers: new Headers(),
			release: async () => {
				released++
			},
			revalidate: async () => true,
		})
		await waitFor(() => released === 1)
	} finally {
		await close(gateway)
	}
})

test("computer connectors remain connected beyond the voice session limit", async () => {
	let remote: Duplex | undefined
	const backend = createServer()
	backend.on("upgrade", (_req, socket) => {
		remote = socket
		socket.write(
			"HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
		)
	})
	const upstream = await listen(backend)
	const gateway = createServer()
	const stop = attachNativeLiveProxy({
		server: gateway,
		publicOrigin: "https://kay.example",
		telemetry: makeTelemetry(),
		connector: true,
		maxDurationMs: 20,
		authorize: async () => ({
			target: new URL("/v1/hooks/computers/connect", upstream),
			headers: new Headers({ authorization: "Bearer fixture-connector" }),
			release: async () => {},
			revalidate: async () => true,
		}),
	})
	const origin = await listen(gateway)
	try {
		const result = await upgrade(
			origin,
			{ origin: "" },
			"/v1/hooks/computers/connect",
		)
		assert.equal(result.status, 101)
		await new Promise((resolve) => setTimeout(resolve, 60))
		assert.equal(result.socket?.destroyed, false)
		stop()
		await once(result.socket!, "close")
	} finally {
		stop()
		remote?.destroy()
		await close(gateway)
		await close(backend)
	}
})
