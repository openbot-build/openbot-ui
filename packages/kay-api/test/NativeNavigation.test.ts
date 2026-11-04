import assert from "node:assert/strict"
import { once } from "node:events"
import { readFile } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import { test } from "node:test"
import { Pool } from "pg"
import { schema } from "./MigrationSchema.ts"
import type { NativeClientFactory } from "@kaicom/kay-contracts/Native"
import { makeNativeNavigation } from "../src/NativeNavigation.ts"
import { createGateway } from "../src/Gateway.ts"
import { runtime } from "../src/Database.ts"
import type { Configuration } from "../src/Configuration.ts"
import { start } from "./PostgresTest.ts"

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
	"native authorization references route callbacks without credentials and still enforce account and freeze checks",
	{ timeout: 30000 },
	async () => {
		const postgres = await start(),
			pool = new Pool({ connectionString: postgres.url })
		let callbacks = 0,
			begins = 0,
			lookups = 0
		const core = createServer((req, res) => {
			res.setHeader("content-type", "application/json")
			if (req.url === "/auth/session") {
				if (req.headers.cookie === undefined || req.headers.cookie === "") {
					res.writeHead(401)
					res.end("{}")
					return
				}
				const userId =
					req.headers.cookie === "session=other" ? "other" : "owner"
				res.end(
					JSON.stringify({
						userId,
						memberships: [{ organizationId: "org", status: "active" }],
						profile: {},
						expiresAt: "2027-01-01",
					}),
				)
				return
			}
			if (req.url === "/internal/apps/authorization-owner") {
				lookups++
				res.writeHead(404)
				res.end("{}")
				return
			}
			if (
				req.url?.startsWith("/auth/apps/callback") === true ||
				req.url?.startsWith("/auth/developer/apps/callback") === true
			) {
				callbacks++
				assert.equal(req.headers["x-user-id"], undefined)
				assert.equal(req.headers["x-kay-epoch"], "3")
				res.writeHead(303, {
					location: req.url.startsWith("/auth/developer/")
						? "/?developerTest=test-a"
						: "/?authorization=app-flow",
				})
				res.end()
				return
			}
			res.writeHead(404)
			res.end("{}")
		})
		const origin = await listen(core)
		const config: Configuration = {
			port: 3100,
			internalPort: 3101,
			internalToken: "fixture-token-long-enough-for-the-schema",
			publicOrigin: "https://kay.example",
			eOrigin: origin,
			openbotOrigin: origin,
			openbotOrganizationId: "org",
			authBackend: "openbot",
			backendRouting: "ledger",
			databaseUrl: postgres.url,
			nextEnabled: true,
		}
		const db = runtime(config)
		const native: NativeClientFactory = () => ({
			request: async (call) => {
				if (call.operation === "featureDefinition")
					return Response.json({
						id: call.id,
						group: call.id!.split(".")[0],
						title: "Authorize",
						description: "",
						method:
							call.id === "appAuthorization.getAppAuthorization"
								? "GET"
								: "POST",
						params: null,
						query: null,
						payload: null,
						response: null,
						transport: "json",
					})
				if (call.id !== "appAuthorization.getAppAuthorization") begins++
				return Response.json(
					call.id === "developer.authorizeTest"
						? { authorization: { flowId: "dev-flow" } }
						: {
								_tag: "AuthorizationStarted",
								flowId: "app-flow",
								authorizationUrl: "https://provider.example/authorize",
							},
				)
			},
		})
		const gateway = createGateway({ config, db, nativeProduct: native })
		try {
			await pool.query(
				await readFile(
					new URL("../migrations/001_business.sql", import.meta.url),
					"utf8",
				),
			)
			await pool.query(schema)
			await pool.query(
				"INSERT INTO kay_migration_accounts(account_id,source_tenant_id,target_organization_id,migration_id,phase,active_backend,epoch) VALUES('owner','owner','org','job','OPENBOT_ACTIVE','openbot',3),('other','other','org','job','OPENBOT_ACTIVE','openbot',3)",
			)
			const base = await listen(gateway)
			for (const operation of [
				"appAuthorization.beginAppAuthorization",
				"developer.authorizeTest",
			]) {
				const begun = await fetch(base + "/api/kay/v1/features/" + operation, {
					method: "POST",
					headers: {
						cookie: "session=owner",
						origin: config.publicOrigin,
						"content-type": "application/json",
					},
					body: JSON.stringify({
						payload: operation.startsWith("developer.")
							? { scopes: [] }
							: { revision: 0, scopes: [], returnTo: "/next?panel=apps" },
					}),
				})
				assert.equal(begun.status, 200)
				await begun.body?.cancel()
			}
			assert.equal(begins, 2)
			const navigation = makeNativeNavigation(db)
			assert.deepEqual(
				await navigation.lookup({ kind: "app", flowId: "app-flow" }),
				{ accountId: "owner", returnTo: "/next?panel=apps" },
			)
			assert.equal(
				await navigation.lookup({ kind: "app", flowId: "dev-flow" }),
				null,
			)
			for (const [path, expected] of [
				[
					"/auth/apps/callback?state=app-flow&code=code-a",
					"/next?panel=apps&authorization=app-flow",
				],
				[
					"/auth/developer/apps/callback?state=dev-flow&code=code-b",
					"/next?developerTest=test-a",
				],
			]) {
				const callback = await fetch(base + path, { redirect: "manual" })
				assert.equal(callback.status, 303)
				assert.equal(callback.headers.get("location"), expected)
			}
			assert.equal(callbacks, 2)
			assert.equal(lookups, 0)
			const wrong = await fetch(
				base + "/auth/apps/callback?state=app-flow&code=x",
				{
					redirect: "manual",
					headers: { cookie: "session=other", "x-user-id": "owner" },
				},
			)
			assert.equal(wrong.status, 403)
			assert.equal(callbacks, 2)
			const signed = await fetch(
				base + "/auth/apps/callback?state=unrecorded-native-flow&code=x",
				{ redirect: "manual", headers: { cookie: "session=owner" } },
			)
			assert.equal(signed.status, 303)
			assert.equal(callbacks, 3)
			assert.equal(lookups, 0)
			const forged = await fetch(
				base + "/auth/apps/callback?state=unrecorded-native-flow&code=x",
				{ redirect: "manual", headers: { "x-user-id": "owner" } },
			)
			assert.equal(forged.status, 400)
			assert.equal(callbacks, 3)
			await pool.query(
				"ALTER TABLE kay_navigation RENAME TO unavailable_navigation",
			)
			const uncertain = await fetch(
				base + "/api/kay/v1/features/appAuthorization.beginAppAuthorization",
				{
					method: "POST",
					headers: {
						cookie: "session=owner",
						origin: config.publicOrigin,
						"content-type": "application/json",
					},
					body: JSON.stringify({
						payload: { revision: 0, scopes: [], returnTo: "/next" },
					}),
				},
			)
			assert.equal(uncertain.status, 503)
			assert.equal((await uncertain.json()).code, "outcome_unknown")
			assert.equal(begins, 3)
			await pool.query(
				"ALTER TABLE unavailable_navigation RENAME TO kay_navigation",
			)
			const recovered = await fetch(
				base + "/api/kay/v1/features/appAuthorization.getAppAuthorization",
				{ headers: { cookie: "session=owner" } },
			)
			assert.equal(recovered.status, 200)
			await recovered.body?.cancel()
			assert.equal(begins, 3)
			assert.equal(
				(await navigation.lookup({ kind: "app", flowId: "app-flow" }))
					?.accountId,
				"owner",
			)
			await pool.query(
				"UPDATE kay_migration_accounts SET phase='FROZEN',active_backend='e',freeze_deadline_at=now()+interval '60 seconds' WHERE account_id='owner'",
			)
			const frozen = await fetch(
				base + "/auth/apps/callback?state=app-flow&code=x",
				{ redirect: "manual" },
			)
			assert.equal(frozen.status, 503)
			assert.equal(callbacks, 3)
			assert.equal(
				(
					await pool.query(
						"SELECT count(*)::int AS total FROM kay_migration_write_leases",
					)
				).rows[0].total,
				0,
			)
		} finally {
			await close(gateway)
			await close(core)
			await db.dispose()
			await pool.end()
			await postgres.close()
		}
	},
)
