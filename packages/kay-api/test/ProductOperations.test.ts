import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { Pool } from "pg"
import type { NativeClient } from "@kaicom/kay-contracts/Native"
import { makeBusiness, BusinessFailure } from "../src/ProductBusiness.ts"
import {
	makeProductOperations,
	ProductOutcomeUnknown,
} from "../src/ProductOperations.ts"
import { runtime } from "../src/Database.ts"
import { start } from "./PostgresTest.ts"

test(
	"conversation fork compensation preserves product ownership and never repeats uncertain core writes",
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
		const identity = {
			userId: "owner",
			organizationId: "kay",
			displayName: "Owner",
		}
		let writes = 0,
			failRead = false,
			failWrite = false
		const client: NativeClient = {
			request: async (call) => {
				if (call.operation === "feature" && call.id === "triggers.getTrigger")
					return Response.json({ id: "trigger-a" })
				if (call.operation === "chat")
					return Response.json({}, { status: failRead ? 503 : 200 })
				writes++
				if (failWrite) throw new Error("Response lost after dispatch")
				return Response.json({ chat: { id: "fork" } }, { status: 201 })
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
			const business = makeBusiness({ db, identity, client })
			for (const change of [
				{
					_tag: "CreateCompanion",
					id: "friend",
					name: "Friend",
					color: "#497BA9",
				},
				{ _tag: "AssignCompanion", sessionId: "source", companionId: "friend" },
				{
					_tag: "CreateProject",
					sessionId: "source",
					id: "project",
					name: "Project",
				},
			])
				await business.preferences("PATCH", { change })
			await business.patchMetadata("source", {
				expected: 0,
				title: "Named source",
				archived: true,
			})
			await business.linkAutomation("trigger-a", {
				chatId: "source",
				expectedChatId: null,
			})
			const operations = makeProductOperations({
				db,
				identity,
				client,
				epoch: 3,
			})
			const call = {
				operation: "fork",
				id: "source",
				payload: { requestId: "fork-a", expected: 1, reason: "fork" },
			} as const
			failRead = true
			await assert.rejects(operations.run(call), ProductOutcomeUnknown)
			assert.equal(writes, 1)
			assert.deepEqual(await operations.get("fork-a"), {
				requestId: "fork-a",
				phase: "Applied",
				chatId: "fork",
			})
			failRead = false
			await Promise.all([
				operations.reconcile("fork-a"),
				operations.reconcile("fork-a"),
			])
			assert.equal(writes, 1)
			const inherited = await business.preferences("GET")
			assert.deepEqual(
				inherited.workspace?.companions.find((c) => c.id === "friend")
					?.sessions,
				["source", "fork"],
			)
			assert.deepEqual(inherited.workspace?.projects?.[0]?.sessions, [
				"source",
				"fork",
			])
			assert.ok(
				(await business.listMetadata()).some(
					(row) =>
						row.chatId === "fork" &&
						row.title === "Named source" &&
						!row.archived,
				),
			)
			assert.deepEqual(
				(await business.listMetadata()).find((row) => row.chatId === "fork")
					?.automationIds,
				[],
			)
			assert.deepEqual(
				(await business.listMetadata()).find((row) => row.chatId === "source")
					?.automationIds,
				["trigger-a"],
			)
			await business.preferences("PATCH", {
				change: { _tag: "MoveToProject", sessionId: "fork", projectId: null },
			})
			await operations.run(call)
			assert.equal(writes, 1)
			assert.deepEqual(
				(await business.preferences("GET")).workspace?.projects?.[0]?.sessions,
				["source"],
			)
			await assert.rejects(
				operations.run({ ...call, id: "different" }),
				(error: unknown) =>
					error instanceof BusinessFailure && error.status === 409,
			)
			const stranger = makeProductOperations({
				db,
				client,
				epoch: 3,
				identity: { ...identity, userId: "other" },
			})
			await assert.rejects(
				stranger.get("fork-a"),
				(error: unknown) =>
					error instanceof BusinessFailure && error.status === 404,
			)
			failWrite = true
			const unknown = {
				...call,
				payload: { ...call.payload, requestId: "fork-unknown" },
			}
			await assert.rejects(operations.run(unknown), ProductOutcomeUnknown)
			await assert.rejects(operations.run(unknown), ProductOutcomeUnknown)
			await assert.rejects(
				operations.reconcile("fork-unknown"),
				ProductOutcomeUnknown,
			)
			assert.equal(writes, 2)
			assert.equal(
				(await operations.get("fork-unknown")).phase,
				"OutcomeUnknown",
			)
		} finally {
			await db.dispose()
			await pool.end()
			await postgres.close()
		}
	},
)
