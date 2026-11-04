import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer, type Server } from "node:http"
import { once } from "node:events"
import { createGateway } from "../src/Gateway.ts"
import { runtime } from "../src/Database.ts"
import type { Configuration } from "../src/Configuration.ts"

const listen = async (server: Server) => {
	server.listen(0, "127.0.0.1")
	await once(server, "listening")
	const address = server.address()
	if (address === null || typeof address === "string")
		throw new Error("Expected a TCP server")
	return `http://127.0.0.1:${address.port}`
}
const close = (server: Server) => {
	server.closeAllConnections()
	return new Promise<void>((resolve, reject) =>
		server.close((error) => (error !== undefined ? reject(error) : resolve())),
	)
}

test("extraction proxy preserves cookies, status and immediate SSE without retrying writes", async () => {
	let turns = 0,
		unauthorized = false,
		denied = false
	let finish: (() => void) | undefined
	const backend = createServer((req, res) => {
		assert.equal(req.headers["x-user-id"], undefined)
		if (req.url === "/auth/session") {
			res.writeHead(unauthorized ? 401 : denied ? 403 : 200, {
				"content-type": "application/json",
				"set-cookie": "__Host-e-session=renewed; Secure; HttpOnly; Path=/",
			})
			res.end(
				JSON.stringify(
					unauthorized
						? { _tag: "AuthenticationRequired" }
						: denied
							? { _tag: "PermissionDenied" }
							: {
									identity: { userId: "owner", tenantId: "owner" },
									profile: {},
									expiresAt: "2027-01-01",
								},
				),
			)
			return
		}
		if (req.url === "/v1/sessions/id/turns") {
			turns++
			assert.equal(req.headers.cookie, "__Host-e-session=real")
			res.writeHead(200, { "content-type": "text/event-stream" })
			res.write(
				'event: response.output_text.delta\ndata: {"delta":"first"}\n\n',
			)
			finish = () => res.end("event: response.completed\ndata: {}\n\n")
			return
		}
		res.writeHead(404)
		res.end()
	})
	const backendOrigin = await listen(backend)
	const config: Configuration = {
		port: 3100,
		internalPort: 3101,
		internalToken: "test-internal-key-32-characters-long",
		publicOrigin: "https://kay.example",
		eOrigin: backendOrigin,
		openbotOrigin: backendOrigin,
		authBackend: "e",
		backendRouting: "e",
		databaseUrl: "postgres://unused:unused@127.0.0.1:1/unused",
	}
	const db = runtime(config),
		gateway = createGateway({ config, db }),
		origin = await listen(gateway)
	try {
		const headers = {
			origin: config.publicOrigin,
			cookie: "__Host-e-session=real",
			"content-type": "application/json",
			"x-user-id": "forged",
		}
		const result = await fetch(`${origin}/v1/sessions/id/turns`, {
			method: "POST",
			headers,
			body: JSON.stringify({ expected: 1, input: "hello", stream: true }),
		})
		assert.equal(result.status, 200)
		assert.equal(result.headers.get("x-accel-buffering"), "no")
		assert.match(result.headers.get("set-cookie") ?? "", /renewed/)
		const reader = result.body!.getReader(),
			first = await reader.read()
		assert.match(new TextDecoder().decode(first.value), /first/)
		assert.equal(turns, 1)
		finish?.()
		while (!(await reader.read()).done) {
			/* Consume the completed stream. */
		}
		unauthorized = true
		const signedOut = await fetch(`${origin}/v1/sessions/id/turns`, {
			method: "POST",
			headers,
			body: "{}",
		})
		assert.equal(signedOut.status, 401)
		unauthorized = false
		denied = true
		const forbidden = await fetch(`${origin}/v1/sessions/id/turns`, {
			method: "POST",
			headers,
			body: "{}",
		})
		assert.equal(forbidden.status, 403)
		assert.equal(turns, 1)
		assert.equal(
			(
				await fetch(`${origin}/internal/execution/acquire`, {
					method: "POST",
					headers,
					body: "{}",
				})
			).status,
			404,
		)
	} finally {
		finish?.()
		await close(gateway)
		await close(backend)
		await db.dispose()
	}
})

test("browser authentication preserves redirect and rejection responses over HTTP", async () => {
	const loginCookie =
		"__Host-e-login=fixture; Secure; HttpOnly; Path=/; SameSite=Lax"
	const sessionCookie =
		"__Host-e-session=fixture; Secure; HttpOnly; Path=/; SameSite=Lax"
	const observed: Array<string> = []
	let status = 303
	let body = ""
	const backend = createServer((req, res) => {
		observed.push(req.url ?? "")
		assert.equal(req.headers.cookie, "__Host-e-login=incoming")
		res.writeHead(status, {
			"content-type": "application/json",
			location:
				"https://auth.example/authorize?state=fixture&code_challenge=unchanged",
			"set-cookie": [loginCookie, sessionCookie],
			"cache-control": "no-store",
		})
		res.end(body)
	})
	const backendOrigin = await listen(backend)
	try {
		for (const authBackend of ["e", "openbot"] as const) {
			const config: Configuration = {
				port: 3100,
				internalPort: 3101,
				internalToken: "test-internal-key-32-characters-long",
				publicOrigin: "https://kay.example",
				eOrigin: backendOrigin,
				openbotOrigin: backendOrigin,
				authBackend,
				backendRouting: "e",
				databaseUrl: "postgres://unused:unused@127.0.0.1:1/unused",
			}
			const db = runtime(config)
			const gateway = createGateway({ config, db })
			const origin = await listen(gateway)
			try {
				for (const path of [
					"/auth/login?returnTo=%2Fsessions%2Ffixture",
					"/auth/callback?state=fixture&code=fixture",
				])
					for (const responseCase of [
						...[301, 302, 303, 307, 308].map((status) => ({
							status,
							body:
								status === 307 ? "Redirecting to the identity provider." : "",
						})),
						...[401, 403].flatMap((status) => [
							{ status, body: "" },
							{
								status,
								body: JSON.stringify({
									_tag: "ProviderRejected",
									message: "Fixture rejection",
								}),
							},
						]),
					]) {
						status = responseCase.status
						body = responseCase.body
						const response = await fetch(origin + path, {
							redirect: "manual",
							headers: { cookie: "__Host-e-login=incoming" },
						})
						assert.equal(response.status, status)
						assert.equal(
							response.headers.get("location"),
							"https://auth.example/authorize?state=fixture&code_challenge=unchanged",
						)
						assert.deepEqual(response.headers.getSetCookie(), [
							loginCookie,
							sessionCookie,
						])
						assert.equal(
							response.headers.get("content-type"),
							"application/json",
						)
						assert.equal(response.headers.get("cache-control"), "no-store")
						assert.equal(await response.text(), body)
						assert.equal(observed.at(-1), path)
					}
			} finally {
				await close(gateway)
				await db.dispose()
			}
		}
		assert.equal(observed.length, 36)
	} finally {
		await close(backend)
	}
})
