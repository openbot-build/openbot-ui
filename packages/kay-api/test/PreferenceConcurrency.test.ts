import assert from "node:assert/strict"
import { test } from "node:test"
import { readFile } from "node:fs/promises"
import { setTimeout } from "node:timers/promises"
import { Pool } from "pg"
import { Effect } from "effect"
import { PreferencesApi } from "@kaicom/e-platform-api"
import { Schema } from "effect"
import { runtime } from "../src/Database.ts"
import * as Preferences from "../src/preferences/Preferences.ts"
import * as Repository from "../src/preferences/RepositoryPostgres.ts"
import { makeOperations } from "../src/Operations.ts"
import { start } from "./PostgresTest.ts"

test(
	"reset serializes with preference edits and delayed compensation preserves newer settings",
	{ timeout: 30000 },
	async () => {
		const database = await start(),
			pool = new Pool({ connectionString: database.url })
		const db = runtime({ databaseUrl: database.url } as Parameters<
			typeof runtime
		>[0])
		const owner = { userId: "owner", tenantId: "owner" }
		let release: () => void = () => {}
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		let entered: () => void = () => {}
		const modifying = new Promise<void>((resolve) => {
			entered = resolve
		})
		try {
			await pool.query(
				await readFile(
					new URL("../migrations/001_business.sql", import.meta.url),
					"utf8",
				),
			)
			const repository = await db.runPromise(
				Repository.make({ exists: () => Effect.succeed(true) }),
			)
			await db.runPromise(
				repository.savePreferences(owner, Preferences.defaults),
			)
			const patch = db.runPromise(
				repository.modifyPreferences({
					owner,
					update: (previous) =>
						Effect.promise(async () => {
							entered()
							await gate
							return {
								...(previous ?? Preferences.defaults),
								assistantName: "Updated",
							}
						}),
				}),
			)
			await modifying
			const reset = db.runPromise(repository.reset(owner))
			let waiting = false
			for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
				waiting =
					(
						await pool.query(
							"SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted",
						)
					).rowCount !== 0
				if (!waiting) await setTimeout(10)
			}
			assert.equal(
				waiting,
				true,
				"reset must wait for the account transaction lock",
			)
			release()
			await patch
			assert.equal(await reset, true)
			assert.equal(await db.runPromise(repository.getPreferences(owner)), null)
			await db.runPromise(
				repository.savePreferences(owner, Preferences.defaults),
			)
			const prepared = await makeOperations(db).prepare({
				id: "reset-operation",
				accountId: "owner",
				backend: "openbot",
				epoch: 1,
				kind: "reset",
				request: { path: "/v1/experience" },
			})
			await db.runPromise(
				repository.savePreferences(owner, {
					...Preferences.defaults,
					assistantName: "New settings",
				}),
			)
			const expected = Schema.decodeUnknownSync(PreferencesApi.Preferences)(
				prepared["expectedPreferences"],
			)
			assert.equal(
				await db.runPromise(repository.reset(owner, expected)),
				false,
			)
			assert.equal(
				(await db.runPromise(repository.getPreferences(owner)))?.assistantName,
				"New settings",
			)
		} finally {
			release()
			await db.dispose()
			await pool.end()
			await database.close()
		}
	},
)
