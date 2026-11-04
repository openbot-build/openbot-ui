import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer, type Server } from "node:http"
import { once } from "node:events"
import { readFile } from "node:fs/promises"
import { Pool } from "pg"
import { schema } from "./MigrationSchema.ts"
import { authSchema } from "./MigrationSchema.ts"
import { createGateway } from "../src/Gateway.ts"
import { createExecutionAuthority } from "../src/ExecutionAuthority.ts"
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
const close = (server: Server) => {
	server.closeAllConnections()
	return new Promise<void>((resolve, reject) =>
		server.close((error) => (error === undefined ? resolve() : reject(error))),
	)
}

test(
	"product preferences enforce ownership, conflicts, forks and durable execution fences",
	{ timeout: 30000 },
	async () => {
		const database = await start(),
			pool = new Pool({ connectionString: database.url })
		await pool.query(
			await readFile(
				new URL("../migrations/001_business.sql", import.meta.url),
				"utf8",
			),
		)
		await pool.query(schema)
		await pool.query(
			"INSERT INTO kay_migration_accounts(account_id,source_tenant_id,target_organization_id,migration_id,phase,active_backend,epoch) VALUES('owner','owner','org','job','OPENBOT_ACTIVE','openbot',3)",
		)
		let identityOwner = "owner"
		const platform = createServer((req, res) => {
			res.setHeader("content-type", "application/json")
			if (req.url === "/auth/session") {
				res.end(
					JSON.stringify({
						userId: identityOwner,
						memberships: [{ organizationId: "org", status: "active" }],
						profile: {},
						expiresAt: "2027-01-01",
					}),
				)
				return
			}
			if (["/v1/sessions/mine", "/v1/sessions/fork"].includes(req.url ?? "")) {
				res.end("{}")
				return
			}
			res.writeHead(404)
			res.end('{"_tag":"SessionNotFound"}')
		})
		const platformOrigin = await listen(platform)
		const config: Configuration = {
			port: 3100,
			internalPort: 3101,
			internalToken: "test-internal-key-32-characters-long",
			publicOrigin: "https://kay.example",
			eOrigin: platformOrigin,
			openbotOrigin: platformOrigin,
			openbotOrganizationId: "org",
			authBackend: "openbot",
			backendRouting: "ledger",
			databaseUrl: database.url,
		}
		const db = runtime(config),
			gateway = createGateway({ config, db }),
			authority = createExecutionAuthority({ config, runtime: db })
		const origin = await listen(gateway),
			internal = await listen(authority)
		const headers = {
			origin: config.publicOrigin,
			cookie: "__Host-e-session=real",
			"content-type": "application/json",
		}
		const patch = (change: object) =>
			fetch(`${origin}/v1/preferences`, {
				method: "PATCH",
				headers,
				body: JSON.stringify({ change }),
			})
		try {
			assert.equal(
				(
					await patch({
						_tag: "CreateCompanion",
						id: "friend",
						name: "Friend",
						color: "#497BA9",
					})
				).status,
				200,
			)
			assert.equal(
				(
					await patch({
						_tag: "AssignCompanion",
						sessionId: "mine",
						companionId: "friend",
					})
				).status,
				200,
			)
			assert.equal(
				(await patch({ _tag: "SetPin", sessionId: "mine", pinned: true }))
					.status,
				200,
			)
			assert.equal(
				(
					await patch({
						_tag: "CreateProject",
						sessionId: "mine",
						id: "project",
						name: "Project",
					})
				).status,
				200,
			)
			const before = await (
				await fetch(`${origin}/v1/preferences`, { headers })
			).json()
			assert.equal(
				(
					await patch({
						_tag: "InheritOrganization",
						sessionId: "fork",
						sourceSessionId: "mine",
					})
				).status,
				200,
			)
			const after = await (
				await fetch(`${origin}/v1/preferences`, { headers })
			).json()
			assert.deepEqual(after.workspace.companions[1].sessions, ["mine", "fork"])
			assert.deepEqual(after.workspace.projects[0].sessions, ["mine", "fork"])
			assert.equal(
				(
					await fetch(`${origin}/v1/preferences`, {
						method: "PUT",
						headers,
						body: JSON.stringify({
							...before,
							expectedWorkspace: before.workspace,
						}),
					})
				).status,
				409,
			)
			assert.equal(
				(
					await patch({
						_tag: "SetPin",
						sessionId: "belongs-to-someone-else",
						pinned: true,
					})
				).status,
				404,
			)
			assert.equal(
				(
					await pool.query(
						"SELECT count(*)::int AS n FROM kay_migration_write_leases",
					)
				).rows[0].n,
				0,
			)
			identityOwner = "other"
			assert.equal(
				(await fetch(`${origin}/v1/preferences`, { headers })).status,
				503,
			)
			identityOwner = "owner"
			const internalHeaders = {
				authorization: `Bearer ${config.internalToken}`,
				"content-type": "application/json",
			}
			assert.equal((await fetch(`${internal}/internal/metrics`)).status, 401)
			const metrics = await fetch(`${internal}/internal/metrics`, {
				headers: internalHeaders,
			})
			assert.equal(metrics.status, 200)
			const observed = await metrics.json()
			assert.equal(observed.migration.phases[0].count, 1)
			assert.equal(JSON.stringify(observed).includes('"owner"'), false)
			const request = {
				accountId: "owner",
				backend: "openbot",
				epoch: 3,
				intent: "send",
			}
			const acquired = await (
				await fetch(`${internal}/internal/execution/acquire`, {
					method: "POST",
					headers: internalHeaders,
					body: JSON.stringify(request),
				})
			).json()
			assert.equal(acquired.allowed, true)
			assert.equal(
				(
					await pool.query(
						"SELECT count(*)::int AS n FROM kay_migration_write_leases",
					)
				).rows[0].n,
				1,
			)
			await pool.query(
				"UPDATE kay_migration_accounts SET epoch=epoch+1 WHERE account_id='owner'",
			)
			assert.equal(
				(
					await fetch(`${internal}/internal/execution/acquire`, {
						method: "POST",
						headers: internalHeaders,
						body: JSON.stringify(request),
					})
				).status,
				409,
			)
			await fetch(`${internal}/internal/execution/release`, {
				method: "POST",
				headers: internalHeaders,
				body: JSON.stringify({ ...request, leaseId: acquired.leaseId }),
			})
			assert.equal(
				(
					await pool.query(
						"SELECT count(*)::int AS n FROM kay_migration_write_leases",
					)
				).rows[0].n,
				0,
			)
		} finally {
			await close(gateway)
			await close(authority)
			await close(platform)
			await db.dispose()
			await pool.end()
			await database.close()
		}
	},
)

test(
	"fork compensation never repeats remote writes and logout aborts an in-progress migration",
	{ timeout: 30000 },
	async () => {
		const database = await start(),
			pool = new Pool({ connectionString: database.url })
		await pool.query(
			await readFile(
				new URL("../migrations/001_business.sql", import.meta.url),
				"utf8",
			),
		)
		await pool.query(schema)
		await pool.query(
			"INSERT INTO kay_migration_accounts(account_id,source_tenant_id,target_organization_id,migration_id,phase,active_backend,epoch) VALUES('owner','owner','org','job','OPENBOT_ACTIVE','openbot',3),('other','other','org','other-job','OPENBOT_ACTIVE','openbot',3)",
		)
		let identityOwner = "owner",
			forks = 0,
			uncertain = 0
		const platform = createServer((req, res) => {
			res.setHeader("content-type", "application/json")
			if (req.url?.startsWith("/auth/session") === true) {
				res.end(
					JSON.stringify({
						userId: identityOwner,
						memberships: [{ organizationId: "org", status: "active" }],
						profile: {},
						expiresAt: "2027-01-01",
					}),
				)
				return
			}
			if (req.url === "/auth/logout") {
				res.writeHead(204)
				res.end()
				return
			}
			if (req.url === "/v1/sessions/mine/fork") {
				forks++
				res.writeHead(201)
				res.end(
					JSON.stringify({
						session: { id: "fork" },
						state: { version: {}, value: {} },
					}),
				)
				return
			}
			if (req.url === "/v1/sessions" && req.method === "POST") {
				uncertain++
				req.socket.destroy()
				return
			}
			if (["/v1/sessions/mine", "/v1/sessions/fork"].includes(req.url ?? "")) {
				res.end("{}")
				return
			}
			res.writeHead(404)
			res.end("{}")
		})
		const platformOrigin = await listen(platform)
		const config: Configuration = {
			port: 3100,
			internalPort: 3101,
			internalToken: "test-internal-key-32-characters-long",
			publicOrigin: "https://kay.example",
			eOrigin: platformOrigin,
			openbotOrigin: platformOrigin,
			openbotOrganizationId: "org",
			authBackend: "openbot",
			backendRouting: "ledger",
			databaseUrl: database.url,
		}
		const db = runtime(config),
			gateway = createGateway({ config, db }),
			origin = await listen(gateway)
		const headers = {
			origin: config.publicOrigin,
			cookie: "__Host-e-session=real",
			"content-type": "application/json",
		}
		const patch = (change: object) =>
			fetch(`${origin}/v1/preferences`, {
				method: "PATCH",
				headers,
				body: JSON.stringify({ change }),
			})
		try {
			assert.equal(
				(
					await patch({
						_tag: "CreateProject",
						sessionId: "mine",
						id: "project",
						name: "Project",
					})
				).status,
				200,
			)
			await pool.query(
				"CREATE FUNCTION fail_preferences() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$; CREATE TRIGGER fail_preferences BEFORE INSERT OR UPDATE ON kay_preferences FOR EACH ROW EXECUTE FUNCTION fail_preferences()",
			)
			const fork = await fetch(`${origin}/v1/sessions/mine/fork`, {
				method: "POST",
				headers,
				body: "{}",
			})
			assert.equal(fork.status, 503)
			const id = fork.headers.get("x-operation-id")
			assert.equal(
				(await pool.query("SELECT phase FROM kay_operations WHERE id=$1", [id]))
					.rows[0].phase,
				"Applied",
			)
			await pool.query("DROP TRIGGER fail_preferences ON kay_preferences")
			const reconciled = await fetch(
				`${origin}/v1/kay/operations/${id}/reconcile`,
				{ method: "POST", headers, body: "{}" },
			)
			assert.equal(reconciled.status, 200)
			assert.equal((await reconciled.json()).phase, "Completed")
			assert.equal(forks, 1)
			const preferences = await (
				await fetch(`${origin}/v1/preferences`, { headers })
			).json()
			assert.deepEqual(preferences.workspace.projects[0].sessions, [
				"mine",
				"fork",
			])
			identityOwner = "other"
			assert.equal(
				(await fetch(`${origin}/v1/kay/operations/${id}`, { headers })).status,
				404,
			)
			identityOwner = "owner"
			const failed = await fetch(`${origin}/v1/sessions`, {
				method: "POST",
				headers,
				body: "{}",
			})
			assert.equal(failed.status, 503)
			const unknown = await fetch(
				`${origin}/v1/kay/operations/${failed.headers.get("x-operation-id")}/reconcile`,
				{ method: "POST", headers, body: "{}" },
			)
			assert.equal((await unknown.json()).phase, "OutcomeUnknown")
			assert.equal(uncertain, 1)
			await pool.query(
				"UPDATE kay_migration_accounts SET phase='COPYING',active_backend='e',freeze_deadline_at=now()+interval '60 seconds' WHERE account_id='owner'",
			)
			assert.equal(
				(await fetch(`${origin}/auth/logout`, { method: "POST", headers }))
					.status,
				204,
			)
			const route = (
				await pool.query(
					"SELECT phase,epoch,freeze_deadline_at FROM kay_migration_accounts WHERE account_id='owner'",
				)
			).rows[0]
			assert.equal(route.phase, "E_ACTIVE")
			assert.equal(Number(route.epoch), 4)
			assert.equal(route.freeze_deadline_at, null)
		} finally {
			await close(gateway)
			await close(platform)
			await db.dispose()
			await pool.end()
			await database.close()
		}
	},
)

test(
	"identity cutover waits for acknowledged auth writes and provisions only new verified users",
	{ timeout: 30000 },
	async () => {
		const database = await start(),
			pool = new Pool({ connectionString: database.url })
		await pool.query(schema)
		await pool.query(authSchema)
		let newIdentity = "new-user"
		const platform = createServer((_req, res) => {
			res.setHeader("content-type", "application/json")
			res.end(
				JSON.stringify({
					userId: newIdentity,
					memberships: [{ organizationId: "org", status: "active" }],
					profile: {},
					expiresAt: "2027-01-01",
				}),
			)
		})
		const platformOrigin = await listen(platform)
		const config: Configuration = {
			port: 3100,
			internalPort: 3101,
			internalToken: "test-internal-key-32-characters-long",
			publicOrigin: "https://kay.example",
			eOrigin: platformOrigin,
			openbotOrigin: platformOrigin,
			openbotOrganizationId: "org",
			authBackend: "ledger",
			backendRouting: "ledger",
			databaseUrl: database.url,
		}
		const db = runtime(config),
			gateway = createGateway({ config, db }),
			authority = createExecutionAuthority({ config, runtime: db })
		const internal = await listen(authority),
			origin = await listen(gateway)
		const headers = {
			authorization: `Bearer ${config.internalToken}`,
			"content-type": "application/json",
		}
		const call = (path: string, value: object) =>
			fetch(`${internal}/internal/auth/${path}`, {
				method: "POST",
				headers,
				body: JSON.stringify(value),
			})
		try {
			assert.equal((await call("admit", { backend: "openbot" })).status, 409)
			const lease = await (await call("admit", { backend: "e" })).json()
			assert.equal(lease.allowed, true)
			await pool.query(
				"UPDATE kay_auth_migration SET migration_id='auth-job',phase='DRAINING',freeze_deadline_at=now()+interval '60 seconds'",
			)
			assert.equal(
				(
					await call("drain-check", {
						backend: "e",
						migrationId: "auth-job",
						epoch: 0,
					})
				).status,
				409,
			)
			assert.equal((await call("admit", { backend: "e" })).status, 409)
			await call("release", {
				backend: "e",
				leaseId: lease.leaseId,
				epoch: lease.epoch,
			})
			assert.equal(
				(
					await call("drain-check", {
						backend: "e",
						migrationId: "auth-job",
						epoch: 0,
					})
				).status,
				200,
			)
			assert.equal(
				(
					await fetch(`${origin}/v1/sessions`, {
						headers: { cookie: "__Host-e-session=verified" },
					})
				).status,
				503,
			)
			await pool.query(
				"UPDATE kay_auth_migration SET phase='OPENBOT_ACTIVE',active_backend='openbot',epoch=1,freeze_deadline_at=NULL,validation_result='{}'",
			)
			assert.equal((await call("admit", { backend: "e" })).status, 409)
			assert.equal((await call("admit", { backend: "openbot" })).status, 200)
			assert.equal(
				(
					await fetch(`${origin}/v1/sessions`, {
						headers: { cookie: "__Host-e-session=verified" },
					})
				).status,
				200,
			)
			const account = (
				await pool.query(
					"SELECT active_backend,target_organization_id FROM kay_migration_accounts WHERE account_id='new-user'",
				)
			).rows[0]
			assert.equal(account.active_backend, "e")
			assert.equal(account.target_organization_id, "org")
			// Fixture state only: the rollout tests exercise every mandatory advance and 24-hour gate.
			await pool.query(
				"INSERT INTO kay_rollouts(id,organization_id,stage,status,population_ids,test_ids,internal_ids,allowed_ids,population_count) VALUES('completed','org','all','complete',ARRAY['fixture-production'],ARRAY['fixture-test'],ARRAY['fixture-internal'],ARRAY['fixture-production'],1)",
			)
			await pool.query(
				"UPDATE kay_rollout_current SET rollout_id='completed' WHERE id='global'",
			)
			newIdentity = "after-completion"
			assert.equal(
				(
					await fetch(`${origin}/v1/sessions`, {
						headers: { cookie: "__Host-e-session=verified" },
					})
				).status,
				200,
			)
			assert.equal(
				(
					await pool.query(
						"SELECT active_backend FROM kay_migration_accounts WHERE account_id='after-completion'",
					)
				).rows[0].active_backend,
				"openbot",
			)
			assert.equal(
				(
					await pool.query(
						"SELECT active_backend FROM kay_migration_accounts WHERE account_id='new-user'",
					)
				).rows[0].active_backend,
				"e",
			)
		} finally {
			await close(gateway)
			await close(authority)
			await close(platform)
			await db.dispose()
			await pool.end()
			await database.close()
		}
	},
)

test(
	"App and Developer callbacks follow stored execution owners after global identity cutover",
	{ timeout: 30000 },
	async () => {
		const database = await start(),
			pool = new Pool({ connectionString: database.url })
		await pool.query(schema)
		await pool.query(
			"INSERT INTO kay_migration_accounts(account_id,source_tenant_id,target_organization_id,migration_id,phase,active_backend,epoch) VALUES('legacy','legacy','org','','E_ACTIVE','e',1),('native','native','org','m','OPENBOT_ACTIVE','openbot',2)",
		)
		const calls: Array<string> = []
		let conflict = false
		const backend = (name: "e" | "openbot") =>
			createServer(async (req, res) => {
				if (req.url === "/internal/apps/authorization-owner") {
					assert.equal(req.headers.authorization, "Bearer fixture-internal")
					const chunks: Array<Buffer> = []
					for await (const chunk of req) chunks.push(Buffer.from(chunk))
					const body = JSON.parse(Buffer.concat(chunks).toString())
					calls.push(name + ":" + body.kind + ":" + body.flowId)
					const accountId =
						body.flowId === "old" && name === "e"
							? "legacy"
							: body.flowId === "new" && name === "openbot"
								? "native"
								: conflict
									? "different-owner"
									: null
					res.writeHead(accountId === null ? 404 : 200, {
						"content-type": "application/json",
					})
					res.end(JSON.stringify({ accountId }))
					return
				}
				assert.equal(req.headers["x-user-id"], undefined)
				res.writeHead(302, { location: "/finished-" + name })
				res.end()
			})
		const e = backend("e"),
			ob = backend("openbot"),
			eOrigin = await listen(e),
			openbotOrigin = await listen(ob)
		const config: Configuration = {
			port: 3100,
			internalPort: 3101,
			internalToken: "fixture-internal",
			publicOrigin: "https://kay.example",
			eOrigin,
			openbotOrigin,
			openbotOrganizationId: "org",
			authBackend: "openbot",
			backendRouting: "ledger",
			databaseUrl: database.url,
		}
		const db = runtime(config),
			gateway = createGateway({ config, db }),
			origin = await listen(gateway)
		try {
			for (const [path, kind] of [
				["/auth/apps/callback", "app"],
				["/auth/developer/apps/callback", "developer"],
			])
				for (const [state, expected] of [
					["old", "e"],
					["new", "openbot"],
				]) {
					const response = await fetch(
						origin + path + "?state=" + state + "&code=fixture",
						{ redirect: "manual", headers: { "x-user-id": "forged" } },
					)
					assert.equal(response.status, 302)
					assert.equal(
						response.headers.get("location"),
						"/finished-" + expected,
					)
					assert.ok(calls.includes(expected + ":" + kind + ":" + state))
				}
			conflict = true
			const rejected = await fetch(
				origin + "/auth/developer/apps/callback?state=old&code=fixture",
				{ redirect: "manual" },
			)
			assert.equal(
				rejected.status,
				400,
				"ambiguous stored ownership cannot select a backend",
			)
		} finally {
			await close(gateway)
			await db.dispose()
			await close(e)
			await close(ob)
			await pool.end()
			await database.close()
		}
	},
)
