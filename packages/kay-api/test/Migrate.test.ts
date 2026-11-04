import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import {
	copyFile,
	cp,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { Client } from "pg"
import { start } from "./PostgresTest.ts"

const execute = promisify(execFile)

test(
	"the Docker migration bundle needs only its database URL, reruns safely and rolls back failures",
	{ timeout: 60000 },
	async (t) => {
		const cleanup: Array<() => Promise<void>> = []
		t.after(async () => {
			const errors: unknown[] = []
			for (const close of cleanup.reverse())
				try {
					await close()
				} catch (error) {
					errors.push(error)
				}
			if (errors.length > 0)
				throw new AggregateError(errors, "Migration fixture cleanup failed")
		})
		const packaged = await mkdtemp(join(tmpdir(), "kay-migrate-bundle-"))
		cleanup.push(() => rm(packaged, { recursive: true, force: true }))
		const database = await start()
		cleanup.push(() => database.close())
		const client = new Client({ connectionString: database.url })
		cleanup.push(() => client.end())
		await client.connect()
		// Build the exact entry/config used by docker/Dockerfile, then reproduce its
		// standalone filesystem layout without workspace dependencies beside the bundle.
		await execute(
			"pnpm",
			["exec", "tsdown", "--config", "../../docker/kay.tsdown.config.ts"],
			{
				cwd: fileURLToPath(new URL("..", import.meta.url)),
				timeout: 30000,
				maxBuffer: 4 * 1024 * 1024,
			},
		)
		await mkdir(join(packaged, "dist"))
		await copyFile(
			new URL("../../../.devenv/kay-api/dist/Migrate.mjs", import.meta.url),
			join(packaged, "dist/Migrate.mjs"),
		)
		await cp(
			new URL("../migrations", import.meta.url),
			join(packaged, "migrations"),
			{ recursive: true },
		)
		const run = (env: NodeJS.ProcessEnv = { KAY_DATABASE_URL: database.url }) =>
			execute(process.execPath, [join(packaged, "dist/Migrate.mjs")], {
				cwd: packaged,
				// Match the migration container: no server origins or auth configuration.
				env,
				timeout: 10000,
			})
		for (const env of [
			{},
			{ KAY_DATABASE_URL: "" },
			{ KAY_DATABASE_URL: "https://fixture.invalid/database" },
		])
			await assert.rejects(
				run(env),
				/KAY_DATABASE_URL must be a non-empty PostgreSQL URL/,
			)
		await run()
		assert.deepEqual(
			(
				await client.query(
					"SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
				)
			).rows.map((row) => row.tablename),
			[
				"kay_auth_revocations",
				"kay_basic_compute_accounts",
				"kay_basic_compute_calls",
				"kay_basic_compute_lease",
				"kay_basic_compute_operations",
				"kay_chat_metadata",
				"kay_feedback_connections",
				"kay_feedback_reports",
				"kay_membership_codes",
				"kay_membership_redemptions",
				"kay_navigation",
				"kay_operations",
				"kay_preferences",
				"kay_subscriptions",
			],
		)
		assert.deepEqual(
			(
				await client.query(
					"SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname IN ('kay_operations_owner','kay_auth_revocations_pending') ORDER BY indexname",
				)
			).rows.map((row) => row.indexname),
			["kay_auth_revocations_pending", "kay_operations_owner"],
		)
		await client.query(
			"INSERT INTO kay_preferences(account_id,body) VALUES('existing-account','{\"theme\":\"dark\"}')",
		)
		await client.query(
			"INSERT INTO kay_chat_metadata(account_id,organization_id,chat_id,automation_ids) VALUES('existing-account','kay','chat-a','[\"trigger-a\"]')",
		)
		const metadataBefore = (
			await client.query("SELECT * FROM kay_chat_metadata")
		).rows
		const before = (await client.query("SELECT * FROM kay_preferences")).rows
		await client.query(
			"INSERT INTO kay_subscriptions(account_id,plan_id,starts_at,expires_at,revision) VALUES('existing-account','precious',1,2,1)",
		)
		await client.query(
			"INSERT INTO kay_membership_codes(id,code_hash,plan_id,months,created_by,request_id,created_at) VALUES('saved-code',repeat('a',64),'precious',1,'manager','saved-request',1)",
		)
		const subscriptionBefore = (
			await client.query("SELECT * FROM kay_subscriptions")
		).rows
		const codesBefore = (
			await client.query("SELECT * FROM kay_membership_codes")
		).rows
		await run()
		assert.deepEqual(
			(await client.query("SELECT * FROM kay_subscriptions")).rows,
			subscriptionBefore,
		)
		assert.deepEqual(
			(await client.query("SELECT * FROM kay_membership_codes")).rows,
			codesBefore,
		)
		assert.deepEqual(
			(await client.query("SELECT * FROM kay_chat_metadata")).rows,
			metadataBefore,
		)
		await client.query(
			"INSERT INTO kay_chat_metadata(account_id,organization_id,chat_id) VALUES('existing-account','kay','chat-b')",
		)
		assert.deepEqual(
			(
				await client.query(
					"SELECT automation_ids FROM kay_chat_metadata WHERE chat_id='chat-b'",
				)
			).rows[0].automation_ids,
			[],
		)
		assert.deepEqual(
			(await client.query("SELECT * FROM kay_preferences")).rows,
			before,
		)

		const migration = join(packaged, "migrations/001_business.sql")
		await writeFile(
			migration,
			(await readFile(migration, "utf8")) +
				"\nDO $$ BEGIN PERFORM 1; END $$;\nCREATE TABLE rollback_probe(id text);\nSELECT missing_migration_column;\n",
		)
		await assert.rejects(run(), /missing_migration_column/)
		assert.equal(
			(await client.query("SELECT to_regclass('rollback_probe') AS name"))
				.rows[0].name,
			null,
		)
		assert.deepEqual(
			(await client.query("SELECT * FROM kay_preferences")).rows,
			before,
		)
	},
)
