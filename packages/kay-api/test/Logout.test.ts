import { readFile } from "node:fs/promises"
import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer, type Server } from "node:http"
import { once } from "node:events"
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
	"anonymous logout cannot abort identity migration; verified revocation spans authority changes and uncertain outcomes",
	{ timeout: 30000 },
	async () => {
		const database = await start(),
			pool = new Pool({ connectionString: database.url })
		await pool.query(schema)
		await pool.query(authSchema)
		await pool.query(
			await readFile(
				new URL("../migrations/001_business.sql", import.meta.url),
				"utf8",
			),
		)
		await pool.query(
			"INSERT INTO kay_migration_accounts(account_id,source_tenant_id,target_organization_id,migration_id,phase,active_backend,epoch,freeze_deadline_at) VALUES('owner','owner','org','business-job','DRAINING','e',0,now()+interval '60 seconds')",
		)
		await pool.query(
			"INSERT INTO kay_migration_accounts(account_id,source_tenant_id,target_organization_id,migration_id,phase,active_backend,epoch,freeze_deadline_at) VALUES('cohort-peer','cohort-peer','org','business-job','DRAINING','e',0,now()+interval '60 seconds')",
		)
		await pool.query(
			"INSERT INTO kay_migration_cohorts(migration_id,organization_id,account_ids) VALUES('business-job','org',ARRAY['owner','cohort-peer'])",
		)
		const token = "fixture-internal-key-at-least-thirty-two-bytes"
		let authorityOrigin = "",
			switchOnVerify = false,
			uncertain = false,
			verificationUnavailable = false
		const revoked: string[] = []
		const platform = (backend: "e" | "openbot") =>
			createServer((req, res) => {
				void (async () => {
					assert.equal(req.headers.authorization, "Bearer " + token)
					assert.equal(req.headers["x-user-id"], undefined)
					res.setHeader("content-type", "application/json")
					if (req.url === "/internal/auth/session") {
						if (verificationUnavailable) {
							res.writeHead(503)
							res.end()
							return
						}
						if (switchOnVerify && backend === "e") {
							switchOnVerify = false
							await pool.query(
								"UPDATE kay_auth_migration SET phase='OPENBOT_ACTIVE',active_backend='openbot',epoch=epoch+1,freeze_deadline_at=NULL",
							)
						}
						const accountId =
							req.headers.cookie === "__Host-e-session=valid.signature"
								? "owner"
								: null
						if (accountId === null)
							res.setHeader(
								"set-cookie",
								"__Host-e-session=; Max-Age=0; Secure; HttpOnly; Path=/",
							)
						res.end(JSON.stringify({ accountId }))
						return
					}
					if (req.url === "/internal/auth/revocation-status") {
						res.end(JSON.stringify({ revoked: true }))
						return
					}
					if (req.url === "/internal/auth/revoke") {
						const chunks: Buffer[] = []
						for await (const chunk of req) chunks.push(Buffer.from(chunk))
						const input = JSON.parse(Buffer.concat(chunks).toString("utf8"))
						const check = await fetch(
							authorityOrigin + "/internal/auth/revocation-check",
							{
								method: "POST",
								headers: {
									authorization: "Bearer " + token,
									"content-type": "application/json",
								},
								body: JSON.stringify({ ...input, backend }),
							},
						)
						assert.equal(check.status, 200)
						revoked.push(backend)
						if (uncertain) {
							req.socket.destroy()
							return
						}
						res.setHeader(
							"set-cookie",
							"__Host-e-session=; Max-Age=0; Secure; HttpOnly; Path=/",
						)
						res.writeHead(204)
						res.end()
						return
					}
					res.writeHead(404)
					res.end()
				})().catch(() => {
					res.writeHead(503)
					res.end()
				})
			})
		const old = platform("e"),
			target = platform("openbot")
		const config: Configuration = {
			port: 3100,
			internalPort: 3101,
			internalToken: token,
			publicOrigin: "https://kay.example",
			eOrigin: await listen(old),
			openbotOrigin: await listen(target),
			authBackend: "ledger",
			backendRouting: "ledger",
			databaseUrl: database.url,
		}
		const db = runtime(config),
			gateway = createGateway({ config, db }),
			authority = createExecutionAuthority({ config, runtime: db })
		const origin = await listen(gateway)
		authorityOrigin = await listen(authority)
		const state = async () =>
			(
				await pool.query(
					"SELECT phase,active_backend,epoch FROM kay_auth_migration",
				)
			).rows[0]
		const signOut = (headers: Record<string, string>) =>
			fetch(origin + "/auth/logout", { method: "POST", headers })
		const frozen = () =>
			pool.query(
				"UPDATE kay_auth_migration SET phase='COPIED',active_backend='e',migration_id='auth-job',freeze_deadline_at=now()+interval '60 seconds'",
			)
		const real = {
			origin: config.publicOrigin,
			cookie: "__Host-e-session=valid.signature",
		}
		try {
			await frozen()
			const before = await state()
			for (const headers of [
				{ origin: config.publicOrigin },
				{ authorization: "Bearer arbitrary" },
				{
					origin: config.publicOrigin,
					cookie: "__Host-e-session=forged",
					"x-user-id": "owner",
				},
			]) {
				const response = await signOut(headers)
				assert.equal(response.status, 204)
				assert.deepEqual(await state(), before)
			}
			assert.equal(revoked.length, 0)
			assert.equal(
				(
					await pool.query(
						"SELECT count(*)::int AS n FROM kay_auth_write_leases",
					)
				).rows[0].n,
				0,
			)
			verificationUnavailable = true
			assert.equal((await signOut(real)).status, 503)
			assert.deepEqual(await state(), before)
			verificationUnavailable = false
			assert.equal((await signOut(real)).status, 204)
			assert.deepEqual(revoked, ["e"])
			assert.equal((await state()).phase, "E_ACTIVE")
			assert.equal(Number((await state()).epoch), 1)
			assert.equal(
				(
					await pool.query(
						"SELECT phase FROM kay_migration_accounts WHERE account_id='owner'",
					)
				).rows[0].phase,
				"E_ACTIVE",
			)
			assert.equal(
				(
					await pool.query(
						"SELECT count(*)::int AS n FROM kay_auth_write_leases",
					)
				).rows[0].n,
				0,
			)
			await frozen()
			switchOnVerify = true
			assert.equal((await signOut(real)).status, 204)
			assert.deepEqual(revoked, ["e", "openbot"])
			assert.equal((await state()).phase, "OPENBOT_ACTIVE")
			await frozen()
			uncertain = true
			assert.equal((await signOut(real)).status, 503)
			assert.equal(
				(
					await pool.query(
						"SELECT count(*)::int AS n FROM kay_auth_write_leases",
					)
				).rows[0].n,
				1,
			)
			assert.equal(
				(
					await pool.query(
						"SELECT phase FROM kay_migration_accounts WHERE account_id='cohort-peer'",
					)
				).rows[0].phase,
				"E_ACTIVE",
			)
			const pending = await state()
			await pool.query(
				"UPDATE kay_auth_migration SET phase='DRAINING',freeze_deadline_at=now()+interval '60 seconds'",
			)
			const drain = await fetch(
				authorityOrigin + "/internal/auth/drain-check",
				{
					method: "POST",
					headers: {
						authorization: "Bearer " + token,
						"content-type": "application/json",
					},
					body: JSON.stringify({
						backend: "e",
						epoch: Number(pending.epoch),
						migrationId: "auth-job",
					}),
				},
			)
			assert.equal(drain.status, 409)
			const receipt = (
				await pool.query(
					"SELECT id FROM kay_auth_revocations WHERE phase='Pending'",
				)
			).rows[0].id
			const reconciled = await fetch(
				authorityOrigin + "/internal/auth/revocations/reconcile",
				{
					method: "POST",
					headers: {
						authorization: "Bearer " + token,
						"content-type": "application/json",
					},
					body: JSON.stringify({ id: receipt }),
				},
			)
			assert.equal(reconciled.status, 200)
			assert.equal((await reconciled.json()).completed, true)
			assert.equal(
				(
					await pool.query(
						"SELECT count(*)::int AS n FROM kay_auth_write_leases",
					)
				).rows[0].n,
				0,
			)
			assert.equal(
				(
					await pool.query(
						"SELECT phase FROM kay_auth_revocations WHERE id=$1",
						[receipt],
					)
				).rows[0].phase,
				"Completed",
			)
		} finally {
			await close(gateway)
			await close(authority)
			await close(old)
			await close(target)
			await db.dispose()
			await pool.end()
			await database.close()
		}
	},
)
