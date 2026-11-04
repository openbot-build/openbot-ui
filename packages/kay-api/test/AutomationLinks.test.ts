import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { test } from "node:test"
import { Pool } from "pg"
import { Schema } from "effect"
import { make as makeClient, RequestFailed } from "@kaicom/kay-contracts/Client"
import type { NativeCall, NativeClient } from "@kaicom/kay-contracts/Native"
import { makeBusiness, BusinessFailure } from "../src/ProductBusiness.ts"
import { handleProductRequest } from "../src/ProductGateway.ts"
import { runtime } from "../src/Database.ts"
import { start } from "./PostgresTest.ts"

test(
	"automation links are atomic, owner-scoped and readable after an uncertain response",
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
		const nativeCalls: NativeCall[] = []
		let triggerDeleted = false,
			triggerDenied = false,
			sourceDeleted = false
		const native: NativeClient = {
			request: async (call) => {
				nativeCalls.push(call)
				if (call.operation === "chat")
					return Response.json(
						{},
						{
							status:
								call.id === "forbidden-chat"
									? 403
									: sourceDeleted && call.id === "chat-a"
										? 404
										: 200,
						},
					)
				assert.equal(call.operation, "feature")
				assert.equal(call.id, "triggers.getTrigger")
				const value = Schema.decodeUnknownSync(
					Schema.Struct({
						params: Schema.Struct({ triggerId: Schema.String }),
					}),
				)(call.payload)
				return Response.json(
					{},
					{
						status:
							value.params.triggerId === "forbidden-trigger" || triggerDenied
								? 403
								: triggerDeleted
									? 404
									: 200,
					},
				)
			},
		}
		const business = makeBusiness({ db, identity, client: native })
		const gateway = createServer(async (req, res) => {
			const chunks: Buffer[] = []
			for await (const chunk of req)
				chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
			const body = Buffer.concat(chunks).toString()
			await handleProductRequest({
				req,
				res,
				url: new URL(req.url ?? "/", "http://localhost"),
				payload: body === "" ? undefined : JSON.parse(body),
				client: native,
				identity,
				requestId: "link-fixture",
				db,
			})
		})
		try {
			for (const name of ["001_business.sql", "002_chat_automations.sql"])
				await pool.query(
					await readFile(
						new URL(`../migrations/${name}`, import.meta.url),
						"utf8",
					),
				)
			const first = await business.linkAutomation("trigger-a", {
				chatId: "chat-a",
				expectedChatId: null,
			})
			assert.equal(first.chatId, "chat-a")
			assert.deepEqual(first.metadata[0]?.automationIds, ["trigger-a"])
			assert.equal(first.metadata[0]?.revision, 1)
			const race = await Promise.allSettled([
				business.linkAutomation("trigger-a", {
					chatId: "chat-b",
					expectedChatId: "chat-a",
				}),
				business.linkAutomation("trigger-a", {
					chatId: "chat-c",
					expectedChatId: "chat-a",
				}),
			])
			assert.equal(
				race.filter((result) => result.status === "fulfilled").length,
				1,
			)
			const rejected = race.find((result) => result.status === "rejected")
			assert.ok(
				rejected?.status === "rejected" &&
					rejected.reason instanceof BusinessFailure,
			)
			assert.equal(rejected.reason.status, 409)
			const current = await business.getAutomationLink("trigger-a")
			assert.ok(current.chatId === "chat-b" || current.chatId === "chat-c")
			assert.equal(
				(await business.listMetadata()).filter((row) =>
					row.automationIds?.includes("trigger-a"),
				).length,
				1,
			)
			await assert.rejects(
				business.patchMetadata("chat-a", { expected: 1, title: "Stale title" }),
				(failure: unknown) =>
					failure instanceof BusinessFailure && failure.status === 409,
			)
			const other = makeBusiness({
				db,
				identity: { ...identity, userId: "other" },
				client: native,
			})
			const otherOrganization = makeBusiness({
				db,
				identity: { ...identity, organizationId: "another" },
				client: native,
			})
			assert.equal((await other.getAutomationLink("trigger-a")).chatId, null)
			assert.equal(
				(await otherOrganization.getAutomationLink("trigger-a")).chatId,
				null,
			)
			await other.linkAutomation("trigger-a", {
				chatId: "chat-a",
				expectedChatId: null,
			})
			await otherOrganization.linkAutomation("trigger-a", {
				chatId: "chat-a",
				expectedChatId: null,
			})
			assert.equal(
				(await business.getAutomationLink("trigger-a")).chatId,
				current.chatId,
			)
			assert.equal(
				(await other.getAutomationLink("trigger-a")).chatId,
				"chat-a",
			)
			assert.equal(
				(await otherOrganization.getAutomationLink("trigger-a")).chatId,
				"chat-a",
			)
			await assert.rejects(
				business.linkAutomation("forbidden-trigger", {
					chatId: "chat-a",
					expectedChatId: null,
				}),
				(failure: unknown) =>
					failure instanceof BusinessFailure && failure.status === 403,
			)
			await assert.rejects(
				business.linkAutomation("trigger-a", {
					chatId: "forbidden-chat",
					expectedChatId: current.chatId,
				}),
				(failure: unknown) =>
					failure instanceof BusinessFailure && failure.status === 403,
			)
			assert.equal(
				(await business.getAutomationLink("trigger-a")).chatId,
				current.chatId,
			)
			triggerDenied = true
			await assert.rejects(
				business.linkAutomation("trigger-a", {
					chatId: null,
					expectedChatId: current.chatId,
				}),
				(failure: unknown) =>
					failure instanceof BusinessFailure && failure.status === 403,
			)
			triggerDenied = false
			triggerDeleted = true
			const unlinked = await business.linkAutomation("trigger-a", {
				chatId: null,
				expectedChatId: current.chatId,
			})
			assert.equal(unlinked.chatId, null)
			assert.deepEqual(unlinked.metadata[0]?.automationIds, [])
			await assert.rejects(
				business.linkAutomation("missing-trigger", {
					chatId: null,
					expectedChatId: null,
				}),
				(failure: unknown) =>
					failure instanceof BusinessFailure && failure.status === 404,
			)
			triggerDeleted = false
			assert.equal(
				(await other.getAutomationLink("trigger-a")).chatId,
				"chat-a",
			)
			await business.linkAutomation("left", {
				chatId: "chat-a",
				expectedChatId: null,
			})
			await business.linkAutomation("right", {
				chatId: "chat-b",
				expectedChatId: null,
			})
			await Promise.all([
				business.linkAutomation("left", {
					chatId: "chat-b",
					expectedChatId: "chat-a",
				}),
				business.linkAutomation("right", {
					chatId: "chat-a",
					expectedChatId: "chat-b",
				}),
			])
			assert.equal((await business.getAutomationLink("left")).chatId, "chat-b")
			assert.equal((await business.getAutomationLink("right")).chatId, "chat-a")

			await new Promise<void>((resolve) =>
				gateway.listen(0, "127.0.0.1", resolve),
			)
			const address = gateway.address()
			assert.ok(address !== null && typeof address !== "string")
			const baseUrl = `http://127.0.0.1:${address.port}/api/kay/v1`
			const client = makeClient({ baseUrl })
			const linked = await client.linkAutomation("trigger-http", {
				chatId: "chat-a",
				expectedChatId: null,
			})
			assert.equal(linked.chatId, "chat-a")
			assert.equal(
				(await client.automationLink("trigger-http")).chatId,
				"chat-a",
			)
			await assert.rejects(
				client.linkAutomation("trigger-http", {
					chatId: "chat-b",
					expectedChatId: null,
				}),
				(failure: unknown) =>
					failure instanceof RequestFailed && failure.status === 409,
			)
			let writes = 0
			const lostResponse = makeClient({
				baseUrl,
				fetch: async (url, options) => {
					const response = await fetch(url, options)
					if (options?.method === "PUT") {
						writes++
						await response.body?.cancel()
						throw new Error("The association response was lost after commit.")
					}
					return response
				},
			})
			await assert.rejects(
				lostResponse.linkAutomation("trigger-lost", {
					chatId: "chat-a",
					expectedChatId: null,
				}),
				(failure: unknown) =>
					failure instanceof RequestFailed &&
					failure.problem.code === "outcome_unknown",
			)
			assert.equal(writes, 1)
			assert.equal(
				(await client.automationLink("trigger-lost")).chatId,
				"chat-a",
			)
			const metadata = await client.chatMetadata("chat-a")
			const invalid = await fetch(`${baseUrl}/chats/chat-a/metadata`, {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					expected: metadata.revision,
					automationIds: [],
				}),
			})
			assert.equal(invalid.status, 400)
			await client.patchChatMetadata("chat-a", {
				expected: metadata.revision,
				title: "Kept title",
			})
			assert.ok(
				(await client.chatMetadata("chat-a")).automationIds?.includes(
					"trigger-http",
				),
			)
			await client.linkAutomation("deleted-source-move", {
				chatId: "chat-a",
				expectedChatId: null,
			})
			await client.linkAutomation("deleted-source-unlink", {
				chatId: "chat-a",
				expectedChatId: null,
			})
			sourceDeleted = true
			assert.equal(
				(await client.automationLink("deleted-source-move")).chatId,
				"chat-a",
			)
			await assert.rejects(
				client.linkAutomation("deleted-source-move", {
					chatId: "chat-b",
					expectedChatId: null,
				}),
				(failure: unknown) =>
					failure instanceof RequestFailed && failure.status === 409,
			)
			await assert.rejects(
				other.linkAutomation("deleted-source-move", {
					chatId: "chat-b",
					expectedChatId: "chat-a",
				}),
				(failure: unknown) =>
					failure instanceof BusinessFailure && failure.status === 409,
			)
			assert.equal(
				(
					await client.linkAutomation("deleted-source-move", {
						chatId: "chat-b",
						expectedChatId: "chat-a",
					})
				).chatId,
				"chat-b",
			)
			await assert.rejects(
				client.linkAutomation("deleted-source-move", {
					chatId: "chat-a",
					expectedChatId: "chat-b",
				}),
				(failure: unknown) =>
					failure instanceof RequestFailed && failure.status === 404,
			)
			assert.equal(
				(
					await client.linkAutomation("deleted-source-unlink", {
						chatId: null,
						expectedChatId: "chat-a",
					})
				).chatId,
				null,
			)
			assert.ok(
				nativeCalls.every(
					(call) =>
						call.operation === "chat" ||
						(call.operation === "feature" && call.id === "triggers.getTrigger"),
				),
			)
		} finally {
			if (gateway.listening)
				await new Promise<void>((resolve, reject) =>
					gateway.close((error) =>
						error === undefined ? resolve() : reject(error),
					),
				)
			await db.dispose()
			await pool.end()
			await postgres.close()
		}
	},
)
