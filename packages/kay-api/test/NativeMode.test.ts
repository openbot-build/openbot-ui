import assert from "node:assert/strict"
import { once } from "node:events"
import { readFile } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import { test } from "node:test"
import { Pool } from "pg"
import type { NativeClientFactory } from "@kaicom/kay-contracts/Native"
import { fromEnvironment } from "../src/Configuration.ts"
import { runtime } from "../src/Database.ts"
import { createGateway } from "../src/Gateway.ts"
import { makeNativeNavigation } from "../src/NativeNavigation.ts"
import { checkReadiness } from "../src/Readiness.ts"
import { start } from "./PostgresTest.ts"

const environment = {
	KAY_PUBLIC_ORIGIN: "https://kay.example",
	KAY_OPENBOT_ORIGIN: "http://127.0.0.1:3000",
	KAY_DATABASE_URL: "postgres://fixture@localhost/fixture",
	KAY_INTERNAL_TOKEN: "fixture-internal-token-at-least-32-characters",
	KAY_TARGET_ORGANIZATION_ID: "kay",
	KAY_AUTH_BACKEND: "openbot",
	KAY_BACKEND_ROUTING: "native",
	KAY_NEXT_ENABLED: "true",
}

test("fresh native routing requires the product API and an explicit native identity authority", () => {
	assert.equal(fromEnvironment(environment).backendRouting, "native")
	assert.equal(
		fromEnvironment(environment).eOrigin,
		environment.KAY_OPENBOT_ORIGIN,
	)
	for (const invalid of [
		{ KAY_AUTH_BACKEND: "e" },
		{ KAY_AUTH_BACKEND: "ledger" },
		{ KAY_NEXT_ENABLED: "false" },
		{ KAY_TARGET_ORGANIZATION_ID: "" },
	])
		assert.throws(
			() => fromEnvironment({ ...environment, ...invalid }),
			/Native routing/,
		)
})

const listen = async (server: Server) => {
	server.listen(0, "127.0.0.1")
	await once(server, "listening")
	const address = server.address()
	if (address === null || typeof address === "string")
		throw new Error("Expected TCP")
	return `http://127.0.0.1:${address.port}`
}
const close = async (server: Server) => {
	server.closeAllConnections()
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error === undefined ? resolve() : reject(error))),
	)
}

test(
	"fresh native accounts use only the verified core identity and business schema",
	{ timeout: 30000 },
	async () => {
		const postgres = await start()
		const pool = new Pool({ connectionString: postgres.url })
		let membership: "active" | "suspended" | "foreign" = "active"
		let authorityStatus = 200
		let picture: string | undefined
		let nativeHealthy = true
		let chatsSchema = true
		let callbackCount = 0
		let logoutCount = 0
		let sends = 0
		let legacyCalls = 0
		let nativeCalls = 0
		const forwarded: Headers[] = []
		const oldCore = createServer((_req, res) => {
			legacyCalls++
			res.writeHead(500).end()
		})
		const core = createServer((req, res) => {
			assert.equal(req.headers["x-user-id"], undefined)
			assert.equal(req.headers["x-kay-epoch"], undefined)
			assert.equal(req.headers["x-kay-backend"], undefined)
			assert.equal(req.headers["openbot-organization"], undefined)
			res.setHeader("content-type", "application/json")
			const url = new URL(req.url ?? "/", "https://kay.example")
			if (url.pathname === "/health") {
				res.writeHead(nativeHealthy ? 200 : 503)
				res.end(
					JSON.stringify({ status: nativeHealthy ? "ok" : "unavailable" }),
				)
			} else if (url.pathname === "/auth/session") {
				if (
					req.headers.cookie === undefined &&
					req.headers.authorization !== "Bearer real-user-key"
				) {
					res.writeHead(401).end("{}")
					return
				}
				if (authorityStatus !== 200) {
					res.writeHead(authorityStatus).end("{}")
					return
				}
				res.setHeader(
					"set-cookie",
					"__Host-e-session=renewed; Secure; HttpOnly; Path=/",
				)
				res.end(
					JSON.stringify({
						userId: req.headers.cookie === "session=other" ? "other" : "owner",
						profile: {
							name: "Sage",
							...(picture === undefined ? {} : { picture }),
						},
						expiresAt: "2027-01-01",
						memberships: [
							{
								organizationId: membership === "foreign" ? "foreign" : "kay",
								status: membership === "suspended" ? "suspended" : "active",
							},
						],
					}),
				)
			} else if (url.pathname === "/auth/login") {
				assert.equal(url.searchParams.get("returnTo"), "/next?feature=files")
				res
					.writeHead(302, {
						location: "https://identity.example/authorize",
						"set-cookie": "__Host-e-login=state; Secure; HttpOnly; Path=/",
					})
					.end()
			} else if (url.pathname === "/auth/callback") {
				res
					.writeHead(303, {
						location: "/next?feature=files",
						"set-cookie":
							"__Host-e-session=signed-in; Secure; HttpOnly; Path=/",
					})
					.end()
			} else if (url.pathname === "/auth/logout") {
				logoutCount++
				res
					.writeHead(204, {
						"set-cookie":
							"__Host-e-session=; Max-Age=0; Secure; HttpOnly; Path=/",
					})
					.end()
			} else if (url.pathname === "/auth/apps/callback") {
				callbackCount++
				res.writeHead(303, { location: "/?authorization=confirmed" }).end()
			} else if (url.pathname === "/v1/apps/client-metadata") {
				res.end(
					JSON.stringify({
						client_id: "https://kay.example/v1/apps/client-metadata",
					}),
				)
			} else if (url.pathname === "/openapi.json") {
				res.end(
					JSON.stringify({
						openapi: "3.1.0",
						paths: { [chatsSchema ? "/v1/chats" : "/v1/sessions"]: {} },
					}),
				)
			} else res.writeHead(404).end("{}")
		})
		const eOrigin = await listen(oldCore)
		const openbotOrigin = await listen(core)
		const config = fromEnvironment({
			...environment,
			KAY_DATABASE_URL: postgres.url,
			KAY_OPENBOT_ORIGIN: openbotOrigin,
			KAY_E_ORIGIN: eOrigin,
		})
		const db = runtime(config)
		const native: NativeClientFactory = ({ headers }) => ({
			request: async (call) => {
				if (call.operation === "access")
					return Response.json({ adminConsole: false })
				nativeCalls++
				forwarded.push(new Headers(headers))
				if (call.operation === "memberSettings")
					return Response.json({ defaultBot: null })
				if (call.operation === "bots" || call.operation === "chats")
					return Response.json([])
				if (call.operation === "send") {
					sends++
					return Response.json(
						{ delivery: "queued", chat: "chat-a", item: "item-a", turn: null },
						{ status: 202 },
					)
				}
				return Response.json({}, { status: 404 })
			},
		})
		const gateway = createGateway({ config, db, nativeProduct: native })
		const origin = await listen(gateway)
		try {
			for (const name of ["001_business.sql", "002_chat_automations.sql"])
				await pool.query(
					await readFile(
						new URL("../migrations/" + name, import.meta.url),
						"utf8",
					),
				)
			await checkReadiness({ config, db, origin })
			const headers = {
				cookie: "session=owner",
				"x-user-id": "forged",
				"openbot-organization": "foreign",
				"x-kay-epoch": "900",
				"x-kay-backend": "e",
			}
			const bootstrap = await fetch(origin + "/api/kay/v1/bootstrap", {
				headers,
			})
			assert.equal(bootstrap.status, 200)
			assert.match(
				bootstrap.headers.get("set-cookie") ?? "",
				/__Host-e-session=renewed/,
			)
			assert.deepEqual((await bootstrap.json()).identity, {
				userId: "owner",
				organizationId: "kay",
				displayName: "Sage",
				avatarUrl: null,
			})
			picture = "https://auth.kai.example/avatar/member.png"
			const pictured = await fetch(origin + "/api/kay/v1/bootstrap", {
				headers,
			})
			assert.equal(pictured.status, 200)
			assert.deepEqual((await pictured.json()).identity, {
				userId: "owner",
				organizationId: "kay",
				displayName: "Sage",
				avatarUrl: picture,
			})
			picture = undefined
			for (const value of forwarded) {
				assert.equal(value.get("cookie"), "session=owner")
				assert.equal(value.get("openbot-organization"), "kay")
				assert.equal(value.get("x-user-id"), null)
				assert.equal(value.get("x-kay-epoch"), null)
				assert.equal(value.get("x-kay-backend"), null)
			}
			assert.equal(
				(
					await fetch(origin + "/api/kay/v1/bootstrap", {
						headers: { authorization: "Bearer real-user-key" },
					})
				).status,
				200,
			)
			assert.equal(
				forwarded.at(-1)?.get("authorization"),
				"Bearer real-user-key",
			)
			const beforeDenied = nativeCalls
			for (const next of ["suspended", "foreign"] as const) {
				membership = next
				assert.equal(
					(await fetch(origin + "/api/kay/v1/bootstrap", { headers })).status,
					403,
				)
			}
			membership = "active"
			for (const status of [401, 403]) {
				authorityStatus = status
				assert.equal(
					(await fetch(origin + "/api/kay/v1/bootstrap", { headers })).status,
					status,
				)
			}
			authorityStatus = 200
			assert.equal(nativeCalls, beforeDenied)
			const command = {
				method: "POST",
				headers: {
					...headers,
					origin: config.publicOrigin,
					"content-type": "application/json",
				},
				body: JSON.stringify({ input: "Hello", stream: false }),
			}
			assert.equal(
				(await fetch(origin + "/api/kay/v1/chats/chat-a/messages", command))
					.status,
				202,
			)
			assert.equal(sends, 1)
			assert.equal(
				(
					await fetch(origin + "/api/kay/v1/chats/chat-a/messages", {
						...command,
						headers: { ...command.headers, origin: "https://foreign.example" },
					})
				).status,
				403,
			)
			assert.equal(sends, 1)
			for (const path of [
				"/v1/sessions",
				"/v1/sessions/old",
				"/v1/preferences",
				"/v1/agents",
				"/v1/chats",
			])
				assert.equal((await fetch(origin + path, { headers })).status, 410)
			assert.equal(
				(await fetch(origin + "/v1/apps/client-metadata")).status,
				200,
			)
			const login = await fetch(
				origin + "/auth/login?returnTo=%2Fnext%3Ffeature%3Dfiles",
				{ redirect: "manual" },
			)
			assert.equal(login.status, 302)
			assert.match(login.headers.get("set-cookie") ?? "", /__Host-e-login/)
			const callback = await fetch(
				origin + "/auth/callback?state=state&code=code",
				{ redirect: "manual" },
			)
			assert.equal(callback.status, 303)
			assert.equal(callback.headers.get("location"), "/next?feature=files")
			await makeNativeNavigation(db).remember({
				accountId: "owner",
				kind: "app",
				flowId: "flow-a",
				returnTo: "/next?feature=apps",
			})
			const appCallback = await fetch(
				origin + "/auth/apps/callback?state=flow-a&code=code",
				{ redirect: "manual" },
			)
			assert.equal(appCallback.status, 303)
			assert.equal(
				appCallback.headers.get("location"),
				"/next?feature=apps&authorization=confirmed",
			)
			assert.equal(callbackCount, 1)
			assert.equal(
				(
					await fetch(origin + "/auth/apps/callback?state=flow-a&code=code", {
						redirect: "manual",
						headers: { cookie: "session=other" },
					})
				).status,
				403,
			)
			assert.equal(callbackCount, 1)
			assert.equal(
				(
					await fetch(origin + "/auth/logout", {
						method: "POST",
						headers: { cookie: "session=owner", origin: config.publicOrigin },
					})
				).status,
				204,
			)
			assert.equal(logoutCount, 1)
			assert.equal(legacyCalls, 0)
			assert.equal(
				(
					await pool.query(
						"SELECT to_regclass('kay_migration_accounts') AS ledger",
					)
				).rows[0].ledger,
				null,
			)
			assert.equal(
				(await pool.query("SELECT to_regclass('kay_auth_migration') AS ledger"))
					.rows[0].ledger,
				null,
			)
			chatsSchema = false
			await assert.rejects(
				checkReadiness({ config, db, origin }),
				/Platform API/,
			)
			chatsSchema = true
			nativeHealthy = false
			await assert.rejects(
				checkReadiness({ config, db, origin }),
				/openbot runtime is unavailable/,
			)
			nativeHealthy = true
			await pool.query(
				"ALTER TABLE kay_chat_metadata DROP COLUMN automation_ids",
			)
			await assert.rejects(
				checkReadiness({ config, db, origin }),
				/database readiness failed/,
			)
		} finally {
			await close(gateway)
			await close(core)
			await close(oldCore)
			await db.dispose()
			await pool.end()
			await postgres.close()
		}
	},
)
