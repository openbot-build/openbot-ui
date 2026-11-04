import { test } from "node:test"
import assert from "node:assert/strict"
import { once } from "node:events"
import { Pool } from "pg"
import { schema } from "./MigrationSchema.ts"
import { createExecutionAuthority } from "../src/ExecutionAuthority.ts"
import { runtime } from "../src/Database.ts"
import type { Configuration } from "../src/Configuration.ts"
import { start } from "./PostgresTest.ts"

test(
	"drain proof binds the exact account namespace, backend and epoch",
	{ timeout: 30000 },
	async () => {
		const database = await start()
		const pool = new Pool({ connectionString: database.url })
		const config: Configuration = {
			port: 3100,
			internalPort: 3101,
			internalToken: "test-internal-key-32-characters-long",
			publicOrigin: "https://kay.example",
			eOrigin: "http://legacy.invalid",
			openbotOrigin: "http://platform.invalid",
			authBackend: "ledger",
			backendRouting: "ledger",
			databaseUrl: database.url,
		}
		const db = runtime(config)
		const server = createExecutionAuthority({ config, runtime: db })
		try {
			await pool.query(schema)
			await pool.query(
				"INSERT INTO kay_migration_accounts(account_id,source_tenant_id,target_organization_id,migration_id,phase,active_backend,epoch,freeze_deadline_at) VALUES('owner','legacy-owner','org','job','DRAINING','e',3,now()+interval '60 seconds')",
			)
			server.listen(0, "127.0.0.1")
			await once(server, "listening")
			const address = server.address()
			assert.ok(address !== null && typeof address !== "string")
			const check = async (change: Record<string, unknown> = {}) => {
				const response = await fetch(
					`http://127.0.0.1:${address.port}/internal/execution/drain-check`,
					{
						method: "POST",
						headers: {
							authorization: `Bearer ${config.internalToken}`,
							"content-type": "application/json",
						},
						body: JSON.stringify({
							accountId: "owner",
							sourceTenantId: "legacy-owner",
							backend: "e",
							epoch: 3,
							migrationId: "job",
							...change,
						}),
					},
				)
				await response.arrayBuffer()
				return response.status
			}
			assert.equal(await check(), 200)
			assert.equal(await check({ sourceTenantId: "other-owner" }), 409)
			assert.equal(await check({ accountId: "other-owner" }), 409)
			assert.equal(await check({ epoch: 2 }), 409)
			assert.equal(await check({ migrationId: "other-job" }), 409)
			assert.equal(await check({ backend: "openbot" }), 409)
			await pool.query(
				"UPDATE kay_migration_accounts SET active_backend='openbot',phase='OPENBOT_ACTIVE',freeze_deadline_at=NULL",
			)
			assert.equal(await check(), 409)
			assert.equal(
				await check({
					backend: "openbot",
					sourceTenantId: JSON.stringify(["org", "owner"]),
				}),
				409,
			)
			assert.equal(
				await check({
					backend: "openbot",
					sourceTenantId: JSON.stringify(["other-org", "owner"]),
				}),
				409,
			)
			assert.equal(
				await check({
					backend: "openbot",
					sourceTenantId: JSON.stringify(["org", "other-owner"]),
				}),
				409,
			)
			assert.equal(
				await check({ backend: "openbot", sourceTenantId: "legacy-owner" }),
				409,
			)
		} finally {
			server.closeAllConnections()
			if (server.listening)
				await new Promise<void>((resolve, reject) =>
					server.close((error) =>
						error !== undefined ? reject(error) : resolve(),
					),
				)
			await db.dispose()
			await pool.end()
			await database.close()
		}
	},
)
