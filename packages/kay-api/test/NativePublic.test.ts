import assert from "node:assert/strict"
import { createHmac, createHash } from "node:crypto"
import { once } from "node:events"
import { createServer, request, type Server } from "node:http"
import type { Duplex } from "node:stream"
import { test } from "node:test"
import { fromEnvironment } from "../src/Configuration.ts"
import { runtime } from "../src/Database.ts"
import { createGateway } from "../src/Gateway.ts"
import { closeNativeLiveProxy } from "../src/NativeLiveProxy.ts"
import { publicNativeEndpoint } from "../src/NativePublic.ts"

const listen = async (server: Server) => {
	server.listen(0, "127.0.0.1")
	await once(server, "listening")
	const address = server.address()
	if (address === null || typeof address === "string")
		throw new Error("Expected TCP")
	return `http://127.0.0.1:${address.port}`
}
const close = async (server: Server) => {
	closeNativeLiveProxy(server)
	server.closeAllConnections()
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error === undefined ? resolve() : reject(error))),
	)
}

test("native public routes are method-specific and do not expose arbitrary core APIs", () => {
	for (const path of [
		"/v1/hooks/triggers/id_abc",
		"/v1/hooks/channels/ch_abc",
		"/v1/hooks/computers/pairings",
		"/v1/hooks/computers/pairings/pair_abc/poll",
	]) {
		assert.equal(publicNativeEndpoint({ method: "POST", path }), true)
		assert.equal(publicNativeEndpoint({ method: "GET", path }), false)
	}
	assert.equal(
		publicNativeEndpoint({ method: "GET", path: "/v1/apps/client-metadata" }),
		true,
	)
	for (const path of [
		"/v1/app-index/sources",
		"/v1/app-index/apps",
		"/v1/app-index/app",
	]) {
		assert.equal(publicNativeEndpoint({ method: "GET", path }), true)
		assert.equal(publicNativeEndpoint({ method: "POST", path }), false)
	}
	for (const path of [
		"/v1/hooks/channels/id/extra",
		"/v1/hooks/channels/%2fescape",
		"/v1/bots",
		"/v1/sessions",
		"/v1/hooks/computers/connect",
	])
		assert.equal(publicNativeEndpoint({ method: "POST", path }), false)
})

test(
	"native hooks preserve signed bytes and connector credentials without browser identity or replay",
	{ timeout: 15000 },
	async () => {
		const body = '{  "event" : "hello", "nested": [1, 2] }\n'
		const signature = createHmac("sha256", "fixture-key")
			.update(body)
			.digest("hex")
		let calls = 0,
			upgrades = 0
		let remote: Duplex | undefined
		const core = createServer((req, res) => {
			void (async () => {
				calls++
				assert.equal(req.headers.cookie, undefined)
				assert.equal(req.headers["x-user-id"], undefined)
				assert.equal(req.headers["openbot-organization"], undefined)
				assert.equal(req.headers["x-kay-epoch"], undefined)
				assert.equal(req.headers["idempotency-key"], "event-fixture")
				const chunks: Buffer[] = []
				for await (const chunk of req) chunks.push(Buffer.from(chunk))
				assert.equal(Buffer.concat(chunks).toString(), body)
				assert.equal(req.headers["x-slack-request-timestamp"], "fixture-time")
				res.setHeader("content-type", "application/json")
				res.writeHead(
					req.headers["x-slack-signature"] === signature ? 202 : 401,
				)
				res.end(
					JSON.stringify({
						accepted: req.headers["x-slack-signature"] === signature,
					}),
				)
			})().catch(() => res.writeHead(500).end())
		})
		core.on("upgrade", (req, socket) => {
			upgrades++
			assert.equal(req.url, "/v1/hooks/computers/connect")
			assert.equal(req.headers.authorization, "Bearer fixture-connector")
			assert.equal(req.headers.cookie, undefined)
			assert.equal(req.headers["x-user-id"], undefined)
			remote = socket
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
		const coreOrigin = await listen(core)
		const config = fromEnvironment({
			KAY_PUBLIC_ORIGIN: "https://kay.example",
			KAY_OPENBOT_ORIGIN: coreOrigin,
			KAY_DATABASE_URL: "postgres://unused@127.0.0.1:1/unused",
			KAY_INTERNAL_TOKEN: "fixture-internal-token-at-least-32-characters",
			KAY_TARGET_ORGANIZATION_ID: "kay",
			KAY_AUTH_BACKEND: "openbot",
			KAY_BACKEND_ROUTING: "native",
			KAY_NEXT_ENABLED: "true",
		})
		const db = runtime(config),
			gateway = createGateway({ config, db })
		const origin = await listen(gateway)
		try {
			for (const [sent, status] of [
				[signature, 202],
				["bad", 401],
			] as const) {
				const response = await fetch(
					origin + "/v1/hooks/channels/channel_fixture",
					{
						method: "POST",
						headers: {
							"content-type": "application/json",
							"x-slack-signature": sent,
							"x-slack-request-timestamp": "fixture-time",
							cookie: "session=browser",
							"x-user-id": "forged",
							"openbot-organization": "forged",
							"x-kay-epoch": "55",
							"idempotency-key": "event-fixture",
						},
						body,
					},
				)
				assert.equal(response.status, status)
				assert.deepEqual(await response.json(), { accepted: status === 202 })
			}
			assert.equal(calls, 2)
			assert.equal(
				(await fetch(origin + "/v1/hooks/channels/channel_fixture")).status,
				410,
			)
			assert.equal(calls, 2)
			const upgraded = await new Promise<Duplex>((resolve, reject) => {
				const req = request(origin + "/v1/hooks/computers/connect", {
					headers: {
						connection: "Upgrade",
						upgrade: "websocket",
						authorization: "Bearer fixture-connector",
						"sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
						"sec-websocket-version": "13",
						cookie: "session=browser",
						"x-user-id": "forged",
					},
				})
				req.once("upgrade", (_response, socket) => resolve(socket))
				req.once("response", (response) =>
					reject(new Error(`Unexpected status ${response.statusCode}`)),
				)
				req.once("error", reject)
				req.end()
			})
			const frame = Buffer.from([0x82, 0x83, 1, 2, 3, 4, 0xff, 0x00, 0x81])
			const received = once(upgraded, "data")
			upgraded.write(frame)
			assert.deepEqual((await received)[0], frame)
			assert.equal(upgrades, 1)
			upgraded.destroy()
		} finally {
			remote?.destroy()
			await close(gateway)
			await close(core)
			await db.dispose()
		}
	},
)
