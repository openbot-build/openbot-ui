import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { once } from "node:events"
import { test } from "node:test"
import { Schema } from "effect"
import { Pool } from "pg"
import type { NativeClient } from "@kaicom/kay-contracts/Native"
import { makeDefaultBot } from "../src/DefaultBot.ts"
import { BusinessFailure } from "../src/ProductBusiness.ts"
import { handleProductRequest } from "../src/ProductGateway.ts"
import { makeOperations, type Operation } from "../src/Operations.ts"
import { runtime } from "../src/Database.ts"
import { start } from "./PostgresTest.ts"

test(
	"default assistant setup survives lost responses and concurrent tabs without recreating Bots",
	{ timeout: 30000 },
	async () => {
		const postgres = await start()
		const pool = new Pool({ connectionString: postgres.url })
		const db = runtime({
			databaseUrl: postgres.url,
			port: 3100,
			internalPort: 3101,
			internalToken: "test-token-with-at-least-32-characters",
			publicOrigin: "https://kay.example",
			openbotOrigin: "http://127.0.0.1:1",
			eOrigin: "http://127.0.0.1:1",
			authBackend: "openbot",
			backendRouting: "native",
			nextEnabled: true,
			openbotOrganizationId: "kay",
		})
		try {
			await pool.query(
				await readFile(
					new URL("../migrations/001_business.sql", import.meta.url),
					"utf8",
				),
			)
			const fixture = (userId: string, organizationId = "kay") => {
				let selected: string | null = null,
					version = 0,
					creates = 0,
					updates = 0
				let loseCreation = false,
					loseSelection = false,
					createNothing = false,
					conflictSelection = false
				let bots: Schema.JsonObject[] = []
				let available = true
				let inheritModel = false
				let creationStatus = 201,
					malformedCreation = false
				const client: NativeClient = {
					request: async (call) => {
						if (call.operation === "bots") return Response.json(bots)
						if (call.id === "organization.getSettings")
							return Response.json({
								chatModel: inheritModel
									? {
											_tag: "Config.Selection",
											provider: "shared-provider",
											model: "shared-model",
										}
									: null,
							})
						if (call.id === "memberSettings.getMemberSettings")
							return Response.json({ version, defaultBot: selected })
						if (call.id === "modelProviders.getModelCatalog")
							return Response.json({
								models: [
									{ provider: "provider-a", id: "voice-first", type: "live" },
									{
										provider: "provider-a",
										id: "decision-second",
										type: "decision",
									},
									...(available
										? [
												{
													provider: "provider-a",
													id: "language-third",
													type: "language",
												},
											]
										: []),
								],
							})
						const command = Schema.decodeUnknownSync(
							Schema.Struct({ payload: Schema.JsonObject }),
						)(call.payload).payload
						if (call.id === "bots.createBot") {
							creates++
							if (creationStatus !== 201)
								return Response.json(
									{ message: "Refused" },
									{ status: creationStatus },
								)
							if (malformedCreation)
								return Response.json({ invalid: true }, { status: 201 })
							assert.deepEqual(
								command["model"],
								inheritModel
									? undefined
									: {
											_tag: "Config.Selection",
											provider: "provider-a",
											model: "language-third",
										},
							)
							const bot = {
								...command,
								id: `bot-${organizationId}-${userId}`,
								owner: { _tag: "Member", userId },
								archived: false,
								revision: 0,
							}
							if (!createNothing) bots = [...bots, bot]
							if (loseCreation)
								throw new Error("Connection closed after dispatch")
							return Response.json(bot, { status: 201 })
						}
						assert.equal(call.id, "memberSettings.updateMemberSettings")
						updates++
						if (conflictSelection) {
							selected = "selected-in-other-tab"
							version++
							return Response.json({}, { status: 409 })
						}
						if (command["expectedVersion"] !== version)
							return Response.json({}, { status: 409 })
						selected = Schema.decodeUnknownSync(Schema.String)(
							command["defaultBot"],
						)
						version++
						if (loseSelection) throw new Error("Selection response lost")
						return Response.json({ version, defaultBot: selected })
					},
				}
				return {
					client,
					identity: { userId, organizationId, displayName: userId },
					service: makeDefaultBot({
						db,
						client,
						epoch: 0,
						identity: { userId, organizationId, displayName: userId },
					}),
					stats: () => ({ creates, updates, selected }),
					inheritModel: () => {
						inheritModel = true
					},
					creationStatus: (value: number) => {
						creationStatus = value
					},
					malformedCreation: () => {
						malformedCreation = true
					},
					available: (value: boolean) => {
						available = value
					},
					loseCreation: (empty = false) => {
						loseCreation = true
						createNothing = empty
					},
					loseSelection: () => {
						loseSelection = true
					},
					conflictSelection: () => {
						conflictSelection = true
					},
					shared: () => {
						bots = [
							{
								id: "shared-kay",
								name: "Kay Bot",
								role: "",
								instructions: "",
								archived: false,
								revision: 0,
								owner: { _tag: "Organization" },
							},
						]
					},
				}
			}
			const concurrent = fixture("concurrent")
			const inherited = fixture("inherited")
			inherited.inheritModel()
			assert.equal((await inherited.service.ensure()).phase, "ready")
			assert.equal(inherited.stats().creates, 1)
			assert.deepEqual(await concurrent.service.get(), {
				phase: "uninitialized",
				botId: null,
			})
			await Promise.all([
				concurrent.service.ensure(),
				concurrent.service.ensure(),
				concurrent.service.ensure(),
			])
			assert.equal(concurrent.stats().creates, 1)
			assert.equal((await concurrent.service.get()).phase, "ready")
			const lost = fixture("lost")
			lost.loseCreation()
			assert.equal((await lost.service.ensure()).phase, "outcome_unknown")
			assert.deepEqual(await lost.service.get(), {
				phase: "outcome_unknown",
				botId: "bot-kay-lost",
			})
			assert.equal(lost.stats().updates, 0, "Status reads never select a Bot")
			assert.equal((await lost.service.ensure()).phase, "ready")
			assert.equal(lost.stats().creates, 1)
			const empty = fixture("lost-empty")
			empty.loseCreation(true)
			await empty.service.ensure()
			await empty.service.ensure()
			assert.equal(
				empty.stats().creates,
				1,
				"An uncertain empty result must not dispatch another creation",
			)
			assert.equal((await empty.service.get()).phase, "outcome_unknown")
			const selected = fixture("selection-lost")
			selected.loseSelection()
			await selected.service.ensure()
			assert.equal((await selected.service.get()).phase, "ready")
			await selected.service.ensure()
			assert.deepEqual(selected.stats(), {
				creates: 1,
				updates: 1,
				selected: "bot-kay-selection-lost",
			})
			const conflict = fixture("selection-conflict")
			conflict.conflictSelection()
			assert.equal(
				(await conflict.service.ensure()).botId,
				"selected-in-other-tab",
			)
			const foreign = fixture("shared")
			foreign.shared()
			assert.equal(
				(await foreign.service.ensure()).botId,
				"bot-kay-shared",
				"A shared Bot is not a personal assistant",
			)
			const otherOrganization = fixture("concurrent", "other")
			assert.equal(
				(await otherOrganization.service.ensure()).botId,
				"bot-other-concurrent",
			)
			assert.equal(otherOrganization.stats().creates, 1)
			const unavailable = fixture("no-language")
			unavailable.available(false)
			await assert.rejects(unavailable.service.ensure())
			assert.equal(unavailable.stats().creates, 0)
			assert.equal((await unavailable.service.get()).phase, "uninitialized")
			unavailable.available(true)
			assert.equal((await unavailable.service.ensure()).phase, "ready")
			for (const status of [400, 401, 403, 404, 409, 422]) {
				const denied = fixture(`denied-${status}`)
				denied.creationStatus(status)
				await assert.rejects(
					denied.service.ensure(),
					(error: unknown) =>
						error instanceof BusinessFailure && error.status === status,
				)
				assert.equal((await denied.service.get()).phase, "uninitialized")
				denied.creationStatus(201)
				await Promise.all([denied.service.ensure(), denied.service.ensure()])
				assert.equal((await denied.service.get()).phase, "ready")
				assert.equal(
					denied.stats().creates,
					2,
					"The explicit retry creates once after one confirmed refusal",
				)
			}
			for (const status of [500, 503]) {
				const failed = fixture(`server-${status}`)
				failed.creationStatus(status)
				assert.equal((await failed.service.ensure()).phase, "outcome_unknown")
				failed.creationStatus(201)
				assert.equal((await failed.service.ensure()).phase, "outcome_unknown")
				assert.equal(failed.stats().creates, 1)
			}
			const malformed = fixture("malformed")
			malformed.malformedCreation()
			await malformed.service.ensure()
			await malformed.service.ensure()
			assert.equal(malformed.stats().creates, 1)

			const operations = makeOperations(db)
			const first: Operation = {
				id: "release-cas",
				accountId: "owner",
				backend: "openbot",
				epoch: 0,
				kind: "default-bot",
				request: { attemptId: "first" },
			}
			await operations.claim(first)
			await operations.mark({
				id: first.id,
				accountId: first.accountId,
				attemptId: "first",
				phase: "Sending",
			})
			assert.equal(
				await operations.releaseRejected({ ...first, status: 503 }),
				false,
			)
			assert.equal(
				await operations.releaseRejected({ ...first, status: 403 }),
				true,
			)
			const second = { ...first, request: { attemptId: "second" } }
			assert.equal(await operations.claim(second), true)
			await operations.mark({
				id: second.id,
				accountId: second.accountId,
				attemptId: "second",
				phase: "Sending",
			})
			assert.equal(
				await operations.releaseRejected({ ...first, status: 403 }),
				false,
			)
			await operations.mark({
				id: first.id,
				accountId: first.accountId,
				attemptId: "first",
				phase: "OutcomeUnknown",
			})
			assert.equal(
				(await operations.get({ id: second.id, accountId: second.accountId }))
					?.phase,
				"Sending",
			)
			await operations.mark({
				id: second.id,
				accountId: second.accountId,
				attemptId: "second",
				phase: "OutcomeUnknown",
			})
			assert.equal(
				await operations.releaseRejected({ ...second, status: 403 }),
				false,
			)

			let endpoint = fixture("http-401")
			const server = createServer((req, res) => {
				void (async () => {
					const chunks: Buffer[] = []
					for await (const chunk of req) chunks.push(Buffer.from(chunk))
					await handleProductRequest({
						req,
						res,
						url: new URL(req.url ?? "/", "https://kay.example"),
						payload: JSON.parse(Buffer.concat(chunks).toString()),
						client: endpoint.client,
						identity: endpoint.identity,
						requestId: "fixture",
						db,
						epoch: 0,
					})
				})().catch(() => res.writeHead(500).end())
			})
			server.listen(0, "127.0.0.1")
			await once(server, "listening")
			try {
				const address = server.address()
				if (address === null || typeof address === "string")
					throw new Error("Expected TCP")
				for (const [status, code] of [
					[401, "unauthorized"],
					[403, "forbidden"],
					[400, "invalid_input"],
				] as const) {
					endpoint = fixture(`http-${status}`)
					endpoint.creationStatus(status)
					const response: Response = await fetch(
						`http://127.0.0.1:${address.port}/api/kay/v1/default-bot`,
						{
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({
								userId: endpoint.identity.userId,
								organizationId: endpoint.identity.organizationId,
							}),
						},
					)
					assert.equal(response.status, status)
					assert.equal((await response.json()).code, code)
				}
			} finally {
				server.closeAllConnections()
				await new Promise<void>((resolve, reject) =>
					server.close((error) =>
						error === undefined ? resolve() : reject(error),
					),
				)
			}
		} finally {
			await db.dispose()
			await pool.end()
			await postgres.close()
		}
	},
)
