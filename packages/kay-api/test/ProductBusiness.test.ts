import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { Pool } from "pg"
import { makeBusiness, BusinessFailure } from "../src/ProductBusiness.ts"
import { runtime } from "../src/Database.ts"
import type { NativeClient } from "@kaicom/kay-contracts/Native"
import { start } from "./PostgresTest.ts"

test(
	"product metadata keeps revision conflicts, accounts and organizations isolated in PostgreSQL",
	{ timeout: 30000 },
	async () => {
		const postgres = await start(),
			pool = new Pool({ connectionString: postgres.url })
		const db = runtime({
			databaseUrl: postgres.url,
			port: 3100,
			internalPort: 3101,
			internalToken: "fixture-token-long-enough-for-the-schema",
			publicOrigin: "https://kay.example",
			eOrigin: "http://127.0.0.1:1",
			openbotOrigin: "http://127.0.0.1:1",
			authBackend: "openbot",
			backendRouting: "ledger",
		})
		const calls: string[] = []
		const client: NativeClient = {
			request: async (call) => {
				calls.push(call.id ?? "")
				return Response.json({}, { status: call.id === "mine" ? 200 : 404 })
			},
		}
		try {
			await pool.query(
				await readFile(
					new URL("../migrations/001_business.sql", import.meta.url),
					"utf8",
				),
			)
			await pool.query(
				await readFile(
					new URL("../migrations/002_chat_automations.sql", import.meta.url),
					"utf8",
				),
			)
			const mine = makeBusiness({
				db,
				identity: {
					userId: "owner",
					organizationId: "kay",
					displayName: "Sage",
				},
				client,
			})
			const other = makeBusiness({
				db,
				identity: {
					userId: "other",
					organizationId: "kay",
					displayName: "Other",
				},
				client,
			})
			const otherOrganization = makeBusiness({
				db,
				identity: {
					userId: "owner",
					organizationId: "other-org",
					displayName: "Sage",
				},
				client,
			})
			const results = await Promise.allSettled([
				mine.patchMetadata("mine", { expected: 0, title: "First" }),
				mine.patchMetadata("mine", { expected: 0, title: "Second" }),
			])
			assert.equal(
				results.filter((result) => result.status === "fulfilled").length,
				1,
				JSON.stringify(results),
			)
			const rejected = results.find((result) => result.status === "rejected")
			assert.ok(
				rejected?.status === "rejected" &&
					rejected.reason instanceof BusinessFailure,
			)
			assert.equal(rejected.reason.status, 409)
			const [saved] = await mine.listMetadata()
			assert.equal(saved?.revision, 1)
			assert.equal(
				(await mine.fillTitle("mine", "Automatic title")).title,
				saved.title,
			)
			assert.deepEqual(await other.listMetadata(), [])
			assert.deepEqual(await otherOrganization.listMetadata(), [])
			await mine.patchMetadata("mine", {
				expected: 1,
				archived: true,
				title: null,
			})
			assert.deepEqual(await mine.listMetadata(), [
				{
					chatId: "mine",
					revision: 2,
					title: null,
					archived: true,
					automationIds: [],
				},
			])
			assert.equal(
				(await mine.fillTitle("untitled", "First request")).title,
				"First request",
			)
			assert.equal(
				(await mine.fillTitle("untitled", "Later request")).title,
				"First request",
			)
			await assert.rejects(
				mine.preferences("PATCH", {
					change: {
						_tag: "SetPin",
						sessionId: "foreign",
						expected: false,
						pinned: true,
					},
				}),
				(error: unknown) =>
					error instanceof BusinessFailure && error.status === 404,
			)
			assert.ok(calls.includes("foreign"))
		} finally {
			await db.dispose()
			await pool.end()
			await postgres.close()
		}
	},
)
