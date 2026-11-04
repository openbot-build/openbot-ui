import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import {
	chmod,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { once } from "node:events"
import { createServer } from "node:http"
import { Pool } from "pg"
import { PgClient } from "@effect/sql-pg"
import { Layer, ManagedRuntime, Redacted, Schema } from "effect"
import type { NativeCall, NativeClient } from "@kaicom/kay-contracts/Native"
import type { openNativeComputerSocket } from "@kaicom/kay-openbot"
import { BasicComputeFailure, makeBasicCompute } from "../src/BasicCompute.ts"
import type { BasicComputeBrokerClient } from "../src/BasicComputeBrokerClient.ts"
import {
	makeBasicComputeBroker,
	recoverBasicComputeBroker,
} from "../src/BasicComputeBroker.ts"
import {
	BasicComputeFailure as DockerFailure,
	type makeBasicComputeDocker,
	type CommandResult,
} from "../src/BasicComputeDocker.ts"
import { makeComputeStore } from "../src/BasicComputeStore.ts"
import {
	openComputeToken,
	readComputeKey,
	sealComputeToken,
} from "../src/BasicComputeSecrets.ts"
import { basicComputeManagedPath } from "../src/BasicComputeManagement.ts"
import { runtime } from "../src/Database.ts"
import { handleProductRequest } from "../src/ProductGateway.ts"
import { start } from "./PostgresTest.ts"

const object = Schema.decodeUnknownSync(Schema.JsonObject)
const deferred = <T>() => {
	let resolve!: (value: T) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<T>((yes, no) => {
		resolve = yes
		reject = no
	})
	return { promise, resolve, reject }
}
const until = async (predicate: () => boolean | Promise<boolean>) => {
	for (let i = 0; i < 300; i++) {
		if (await predicate()) return
		await new Promise((resolve) => setTimeout(resolve, 5))
	}
	throw new Error("The expected test state was not reached.")
}

test("connector secrets bind account, organization, computer and generation and require a private key file", async () => {
	const dir = await mkdtemp(join(tmpdir(), "kay-compute-key-"))
	try {
		const key = randomBytes(32),
			path = join(dir, "key")
		await writeFile(path, key, { mode: 0o600 })
		assert.deepEqual(await readComputeKey(path), key)
		const binding = {
			accountId: "member",
			organizationId: "org",
			computerId: "computer",
			generation: 1,
		}
		const ciphertext = sealComputeToken({
			key,
			binding,
			token: "fixture-token",
		})
		assert.ok(!ciphertext.includes("fixture-token"))
		assert.equal(
			openComputeToken({ key, binding, ciphertext }),
			"fixture-token",
		)
		for (const changed of [
			{ ...binding, accountId: "other" },
			{ ...binding, organizationId: "other" },
			{ ...binding, computerId: "other" },
			{ ...binding, generation: 2 },
		])
			assert.throws(() =>
				openComputeToken({ key, binding: changed, ciphertext }),
			)
		await chmod(path, 0o644)
		await assert.rejects(readComputeKey(path))
		await chmod(path, 0o600)
		await symlink(path, join(dir, "link"))
		await assert.rejects(readComputeKey(join(dir, "link")))
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
})

test(
	"basic compute uses member-owned core resources and durable PostgreSQL fences",
	{ timeout: 60000 },
	async (t) => {
		const postgres = await start()
		const pool = new Pool({ connectionString: postgres.url })
		const db = runtime({ databaseUrl: postgres.url })
		const dir = await mkdtemp(join(tmpdir(), "kay-compute-api-")),
			key = randomBytes(32),
			keyFile = join(dir, "key")
		await writeFile(keyFile, key, { mode: 0o600 })
		t.after(async () => {
			await db.dispose()
			await pool.end()
			await postgres.close()
			await rm(dir, { recursive: true, force: true })
		})
		for (const name of [
			"003_membership.sql",
			"004_basic_compute.sql",
			"005_compute_activity.sql",
		])
			await pool.query(
				await readFile(
					new URL("../migrations/" + name, import.meta.url),
					"utf8",
				),
			)
		const store = makeComputeStore(db)
		const reset = async () => {
			await pool.query(
				"TRUNCATE kay_basic_compute_calls,kay_basic_compute_lease,kay_basic_compute_operations,kay_basic_compute_accounts,kay_subscriptions",
			)
		}
		const subscribe = (accountId: string) =>
			pool.query(
				"INSERT INTO kay_subscriptions VALUES($1,'precious',1,$2,1) ON CONFLICT(account_id) DO UPDATE SET expires_at=excluded.expires_at",
				[accountId, Date.now() + 600000],
			)
		const native = (accountId = "member", organizationId = "org") => {
			const computers = new Map<string, { granted: boolean; token: string }>()
			const executions = new Map<
				string,
				{ status: string; resource: { id: string } }
			>()
			const receipts = new Map<string, { executionId: string }>()
			const calls: NativeCall[] = []
			let counter = 0,
				lostCreate = false,
				unconfirmedCreate = false,
				lostToken = false,
				grantResponse: number | undefined,
				createWait: ReturnType<typeof deferred<void>> | undefined,
				delayedToken: ReturnType<typeof deferred<Response>> | undefined
			const finishCreate = (commandKey: string) => {
				let receipt = receipts.get(commandKey)
				if (receipt === undefined) {
					const id = organizationId + "-" + accountId + "-computer-" + ++counter
					computers.set(id, { granted: false, token: "" })
					receipt = { executionId: "execution-" + id }
					receipts.set(commandKey, receipt)
					executions.set(receipt.executionId, {
						status: "completed",
						resource: { id },
					})
				}
				return receipt
			}
			const client: NativeClient = {
				request: async (call) => {
					calls.push(call)
					if (call.operation === "memberSettings")
						return Response.json({ defaultBot: "bot-" + accountId })
					if (call.operation === "bots")
						return Response.json([
							{
								id: "bot-" + accountId,
								owner: { _tag: "Member", userId: accountId },
							},
						])
					if (call.operation === "commandReceipt")
						return Response.json(receipts.get(call.id!) ?? null)
					if (call.operation === "execution")
						return Response.json(executions.get(call.id!) ?? null)
					const data = object(call.payload),
						params = data["params"] === undefined ? {} : object(data["params"]),
						payload =
							data["payload"] === undefined ? {} : object(data["payload"])
					const computerId = String(params["computerId"])
					if (call.id === "computers.createComputer") {
						assert.equal(payload["shared"], false)
						const commandKey = String(payload["commandKey"])
						await createWait?.promise
						if (unconfirmedCreate) {
							unconfirmedCreate = false
							throw new Error("fixture creation has no receipt yet")
						}
						const receipt = finishCreate(commandKey)
						if (lostCreate) {
							lostCreate = false
							throw new Error("fixture lost response")
						}
						return Response.json(receipt, { status: 202 })
					}
					if (call.id === "computers.getComputer")
						return computers.has(computerId)
							? Response.json({
									id: computerId,
									owner: { _tag: "Member", userId: accountId },
									source: { _tag: "Connector" },
								})
							: new Response(null, { status: 404 })
					if (call.id === "computers.deleteComputer") {
						computers.delete(computerId)
						const receipt = { executionId: "delete-" + computerId }
						receipts.set(String(payload["commandKey"]), receipt)
						executions.set(receipt.executionId, {
							status: "completed",
							resource: { id: computerId },
						})
						return Response.json(receipt, { status: 202 })
					}
					const computer = computers.get(computerId)
					if (computer === undefined) return new Response(null, { status: 404 })
					if (call.id === "computers.listComputerBots")
						return Response.json(
							computer.granted
								? [{ bot: "bot-" + accountId, computer: computerId }]
								: [],
						)
					if (call.id === "computers.grantComputer") {
						assert.equal(params["botId"], "bot-" + accountId)
						if (grantResponse !== undefined)
							return new Response(null, { status: grantResponse })
						computer.granted = true
						return new Response(null, { status: 204 })
					}
					if (call.id === "computers.setConnectorToken") {
						computer.token = "token-" + computerId
						if (delayedToken !== undefined) {
							const waiting = delayedToken
							delayedToken = undefined
							return waiting.promise
						}
						if (lostToken) {
							lostToken = false
							throw new Error("fixture lost token response")
						}
						return Response.json({ token: computer.token })
					}
					throw new Error("Unexpected native request: " + call.id)
				},
			}
			return {
				client,
				calls,
				computers,
				loseCreate: () => {
					lostCreate = true
				},
				delayCreate: () => {
					createWait = deferred<void>()
					return createWait
				},
				loseCreateBeforeReceipt: () => {
					unconfirmedCreate = true
				},
				confirmCreate: () => {
					const call = calls.find(
						(entry) => entry.id === "computers.createComputer",
					)!
					return finishCreate(
						String(object(object(call.payload)["payload"])["commandKey"]),
					)
				},
				setGrantResponse: (status: number) => {
					grantResponse = status
				},
				confirmGrant: () => {
					for (const computer of computers.values()) computer.granted = true
				},
				loseToken: () => {
					lostToken = true
				},
				delayToken: () => {
					delayedToken = deferred<Response>()
					return delayedToken
				},
			}
		}
		const api = (
			client: NativeClient,
			accountId = "member",
			organizationId = "org",
			wake: BasicComputeBrokerClient["wake"] = async () => {},
		) =>
			makeBasicCompute({
				db,
				client,
				identity: { userId: accountId, organizationId, displayName: accountId },
				config: { socketPath: join(dir, "broker.sock"), keyFile },
				broker: {
					health: async () => {},
					wake,
					release: async () => {},
				},
			})
		const connectPrepared = async () => {
			const account = await store.account({
				accountId: "member",
				organizationId: "org",
			})
			assert.ok(account?.token_ciphertext)
			await store.connection({
				accountId: account.account_id,
				organizationId: account.organization_id,
				generation: account.generation,
				connected: true,
			})
		}
		await t.test(
			"automatic setup leaves nonmembers and other Bots unchanged",
			async () => {
				await reset()
				const core = native(),
					service = api(core.client, "member", "org", connectPrepared)
				await service.prepareForMessage("bot-member")
				assert.equal(core.calls.length, 0)
				assert.equal(
					await store.account({ accountId: "member", organizationId: "org" }),
					null,
				)
				await subscribe("member")
				await service.prepareForMessage("another-bot")
				assert.equal(core.computers.size, 0)
				assert.equal(
					await store.account({ accountId: "member", organizationId: "org" }),
					null,
				)
			},
		)
		await t.test(
			"automatic setup creates one connected personal Computer for concurrent messages",
			async () => {
				await reset()
				await subscribe("member")
				const wakeOwners: Array<
					Parameters<BasicComputeBrokerClient["wake"]>[0]
				> = []
				const core = native(),
					service = api(core.client, "member", "org", async (owner) => {
						if (owner !== undefined) wakeOwners.push(owner)
						await connectPrepared()
					})
				await Promise.all([
					service.prepareForMessage("bot-member"),
					service.prepareForMessage("bot-member"),
				])
				await service.prepareForMessage("bot-member")
				assert.ok(wakeOwners.length >= 3)
				for (const owner of wakeOwners)
					assert.deepEqual(owner, {
						accountId: "member",
						organizationId: "org",
					})
				assert.equal(core.computers.size, 1)
				assert.equal(
					core.calls.filter((call) => call.id === "computers.createComputer")
						.length,
					1,
				)
				assert.equal(
					core.calls.filter((call) => call.id === "computers.setConnectorToken")
						.length,
					1,
				)
				assert.equal(
					(await store.account({ accountId: "member", organizationId: "org" }))
						?.state,
					"ready",
				)
				assert.equal(await store.lease(), null)
			},
		)
		await t.test(
			"automatic setup continues a lost creation response without another Computer",
			async () => {
				await reset()
				await subscribe("member")
				const core = native(),
					service = api(core.client, "member", "org", connectPrepared)
				core.loseCreate()
				await service.prepareForMessage("bot-member")
				assert.equal(core.computers.size, 1)
				assert.equal(
					core.calls.filter((call) => call.id === "computers.createComputer")
						.length,
					1,
				)
			},
		)
		await t.test(
			"automatic setup does not rotate an unconfirmed connector credential",
			async () => {
				await reset()
				await subscribe("member")
				const core = native(),
					service = api(core.client, "member", "org", connectPrepared)
				core.loseToken()
				for (let attempt = 0; attempt < 2; attempt++)
					assert.equal(
						await service.prepareForMessage("bot-member"),
						"unavailable",
					)
				assert.equal(
					core.calls.filter((call) => call.id === "computers.setConnectorToken")
						.length,
					1,
				)
				assert.equal(core.computers.size, 1)
			},
		)
		await t.test(
			"both message routes prepare one personal Computer before the model starts",
			async () => {
				await reset()
				await subscribe("member")
				const core = native()
				const sent: NativeCall[] = []
				const config = {
					socketPath: join(dir, "automatic-broker.sock"),
					keyFile,
				}
				const brokerServer = createServer((req, res) => {
					void (async () => {
						if (req.url === "/wake") await connectPrepared()
						res.writeHead(204).end()
					})().catch(() => res.writeHead(503).end())
				})
				brokerServer.listen(config.socketPath)
				await once(brokerServer, "listening")
				const client: NativeClient = {
					request: async (call) => {
						if (call.operation === "chat")
							return call.id === "forbidden"
								? new Response(null, { status: 403 })
								: Response.json({ chat: { id: call.id, bot: "bot-member" } })
						if (call.operation === "send" || call.operation === "sendToBot") {
							if (sent.length < 2)
								assert.equal(
									(
										await store.account({
											accountId: "member",
											organizationId: "org",
										})
									)?.state,
									"ready",
								)
							sent.push(call)
							return Response.json({
								delivery: "started",
								chat: "chat-member",
								item: null,
								turn: "turn-member",
							})
						}
						return core.client.request(call)
					},
				}
				const server = createServer((req, res) => {
					void (async () => {
						const chunks: Buffer[] = []
						for await (const chunk of req) chunks.push(Buffer.from(chunk))
						await handleProductRequest({
							req,
							res,
							url: new URL(req.url!, "http://localhost"),
							payload: JSON.parse(Buffer.concat(chunks).toString()),
							client,
							identity: {
								userId: "member",
								organizationId: "org",
								displayName: "Member",
							},
							requestId: "automatic-test",
							db,
							basicCompute: config,
						})
					})().catch(() => res.writeHead(500).end())
				})
				server.listen(0, "127.0.0.1")
				await once(server, "listening")
				const address = server.address()
				assert.ok(address !== null && typeof address !== "string")
				const send = (path: string) =>
					fetch(
						`http://127.0.0.1:${address.port}/api/kay/v1/${path}/messages`,
						{
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({
								input: "Create a presentation",
								commandKey: "message-" + sent.length,
							}),
						},
					)
				try {
					assert.equal((await send("chats/forbidden")).status, 403)
					assert.equal(core.computers.size, 0)
					for (const path of ["bots/bot-member", "chats/chat-member"]) {
						const response = await send(path)
						assert.equal(response.status, 202, await response.text())
						assert.equal(
							(
								await store.account({
									accountId: "member",
									organizationId: "org",
								})
							)?.state,
							"ready",
						)
					}
					assert.equal(
						core.calls.filter((call) => call.id === "computers.createComputer")
							.length,
						1,
					)
					assert.equal(sent.length, 2)
					assert.equal(await store.lease(), null)
					await pool.query(
						"UPDATE kay_basic_compute_accounts SET state='needs_repair',token_ciphertext=NULL",
					)
					const failed = await send("bots/bot-member")
					assert.equal(failed.status, 202)
					assert.equal(sent.length, 3)
					await pool.query("DELETE FROM kay_subscriptions")
					assert.equal((await send("bots/bot-member")).status, 202)
					assert.equal(sent.length, 4)
				} finally {
					server.closeAllConnections()
					brokerServer.closeAllConnections()
					await Promise.all(
						[server, brokerServer].map(
							(item) =>
								new Promise<void>((resolve, reject) =>
									item.close((error) =>
										error === undefined ? resolve() : reject(error),
									),
								),
						),
					)
				}
			},
		)
		await t.test(
			"a lost create response is read back, fenced from generic management, and never creates a second computer",
			async () => {
				await reset()
				await subscribe("member")
				const core = native(),
					service = api(core.client)
				core.loseCreate()
				assert.equal(
					(await service.run("provision", { requestId: "create" })).phase,
					"creating",
				)
				assert.equal(
					await store.pendingCreation({
						accountId: "member",
						organizationId: "org",
					}),
					true,
				)
				assert.equal(
					await store.pendingCreation({
						accountId: "another",
						organizationId: "org",
					}),
					false,
				)
				const recovered = await service.getOperation("create")
				assert.equal(recovered?.phase, "granting")
				assert.equal(await store.isManaged(recovered!.computerId!), true)
				const ready = await service.run("provision", { requestId: "create" })
				assert.equal(ready.phase, "ready")
				assert.equal(
					core.calls.filter((call) => call.id === "computers.createComputer")
						.length,
					1,
				)
				const account = await store.account({
					accountId: "member",
					organizationId: "org",
				})
				assert.ok(account?.token_ciphertext)
				assert.equal(
					openComputeToken({
						key,
						binding: {
							accountId: "member",
							organizationId: "org",
							computerId: account.computer_id!,
							generation: account.generation,
						},
						ciphertext: account.token_ciphertext,
					}),
					core.computers.get(account.computer_id!)?.token,
				)
				assert.equal(
					await api(core.client, "another").getOperation("create"),
					null,
				)
				assert.equal(
					await api(core.client, "member", "other-org").getOperation("create"),
					null,
				)
				assert.equal(
					basicComputeManagedPath({
						method: "PUT",
						path: `/v1/computers/${ready.computerId}/connector-token`,
					}),
					ready.computerId,
				)
				assert.equal(
					basicComputeManagedPath({
						method: "POST",
						path: `/v1/computers/${ready.computerId}/sessions`,
					}),
					null,
				)
			},
		)
		await t.test(
			"pending setup blocks only management temporarily and never ordinary computer execution",
			async () => {
				await reset()
				await subscribe("member")
				const core = native(),
					service = api(core.client),
					forwarded: string[] = []
				core.loseCreate()
				await service.run("provision", { requestId: "pending" })
				const server = createServer((req, res) => {
					void (async () => {
						const chunks: Buffer[] = []
						for await (const chunk of req) chunks.push(Buffer.from(chunk))
						await handleProductRequest({
							req,
							res,
							url: new URL(req.url!, "http://fixture"),
							payload: JSON.parse(Buffer.concat(chunks).toString()),
							identity: {
								userId: "member",
								organizationId: "org",
								displayName: "Member",
							},
							requestId: "fixture",
							db,
							client: {
								request: async (call) => {
									if (call.operation === "featureDefinition")
										return Response.json({
											id: call.id,
											group: "computers",
											title: "Computer",
											description: "",
											method: call.id === "computers.exec" ? "POST" : "PUT",
											params: null,
											query: null,
											payload: null,
											response: null,
											transport: "json",
										})
									if (call.operation === "access")
										return Response.json({ adminConsole: false })
									forwarded.push(call.id!)
									return Response.json({})
								},
							},
						})
					})().catch(() => {
						res.writeHead(500)
						res.end()
					})
				})
				server.listen(0, "127.0.0.1")
				await once(server, "listening")
				const address = server.address()
				assert.ok(address !== null && typeof address !== "string")
				const post = (id: string, computerId = "ordinary") =>
					fetch(`http://127.0.0.1:${address.port}/api/kay/v1/features/${id}`, {
						method: id === "computers.exec" ? "POST" : "PUT",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							params: {
								computerId,
								...(id === "computers.grantComputer" ? { botId: "bot" } : {}),
							},
							payload: {},
						}),
					})
				try {
					const blocked = await post("computers.grantComputer")
					assert.equal(blocked.status, 409)
					assert.match((await blocked.json()).message, /Finish or restore/)
					assert.equal((await post("computers.exec")).status, 200)
					const known = await service.getOperation("pending")
					assert.equal(
						await store.pendingCreation({
							accountId: "member",
							organizationId: "org",
						}),
						false,
					)
					assert.equal((await post("computers.grantComputer")).status, 200)
					assert.equal(
						(await post("computers.grantComputer", known!.computerId!)).status,
						403,
					)
					assert.deepEqual(forwarded, [
						"computers.exec",
						"computers.grantComputer",
					])
				} finally {
					server.closeAllConnections()
					await new Promise<void>((resolve) => server.close(() => resolve()))
				}
			},
		)
		await t.test(
			"expired members cannot provision and release before setup does not block later provisioning",
			async () => {
				await reset()
				const core = native(),
					service = api(core.client)
				await assert.rejects(service.run("provision", { requestId: "blocked" }))
				assert.equal(core.calls.length, 0)
				assert.equal(
					(await service.run("release", { requestId: "release" })).phase,
					"ready",
				)
				await subscribe("member")
				assert.equal(
					(await service.run("provision", { requestId: "setup" })).phase,
					"ready",
				)
			},
		)
		await t.test(
			"an uncertain token cannot be blindly rotated; explicit repair deletes the old identity before replacement",
			async () => {
				await reset()
				await subscribe("member")
				const core = native(),
					service = api(core.client)
				core.loseToken()
				const first = await service.run("provision", { requestId: "setup" })
				assert.equal(first.phase, "needs_repair")
				assert.equal(
					(await service.run("provision", { requestId: "setup" })).phase,
					"needs_repair",
				)
				assert.equal(
					core.calls.filter((call) => call.id === "computers.setConnectorToken")
						.length,
					1,
				)
				const repaired = await service.run("repair", { requestId: "repair" })
				assert.equal(repaired.phase, "ready")
				assert.notEqual(repaired.computerId, first.computerId)
				assert.equal(core.computers.has(first.computerId!), false)
				const deletion = core.calls.findIndex(
					(call) => call.id === "computers.deleteComputer",
				)
				const creation = core.calls.findLastIndex(
					(call) => call.id === "computers.createComputer",
				)
				assert.ok(deletion > 0 && creation > deletion)
			},
		)
		await t.test(
			"a late token response cannot overwrite an explicitly repaired connection",
			async () => {
				await reset()
				await subscribe("member")
				const core = native(),
					service = api(core.client),
					waiting = core.delayToken()
				const original = service.run("provision", { requestId: "old" })
				await until(() =>
					core.calls.some((call) => call.id === "computers.setConnectorToken"),
				)
				const repaired = await service.run("repair", { requestId: "new" })
				assert.equal(repaired.phase, "ready")
				const saved = await store.account({
					accountId: "member",
					organizationId: "org",
				})
				waiting.resolve(Response.json({ token: "late-old-token" }))
				assert.equal((await original).phase, "issuing_token")
				assert.equal((await service.getOperation("old"))?.phase, "failed")
				assert.deepEqual(
					await store.account({ accountId: "member", organizationId: "org" }),
					saved,
				)
			},
		)
		await t.test(
			"GET reconciliation cannot rewind a ready operation after losing a CAS",
			async () => {
				await reset()
				await subscribe("member")
				const core = native(),
					service = api(core.client)
				core.loseCreate()
				await service.run("provision", { requestId: "setup" })
				const stale = (await store.operation({
					accountId: "member",
					organizationId: "org",
					requestId: "setup",
				}))!
				await service.run("provision", { requestId: "setup" })
				const current = await store.updateOperation({
					operation: stale,
					phase: "granting",
				})
				assert.equal(current.phase, "ready")
				assert.equal((await service.getOperation("setup"))?.phase, "ready")
			},
		)
		await t.test(
			"a saved pre-token owner without a live session resumes and fences its old writer",
			async () => {
				await reset()
				await subscribe("member")
				const core = native(),
					service = api(core.client),
					owner = { accountId: "member", organizationId: "org" }
				core.loseCreate()
				await service.run("provision", { requestId: "resume" })
				// A stopped process left this row, but no session holds its advisory lock.
				await store.acquireOperation({
					...owner,
					requestId: "resume",
					lockId: "old-process",
					repair: false,
				})
				assert.equal(
					await store.acquireOperation({
						...owner,
						requestId: "unrelated",
						lockId: "new-process",
						repair: false,
					}),
					false,
				)
				const resumed = await service.run("provision", { requestId: "resume" })
				assert.equal(resumed.phase, "ready")
				assert.equal(
					await store.holdsOperation({ ...owner, lockId: "old-process" }),
					false,
				)
				assert.equal(
					await store.beginToken({
						...owner,
						requestId: "resume",
						computerId: resumed.computerId!,
						lockId: "old-process",
					}),
					null,
				)
				const current = (await store.operation({
					...owner,
					requestId: "resume",
				}))!
				assert.equal(
					(
						await store.updateOperation({
							operation: current,
							lockId: "old-process",
							phase: "needs_repair",
						})
					).phase,
					"ready",
				)
				assert.equal(
					core.calls.filter((call) => call.id === "computers.setConnectorToken")
						.length,
					1,
				)
			},
		)
		await t.test(
			"a live setup keeps ownership until its first creation request settles",
			async () => {
				await reset()
				await subscribe("member")
				const core = native()
				const first = api(core.client),
					second = api(core.client)
				const gate = core.delayCreate()
				const running = first.run("provision", { requestId: "live-setup" })
				try {
					await until(() =>
						core.calls.some((call) => call.id === "computers.createComputer"),
					)
					const before = (
						await pool.query(
							"SELECT operation_lock_owner FROM kay_basic_compute_accounts",
						)
					).rows[0].operation_lock_owner
					await assert.rejects(
						second.run("provision", { requestId: "live-setup" }),
						(error) =>
							error instanceof BasicComputeFailure &&
							error.code === "basic_compute_busy",
					)
					assert.equal(
						(
							await pool.query(
								"SELECT operation_lock_owner FROM kay_basic_compute_accounts",
							)
						).rows[0].operation_lock_owner,
						before,
					)
					assert.equal(core.computers.size, 0)
					assert.equal(
						core.calls.filter((call) => call.id === "computers.createComputer")
							.length,
						1,
					)
					gate.resolve()
					assert.equal((await running).phase, "ready")
					assert.equal(
						(await second.run("provision", { requestId: "live-setup" })).phase,
						"ready",
					)
					assert.equal(
						core.calls.filter((call) => call.id === "computers.createComputer")
							.length,
						1,
					)
					assert.equal(
						core.calls.filter(
							(call) => call.id === "computers.setConnectorToken",
						).length,
						1,
					)
				} finally {
					gate.resolve()
					await running.catch(() => {})
				}
			},
		)
		await t.test(
			"a scoped setup lock closes after failure and preserves the original error",
			async () => {
				const owner = {
					accountId: "member",
					organizationId: "org",
					requestId: "failure",
				}
				const error = BasicComputeFailure.make({
					status: 403,
					code: "forbidden",
					message: "Fixture access denied.",
				})
				await assert.rejects(
					store.withOperationLock(owner, async () => {
						throw error
					}),
					(cause) => cause === error,
				)
				assert.deepEqual(
					await makeComputeStore(db).withOperationLock(
						owner,
						async () => "recovered",
					),
					{ acquired: true, value: "recovered" },
				)
			},
		)
		await t.test(
			"a stalled unlock closes its session and preserves the callback error",
			{ timeout: 15_000 },
			async () => {
				await pool.query("CREATE SCHEMA setup_unlock_timeout")
				await pool.query(
					"CREATE FUNCTION setup_unlock_timeout.pg_advisory_unlock(bigint) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_catalog.pg_sleep(30); RETURN pg_catalog.pg_advisory_unlock($1); END $$",
				)
				const delayedDb = ManagedRuntime.make(
					PgClient.layer({
						url: Redacted.make(postgres.url),
						startupParameters: {
							search_path: "setup_unlock_timeout,pg_catalog",
						},
					}).pipe(Layer.orDie),
				)
				const owner = {
					accountId: "member",
					organizationId: "org",
					requestId: "unlock-timeout",
				}
				const error = BasicComputeFailure.make({
					status: 403,
					code: "forbidden",
					message: "Fixture access denied.",
				})
				try {
					const running = makeComputeStore(delayedDb)
						.withOperationLock(owner, async () => {
							throw error
						})
						.catch((cause: unknown) => cause)
					await until(
						async () =>
							(
								await pool.query(
									"SELECT 1 FROM pg_stat_activity WHERE application_name='kay-basic-compute-setup' AND query LIKE 'SELECT pg_advisory_unlock%' AND wait_event='PgSleep'",
								)
							).rowCount === 1,
					)
					assert.equal(await running, error)
					await until(
						async () =>
							(
								await pool.query(
									"SELECT 1 FROM pg_stat_activity WHERE application_name='kay-basic-compute-setup' AND datname=current_database()",
								)
							).rowCount === 0,
					)
					assert.deepEqual(
						await makeComputeStore(db).withOperationLock(
							owner,
							async () => "recovered",
						),
						{ acquired: true, value: "recovered" },
					)
				} finally {
					await delayedDb.dispose()
					await pool.query("DROP SCHEMA setup_unlock_timeout CASCADE")
				}
			},
		)
		await t.test(
			"a lost lock connection permits readback without resending the in-flight creation",
			async () => {
				await reset()
				await subscribe("member")
				const core = native()
				const gate = core.delayCreate()
				const running = api(core.client)
					.run("provision", { requestId: "disconnected" })
					.catch((error: unknown) => error)
				try {
					await until(() =>
						core.calls.some((call) => call.id === "computers.createComputer"),
					)
					const sessions = await pool.query(
						"SELECT pid FROM pg_stat_activity WHERE application_name='kay-basic-compute-setup' AND datname=current_database()",
					)
					assert.equal(sessions.rows.length, 1)
					await pool.query("SELECT pg_terminate_backend($1)", [
						sessions.rows[0].pid,
					])
					await until(
						async () =>
							(
								await pool.query(
									"SELECT 1 FROM pg_stat_activity WHERE pid=$1",
									[sessions.rows[0].pid],
								)
							).rowCount === 0,
					)
					const other = makeComputeStore(db)
					assert.deepEqual(
						await other.withOperationLock(
							{
								accountId: "other",
								organizationId: "org",
								requestId: "disconnected",
							},
							async () => "separate owner",
						),
						{ acquired: true, value: "separate owner" },
					)
					const current = await api(core.client).run("provision", {
						requestId: "disconnected",
					})
					assert.equal(current.phase, "creating")
					assert.equal(
						core.calls.filter((call) => call.id === "computers.createComputer")
							.length,
						1,
					)
					assert.equal(core.computers.size, 0)
					gate.resolve()
					const stale = await running
					assert.ok(stale instanceof BasicComputeFailure)
					assert.equal(stale.status, 409)
					assert.equal(
						(
							await api(core.client).run("provision", {
								requestId: "disconnected",
							})
						).phase,
						"ready",
					)
					assert.equal(
						core.calls.filter((call) => call.id === "computers.createComputer")
							.length,
						1,
					)
					assert.equal(
						core.calls.filter(
							(call) => call.id === "computers.setConnectorToken",
						).length,
						1,
					)
				} finally {
					gate.resolve()
					await running
				}
			},
		)
		await t.test(
			"an unconfirmed creation is only read until its receipt becomes visible",
			async () => {
				await reset()
				await subscribe("member")
				const core = native()
				core.loseCreateBeforeReceipt()
				assert.equal(
					(
						await api(core.client).run("provision", {
							requestId: "unconfirmed",
						})
					).phase,
					"creating",
				)
				const next = api(core.client)
				assert.equal(
					(await next.run("provision", { requestId: "unconfirmed" })).phase,
					"creating",
				)
				assert.equal(
					(await next.getOperation("unconfirmed"))?.phase,
					"creating",
				)
				assert.equal(
					core.calls.filter((call) => call.id === "computers.createComputer")
						.length,
					1,
				)
				core.confirmCreate()
				assert.equal(
					(await next.run("provision", { requestId: "unconfirmed" })).phase,
					"ready",
				)
				assert.equal(
					core.calls.filter((call) => call.id === "computers.createComputer")
						.length,
					1,
				)
			},
		)
		await t.test(
			"sending requires a successful owner and revision compare-and-set",
			async () => {
				await reset()
				const owner = {
					accountId: "member",
					organizationId: "org",
					requestId: "cas",
				}
				const claimed = await store.claim({
					...owner,
					action: "provision",
					commandKey: "cas-command",
				})
				await store.acquireOperation({
					...owner,
					lockId: "owner",
					repair: false,
				})
				const step = {
					operation: claimed.operation,
					kind: "create" as const,
					message: "Waiting for the receipt.",
				}
				assert.equal(
					await store.claimSend({ ...step, lockId: "stale-owner" }),
					null,
				)
				const winner = await store.claimSend({ ...step, lockId: "owner" })
				assert.ok(winner?.create_sent)
				assert.equal(await store.claimSend({ ...step, lockId: "owner" }), null)
				assert.equal(
					await store.claimSend({
						...step,
						operation: winner,
						lockId: "owner",
					}),
					null,
				)
			},
		)
		await t.test(
			"unknown grants are read back and known refusals finish the setup attempt",
			async () => {
				await reset()
				await subscribe("member")
				const core = native()
				core.setGrantResponse(503)
				assert.equal(
					(
						await api(core.client).run("provision", {
							requestId: "unknown-grant",
						})
					).phase,
					"granting",
				)
				assert.equal(
					(
						await api(core.client).run("provision", {
							requestId: "unknown-grant",
						})
					).phase,
					"granting",
				)
				assert.equal(
					core.calls.filter((call) => call.id === "computers.grantComputer")
						.length,
					1,
				)
				core.confirmGrant()
				assert.equal(
					(
						await api(core.client).run("provision", {
							requestId: "unknown-grant",
						})
					).phase,
					"ready",
				)
				for (const status of [400, 401, 403, 404, 422]) {
					await reset()
					await subscribe("member")
					const refused = native()
					refused.setGrantResponse(status)
					assert.equal(
						(
							await api(refused.client).run("provision", {
								requestId: "refused-grant",
							})
						).phase,
						"failed",
					)
					assert.equal(
						(
							await api(refused.client).run("provision", {
								requestId: "refused-grant",
							})
						).phase,
						"failed",
					)
					assert.equal(
						refused.calls.filter(
							(call) => call.id === "computers.grantComputer",
						).length,
						1,
					)
					assert.equal(
						refused.calls.filter(
							(call) => call.id === "computers.setConnectorToken",
						).length,
						0,
					)
				}
			},
		)

		for (const scenario of ["confirmed", "uncertain", "bad_key"] as const)
			await t.test(
				`explicit recovery only cleans saved leases: ${scenario}`,
				async () => {
					await reset()
					await subscribe("member")
					const account = await api(native().client).run("provision", {
						requestId: "setup",
					})
					const row = {
						lease_id: "recovery-lease",
						account_id: "member",
						organization_id: "org",
						computer_id: account.computerId!,
						generation: 1,
						connection_nonce: "previous-process",
						container_name: "kay-basic-recovery",
						creation_confirmed: false,
						expires_at: Date.now() + 60000,
						activity: "unknown" as const,
						activity_at: null,
						idle_since: null,
						state: "starting" as const,
					}
					assert.equal(await store.claimLease(row), true)
					if (scenario !== "uncertain")
						await store.confirmCreation(row.lease_id)
					await store.claimCall({
						accountId: row.account_id,
						organizationId: row.organization_id,
						computerId: row.computer_id,
						generation: row.generation,
						operationId: "old-command",
						kind: "command",
						leaseId: row.lease_id,
					})
					const calls: string[] = []
					const removal = deferred<void>()
					const fail = () => {
						throw new Error("Recovery must not run new work.")
					}
					const driver: ReturnType<typeof makeBasicComputeDocker> = {
						health: async () => {
							calls.push("health")
							fail()
						},
						createLease: async () => {
							calls.push("create")
							return fail()
						},
						files: async () => {
							calls.push("files")
							return fail()
						},
						start: () => {
							calls.push("start")
							return fail()
						},
						terminateLease: async (ref) => {
							calls.push("terminate")
							assert.deepEqual(ref, {
								leaseId: row.lease_id,
								containerName: row.container_name,
								creationUncertain: scenario === "uncertain",
							})
							if (scenario === "uncertain")
								throw new DockerFailure(
									"cleanup_failed",
									"Creation outcome remains unknown.",
								)
							await removal.promise
						},
					}
					const recover = () =>
						recoverBasicComputeBroker({
							db,
							origin: "http://native.invalid",
							keyFile,
							driver,
							connect: () => {
								calls.push("connect")
								return fail()
							},
						})
					if (scenario === "bad_key") {
						await chmod(keyFile, 0o644)
						try {
							await assert.rejects(recover())
						} finally {
							await chmod(keyFile, 0o600)
						}
						assert.deepEqual(calls, [])
						assert.equal((await store.lease())?.state, "starting")
					} else if (scenario === "uncertain") {
						await assert.rejects(recover(), /Creation outcome remains unknown/)
						assert.equal((await store.lease())?.state, "cleanup_pending")
						assert.equal((await store.lease())?.creation_confirmed, false)
						assert.deepEqual(calls, ["terminate"])
					} else {
						const recovery = recover()
						await until(() => calls.includes("terminate"))
						assert.equal((await store.lease())?.state, "cleanup_pending")
						removal.resolve()
						await recovery
						assert.equal(await store.lease(), null)
						await recover() // A second cleanup cannot replay a command or create a lease.
						assert.deepEqual(calls, ["terminate"])
					}
					assert.equal(
						(
							await pool.query(
								"SELECT status FROM kay_basic_compute_calls WHERE operation_id='old-command'",
							)
						).rows[0].status,
						scenario === "bad_key" ? "started" : "unknown",
					)
				},
			)

		const harness = async (
			now?: () => number,
			activityTimeoutMs?: number,
			cleanupWaitMs = 1000,
		) => {
			await reset()
			await subscribe("member")
			await subscribe("other")
			for (const member of ["member", "other"])
				await api(native(member).client, member).run("provision", {
					requestId: "setup",
				})
			const sockets: Array<{
				input: Parameters<typeof openNativeComputerSocket>[0]
				sent: Array<Record<string, unknown>>
				closed: boolean
			}> = []
			const calls: Array<{ kind: string; id: string }> = []
			let fileWait: ReturnType<typeof deferred<unknown>> | undefined
			let fileFailure: Error | undefined
			let terminateFailure = false
			let terminateWait: ReturnType<typeof deferred<void>> | undefined
			let probeActivity: "working" | "idle" | "unknown" | undefined = "idle"
			const commandWait = deferred<CommandResult>()
			const driver: ReturnType<typeof makeBasicComputeDocker> = {
				health: async () => {},
				createLease: async (ref) => {
					calls.push({ kind: "create", id: ref.leaseId })
					return { ...ref, idlePid: 1 }
				},
				terminateLease: async (ref) => {
					calls.push({ kind: "remove", id: ref.leaseId })
					await terminateWait?.promise
					if (terminateFailure)
						throw new DockerFailure(
							"cleanup_failed",
							"The workspace could not be removed.",
						)
					calls.push({ kind: "removed", id: ref.leaseId })
				},
				files: async (call) => {
					calls.push({ kind: "file", id: call.operationId })
					if (fileFailure !== undefined) throw fileFailure
					if (fileWait !== undefined) return fileWait.promise
					return []
				},
				start: (call) => {
					calls.push({ kind: "start", id: call.operationId })
					return {
						done: commandWait.promise,
						input: () => {},
						signal: () => {},
						close: async () => {
							commandWait.resolve({
								reason: "stopped",
								exitCode: null,
								signal: null,
								outputBytes: 0,
							})
							return commandWait.promise
						},
					}
				},
			}
			const broker = makeBasicComputeBroker({
				db,
				key,
				origin: "http://native.invalid",
				driver,
				...(activityTimeoutMs === undefined ? {} : { activityTimeoutMs }),
				cleanupWaitMs,
				...(now === undefined ? {} : { now }),
				connect: (input) => {
					const socket = {
						input,
						sent: [] as Array<Record<string, unknown>>,
						closed: false,
					}
					sockets.push(socket)
					queueMicrotask(input.onOpen)
					return {
						send: (message) => {
							const frame = object(message)
							socket.sent.push(frame)
							if (
								frame["_tag"] === "Pong" &&
								typeof frame["activityRequestId"] === "string" &&
								probeActivity !== undefined
							)
								queueMicrotask(() =>
									input.onMessage({
										_tag: "Ping",
										activityRequestId: frame["activityRequestId"],
										activity: probeActivity,
									}),
								)
							return !socket.closed
						},
						close: () => {
							socket.closed = true
							input.onClose()
						},
					}
				},
			})
			await broker.start()
			const first = sockets[0]!,
				second = sockets[1]!
			const file = (
				socket: typeof first,
				id: string,
				operation: Schema.JsonObject = { _tag: "List", path: "/workspace" },
			) =>
				socket.input.onMessage({
					_tag: "Call",
					call: { id, operation },
				})
			const startCommand = (
				socket: typeof first,
				session: string,
				tty = false,
			) =>
				socket.input.onMessage({
					_tag: "Start",
					session,
					command: "echo fixture",
					tty,
				})
			const replied = (socket: typeof first, id: string) =>
				socket.sent.some(
					(message) =>
						(message["_tag"] === "Reply" &&
							object(message["reply"])["id"] === id) ||
						(message["_tag"] === "Exit" && message["session"] === id),
				)
			return {
				broker,
				setProbeActivity: (activity: typeof probeActivity) => {
					probeActivity = activity
				},
				first,
				second,
				sockets,
				calls,
				file,
				startCommand,
				replied,
				holdFiles: () => {
					fileWait = deferred<unknown>()
					return fileWait
				},
				failFiles: () => {
					fileFailure = new DockerFailure(
						"lease_lost",
						"The workspace has stopped.",
					)
				},
				failRemove: (value: boolean) => {
					terminateFailure = value
				},
				holdRemove: () => {
					terminateWait = deferred<void>()
					return terminateWait
				},
				commandWait,
			}
		}
		await t.test(
			"file operations wait in order while commands and other members remain isolated",
			async () => {
				const h = await harness(),
					waiting = h.holdFiles()
				try {
					h.file(h.first, "a")
					await until(() => h.calls.some((call) => call.id === "a"))
					h.file(h.first, "b")
					h.startCommand(h.first, "c")
					await until(() => h.replied(h.first, "c"))
					h.file(h.first, "d")
					h.file(h.second, "other")
					await until(() => h.replied(h.second, "other"))
					assert.equal(h.replied(h.first, "b"), false)
					assert.equal(h.replied(h.first, "d"), false)
					assert.deepEqual(
						h.calls
							.filter((call) => call.kind === "file")
							.map((call) => call.id),
						["a"],
					)
					waiting.resolve([])
					await until(
						() =>
							h.replied(h.first, "a") &&
							h.replied(h.first, "b") &&
							h.replied(h.first, "d"),
					)
					assert.deepEqual(
						h.calls
							.filter((call) => call.kind === "file")
							.map((call) => call.id),
						["a", "b", "d"],
					)
					h.file(h.first, "a")
					await new Promise((resolve) => setTimeout(resolve, 30))
					assert.equal(h.calls.filter((call) => call.id === "a").length, 1)
				} finally {
					waiting.resolve([])
					await h.broker.stop()
				}
			},
		)
		await t.test(
			"a file requested alongside the first command waits for that command without replay",
			async () => {
				const h = await harness()
				try {
					h.startCommand(h.first, "research")
					h.file(h.first, "readme", {
						_tag: "Read",
						path: "/workspace/README.md",
						encoding: "utf8",
					})
					await until(() => h.calls.some((call) => call.id === "research"))
					assert.equal(h.replied(h.first, "readme"), false)
					assert.equal(
						h.calls.filter((call) => call.kind === "create").length,
						1,
					)
					h.commandWait.resolve({
						reason: "finished",
						exitCode: 0,
						signal: null,
						outputBytes: 0,
					})
					await until(() => h.replied(h.first, "readme"))
					assert.equal(h.calls.filter((call) => call.id === "readme").length, 1)
					const reply = h.first.sent.find(
						(message) =>
							message["_tag"] === "Reply" &&
							object(message["reply"])["id"] === "readme",
					)!
					assert.equal(object(object(reply["reply"])["result"])["_tag"], "Done")
				} finally {
					h.commandWait.resolve({
						reason: "finished",
						exitCode: 0,
						signal: null,
						outputBytes: 0,
					})
					await h.broker.stop()
				}
			},
		)
		await t.test(
			"queued files recheck membership and never run in a replacement lease",
			async () => {
				for (const reason of ["expired", "released"]) {
					const h = await harness()
					try {
						h.startCommand(h.first, "research")
						await until(() => h.calls.some((call) => call.id === "research"))
						h.file(h.first, "waiting-file")
						await new Promise((resolve) => setTimeout(resolve, 30))
						const saved = (await store.lease())!
						if (reason === "expired")
							await pool.query(
								"UPDATE kay_subscriptions SET expires_at=2 WHERE account_id=$1",
								[saved.account_id],
							)
						else
							await h.broker.release({
								accountId: saved.account_id,
								organizationId: saved.organization_id,
							})
						h.commandWait.resolve({
							reason: "finished",
							exitCode: 0,
							signal: null,
							outputBytes: 0,
						})
						await until(
							() => h.first.closed || h.replied(h.first, "waiting-file"),
						)
						await until(async () => (await store.lease()) === null)
						assert.equal(
							h.calls.some((call) => call.id === "waiting-file"),
							false,
						)
						assert.equal(
							h.calls.filter((call) => call.kind === "create").length,
							1,
						)
					} finally {
						h.commandWait.resolve({
							reason: "finished",
							exitCode: 0,
							signal: null,
							outputBytes: 0,
						})
						await h.broker.stop()
					}
				}
			},
		)
		await t.test(
			"file queue is bounded without unlocking the active command",
			async () => {
				const h = await harness()
				try {
					h.startCommand(h.first, "research")
					await until(() => h.calls.some((call) => call.id === "research"))
					for (let i = 0; i < 9; i++) h.file(h.first, "queued-" + i)
					await until(() => h.replied(h.first, "queued-8"))
					assert.equal(
						h.calls.some((call) => call.kind === "file"),
						false,
					)
					h.commandWait.resolve({
						reason: "finished",
						exitCode: 0,
						signal: null,
						outputBytes: 0,
					})
					await until(() => h.replied(h.first, "queued-7"))
					assert.equal(h.calls.filter((call) => call.kind === "file").length, 8)
				} finally {
					h.commandWait.resolve({
						reason: "finished",
						exitCode: 0,
						signal: null,
						outputBytes: 0,
					})
					await h.broker.stop()
				}
			},
		)
		await t.test(
			"expiry destroys the member lease and rejects subsequent file and interactive calls",
			async () => {
				const h = await harness()
				try {
					h.file(h.first, "before")
					await until(() => h.replied(h.first, "before"))
					const lease = (await store.lease())!
					await pool.query(
						"UPDATE kay_subscriptions SET expires_at=2 WHERE account_id=$1",
						[lease.account_id],
					)
					h.file(h.first, "expired")
					await until(() => h.replied(h.first, "expired"))
					assert.equal(await store.lease(), null)
					assert.equal(h.calls.filter((call) => call.kind === "file").length, 1)
					h.startCommand(h.second, "tty", true)
					await until(() => h.replied(h.second, "tty"))
					assert.equal(
						h.calls.filter((call) => call.kind === "start").length,
						0,
					)
				} finally {
					await h.broker.stop()
				}
			},
		)
		await t.test(
			"a failed driver cleanup fences the global slot until confirmed removal",
			async () => {
				const h = await harness()
				try {
					h.file(h.first, "before")
					await until(() => h.replied(h.first, "before"))
					h.failRemove(true)
					await assert.rejects(
						h.broker.release({
							accountId: (await store.lease())!.account_id,
							organizationId: "org",
						}),
					)
					assert.equal((await store.lease())?.state, "cleanup_pending")
					h.file(h.second, "blocked")
					await until(() => h.replied(h.second, "blocked"))
					assert.equal(
						h.calls.filter((call) => call.kind === "create").length,
						1,
					)
				} finally {
					h.failRemove(false)
					await h.broker.stop()
				}
			},
		)
		await t.test(
			"old socket events cannot change or stop a replacement connection's lease",
			async () => {
				const h = await harness()
				try {
					h.file(h.first, "old")
					await until(() => h.replied(h.first, "old"))
					const previous = (await store.lease())!
					h.first.input.onClose()
					await until(async () => (await store.lease()) === null)
					await h.broker.wake()
					const replacement = h.sockets.at(-1)!
					assert.notEqual(replacement, h.first)
					h.file(replacement, "replacement")
					await until(() => h.replied(replacement, "replacement"))
					const current = (await store.lease())!
					assert.notEqual(current.connection_nonce, previous.connection_nonce)
					h.first.input.onClose()
					h.file(h.first, "late")
					h.first.input.onMessage({ _tag: "Close", session: "replacement" })
					await new Promise((resolve) => setTimeout(resolve, 30))
					assert.equal((await store.lease())?.lease_id, current.lease_id)
					assert.equal(
						h.calls.some((call) => call.id === "late"),
						false,
					)
				} finally {
					await h.broker.stop()
				}
			},
		)
		await t.test(
			"long model work renews the workspace and five idle minutes clear it",
			async () => {
				let clock = Date.now()
				const h = await harness(() => clock)
				const ping = async (activity?: string) => {
					const count = h.first.sent.length
					h.first.input.onMessage({
						_tag: "Ping",
						...(activity === undefined ? {} : { activity }),
					})
					await until(() =>
						h.first.sent
							.slice(count)
							.some((message) => message["_tag"] === "Pong"),
					)
				}
				try {
					await pool.query("UPDATE kay_subscriptions SET expires_at=$1", [
						clock + 3_600_000,
					])
					await ping("working")
					h.file(h.first, "initial-task-file")
					await until(() => h.replied(h.first, "initial-task-file"))
					await until(async () => (await store.lease())?.activity === "working")
					const id = (await store.lease())!.lease_id
					clock += 20 * 60_000
					await ping("working")
					await h.broker.wake()
					assert.equal((await store.lease())?.lease_id, id)
					assert.equal((await store.lease())?.idle_since, null)
					await ping("idle")
					const idle = (await store.lease())!
					assert.equal(idle.idle_since, clock)
					assert.equal(idle.expires_at, clock + 300_000)
					clock += 299_999
					await ping("idle")
					await h.broker.wake()
					assert.equal((await store.lease())?.lease_id, id)
					clock++
					await ping("idle")
					await h.broker.wake()
					assert.equal(await store.lease(), null)
					assert.equal(
						h.calls.filter((call) => call.kind === "remove").length,
						1,
					)
				} finally {
					await h.broker.stop()
				}
			},
		)
		await t.test(
			"unknown and legacy activity stop idle cleanup while membership expiry stays enforced",
			async () => {
				let clock = Date.now()
				const h = await harness(() => clock)
				const ping = async (activity?: string) => {
					const count = h.first.sent.length
					h.first.input.onMessage({
						_tag: "Ping",
						...(activity === undefined ? {} : { activity }),
					})
					await until(() =>
						h.first.sent
							.slice(count)
							.some((message) => message["_tag"] === "Pong"),
					)
				}
				try {
					await pool.query("UPDATE kay_subscriptions SET expires_at=$1", [
						clock + 3_600_000,
					])
					h.file(h.first, "legacy-file")
					await until(() => h.replied(h.first, "legacy-file"))
					await ping("idle")
					assert.notEqual((await store.lease())?.idle_since, null)
					for (const activity of [undefined, "unknown"]) {
						clock += 10 * 60_000
						await ping(activity)
						await h.broker.wake()
						assert.equal((await store.lease())?.activity, "unknown")
						assert.equal((await store.lease())?.idle_since, null)
					}
					await ping("working")
					await pool.query("UPDATE kay_subscriptions SET expires_at=2")
					await h.broker.wake()
					assert.equal(await store.lease(), null)
				} finally {
					await h.broker.stop()
				}
			},
		)
		await t.test(
			"a running command overrides an idle Ping and new work resets the idle deadline",
			async () => {
				let clock = Date.now()
				const h = await harness(() => clock)
				try {
					h.startCommand(h.first, "still-running")
					await until(() => h.calls.some((call) => call.id === "still-running"))
					h.first.input.onMessage({ _tag: "Ping", activity: "idle" })
					await until(() =>
						h.first.sent.some((message) => message["_tag"] === "Pong"),
					)
					assert.equal((await store.lease())?.activity, "working")
					assert.equal((await store.lease())?.idle_since, null)
					h.commandWait.resolve({
						reason: "finished",
						exitCode: 0,
						signal: null,
						outputBytes: 4,
					})
					await until(async () => (await store.lease())?.activity === "idle")
					assert.equal((await store.lease())?.idle_since, clock)
					clock += 30_000
					h.file(h.first, "follow-up")
					await until(() => h.replied(h.first, "follow-up"))
					await until(async () => (await store.lease())?.idle_since === clock)
					assert.equal((await store.lease())?.expires_at, clock + 300_000)
				} finally {
					await h.broker.stop()
				}
			},
		)
		await t.test(
			"new-message wake protects only its owner and stale idle cleanup cannot win",
			async () => {
				let clock = Date.now()
				const h = await harness(() => clock)
				try {
					h.file(h.first, "before-idle")
					await until(() => h.replied(h.first, "before-idle"))
					h.first.input.onMessage({ _tag: "Ping", activity: "idle" })
					await until(async () => (await store.lease())?.activity === "idle")
					const idle = (await store.lease())!
					const other = idle.account_id === "member" ? "other" : "member"
					await h.broker.wake({ accountId: other, organizationId: "org" })
					assert.equal((await store.lease())?.activity, "idle")
					clock += 300_000
					h.first.input.onMessage({ _tag: "Ping", activity: "idle" })
					await until(async () => (await store.lease())?.activity_at === clock)
					await h.broker.wake({
						accountId: idle.account_id,
						organizationId: "org",
					})
					assert.equal((await store.lease())?.activity, "unknown")
					assert.equal((await store.lease())?.idle_since, null)
					assert.equal(
						await store.claimIdleCleanup({
							leaseId: idle.lease_id,
							now: clock,
							activityAt: idle.activity_at,
						}),
						false,
					)
					assert.equal(
						h.calls.filter((call) => call.kind === "remove").length,
						0,
					)
				} finally {
					await h.broker.stop()
				}
			},
		)
		await t.test(
			"an idle Ping during the pre-send wake cannot restore the old cleanup deadline",
			async () => {
				let clock = Date.now()
				const h = await harness(() => clock)
				const lock = await pool.connect()
				try {
					h.file(h.first, "before-interleaved-wake")
					await until(() => h.replied(h.first, "before-interleaved-wake"))
					h.first.input.onMessage({ _tag: "Ping", activity: "idle" })
					await until(async () => (await store.lease())?.activity === "idle")
					const before = (await store.lease())!
					clock += 300_000
					await lock.query("BEGIN")
					await lock.query(
						"SELECT lease_id FROM kay_basic_compute_lease FOR UPDATE",
					)
					const starting = h.broker.wake({
						accountId: before.account_id,
						organizationId: "org",
					})
					await until(
						async () =>
							(
								await pool.query(
									"SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'UPDATE kay_basic_compute_lease SET activity=%'",
								)
							).rows.length > 0,
					)
					h.first.input.onMessage({ _tag: "Ping", activity: "idle" })
					await lock.query("COMMIT")
					await starting
					const after = (await store.lease())!
					assert.equal(after.lease_id, before.lease_id)
					assert.ok(after.idle_since === null || after.idle_since >= clock)
					assert.equal(
						h.calls.filter((call) => call.kind === "remove").length,
						0,
					)
				} finally {
					await lock.query("ROLLBACK")
					lock.release()
					await h.broker.stop()
				}
			},
		)
		await t.test(
			"cleanup reads fresh native work and fails closed when confirmation is unavailable",
			async () => {
				for (const reply of ["working", "unknown", undefined] as const) {
					let clock = Date.now()
					// A short deadline belongs only to the intentionally missing reply.
					const h = await harness(
						() => clock,
						reply === undefined ? 50 : undefined,
					)
					try {
						h.file(h.first, "scheduled-work-file")
						await until(() => h.replied(h.first, "scheduled-work-file"))
						h.first.input.onMessage({ _tag: "Ping", activity: "idle" })
						await until(async () => (await store.lease())?.activity === "idle")
						const original = (await store.lease())!
						clock += 300_000
						h.first.input.onMessage({ _tag: "Ping", activity: "idle" })
						await until(
							async () => (await store.lease())?.activity_at === clock,
						)
						h.setProbeActivity(reply)
						await h.broker.wake()
						assert.equal((await store.lease())?.lease_id, original.lease_id)
						assert.equal(
							(await store.lease())?.activity,
							reply === "working" ? "working" : "unknown",
						)
						assert.equal((await store.lease())?.idle_since, null)
						assert.equal(
							h.calls.filter((call) => call.kind === "remove").length,
							0,
						)
					} finally {
						await h.broker.stop()
					}
				}
			},
		)
		await t.test(
			"a working reply delayed by persistence keeps its workspace on timeout and recovers",
			async () => {
				let clock = Date.now()
				const h = await harness(() => clock, 50)
				const lock = await pool.connect()
				let probing: Promise<void> | undefined
				const ping = async (activity: "idle" | "working") => {
					const before = h.first.sent.length
					h.first.input.onMessage({ _tag: "Ping", activity })
					await until(() =>
						h.first.sent
							.slice(before)
							.some(
								(message) =>
									message["_tag"] === "Pong" &&
									message["activityRequestId"] === undefined,
							),
					)
				}
				try {
					h.file(h.first, "before-slow-confirmation")
					await until(() => h.replied(h.first, "before-slow-confirmation"))
					await ping("idle")
					const original = (await store.lease())!
					clock += 300_000
					await ping("idle")
					await lock.query("BEGIN")
					await lock.query(
						"SELECT account_id FROM kay_basic_compute_accounts WHERE account_id=$1 AND organization_id=$2 FOR UPDATE",
						[original.account_id, original.organization_id],
					)
					h.setProbeActivity("working")
					probing = h.broker.wake()
					await until(() =>
						h.first.sent.some(
							(message) => typeof message["activityRequestId"] === "string",
						),
					)
					await until(
						async () =>
							(
								await pool.query(
									"SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'UPDATE kay_basic_compute_accounts SET state=%'",
								)
							).rowCount !== 0,
					)
					await probing
					const unconfirmed = (await store.lease())!
					assert.equal(unconfirmed.lease_id, original.lease_id)
					assert.equal(unconfirmed.activity, "unknown")
					assert.equal(unconfirmed.idle_since, null)
					assert.equal(
						h.calls.filter((call) => call.kind === "remove").length,
						0,
					)
					const beforeRelease = h.first.sent.length
					await lock.query("COMMIT")
					await until(() =>
						h.first.sent
							.slice(beforeRelease)
							.some(
								(message) =>
									message["_tag"] === "Pong" &&
									message["activityRequestId"] === undefined,
							),
					)
					await ping("working")
					const recovered = (await store.lease())!
					assert.equal(recovered.lease_id, original.lease_id)
					assert.equal(recovered.activity, "working")
					assert.equal(recovered.idle_since, null)
					assert.equal(
						h.calls.filter((call) => call.kind === "remove").length,
						0,
					)
				} finally {
					await lock.query("ROLLBACK")
					lock.release()
					await probing?.catch(() => {})
					await h.broker.stop()
				}
			},
		)
		await t.test(
			"a fresh working reply cannot become idle when another Ping arrives during persistence",
			async () => {
				let clock = Date.now()
				const h = await harness(() => clock)
				const lock = await pool.connect()
				try {
					h.file(h.first, "before-probe")
					await until(() => h.replied(h.first, "before-probe"))
					h.first.input.onMessage({ _tag: "Ping", activity: "idle" })
					await until(async () => (await store.lease())?.activity === "idle")
					const original = (await store.lease())!
					clock += 300_000
					h.first.input.onMessage({ _tag: "Ping", activity: "idle" })
					await until(async () => (await store.lease())?.activity_at === clock)
					h.setProbeActivity(undefined)
					const probing = h.broker.wake()
					await until(() =>
						h.first.sent.some(
							(message) => typeof message["activityRequestId"] === "string",
						),
					)
					const probe = h.first.sent.find(
						(message) => typeof message["activityRequestId"] === "string",
					)!
					await lock.query("BEGIN")
					await lock.query(
						"SELECT lease_id FROM kay_basic_compute_lease FOR UPDATE",
					)
					h.first.input.onMessage({
						_tag: "Ping",
						activityRequestId: probe["activityRequestId"],
						activity: "working",
					})
					await until(
						async () =>
							(
								await pool.query(
									"SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'UPDATE kay_basic_compute_lease SET activity=%'",
								)
							).rows.length > 0,
					)
					h.first.input.onMessage({ _tag: "Ping", activity: "idle" })
					await lock.query("COMMIT")
					await probing
					await until(async () => (await store.lease())?.activity === "idle")
					assert.equal((await store.lease())?.lease_id, original.lease_id)
					assert.equal((await store.lease())?.idle_since, clock)
					assert.equal(
						h.calls.filter((call) => call.kind === "remove").length,
						0,
					)
				} finally {
					await lock.query("ROLLBACK")
					lock.release()
					await h.broker.stop()
				}
			},
		)
		await t.test(
			"native work arriving at the old idle deadline renews before using its files",
			async () => {
				let clock = Date.now()
				const h = await harness(() => clock)
				try {
					h.file(h.first, "previous-artifact")
					await until(() => h.replied(h.first, "previous-artifact"))
					h.first.input.onMessage({ _tag: "Ping", activity: "idle" })
					await until(async () => (await store.lease())?.activity === "idle")
					const original = (await store.lease())!
					clock += 300_000
					h.file(h.first, "scheduled-follow-up")
					await until(() => h.replied(h.first, "scheduled-follow-up"))
					assert.equal((await store.lease())?.lease_id, original.lease_id)
					assert.equal(
						h.calls.filter((call) => call.id === "scheduled-follow-up").length,
						1,
					)
					assert.equal(
						h.calls.filter((call) => call.kind === "remove").length,
						0,
					)
				} finally {
					await h.broker.stop()
				}
			},
		)
		await t.test(
			"a driver-destroyed lease clears its slot without retrying the failed operation",
			async () => {
				const h = await harness()
				try {
					h.failFiles()
					h.file(h.first, "lost")
					await until(() => h.replied(h.first, "lost"))
					assert.equal(await store.lease(), null)
					assert.equal(
						(
							await pool.query(
								"SELECT status FROM kay_basic_compute_calls WHERE operation_id='lost'",
							)
						).rows[0].status,
						"unknown",
					)
					h.file(h.first, "lost")
					await new Promise((resolve) => setTimeout(resolve, 30))
					assert.equal(h.calls.filter((call) => call.id === "lost").length, 1)
				} finally {
					await h.broker.stop()
				}
			},
		)
		for (const operation of ["command", "file"] as const)
			for (const outcome of ["completed", "failed"] as const)
				await t.test(
					`${operation} admission waits for its owner's cleanup: ${outcome}`,
					async () => {
						let clock = Date.now()
						const h = await harness(() => clock)
						const removal = h.holdRemove()
						try {
							h.file(h.first, "old-file")
							await until(() => h.replied(h.first, "old-file"))
							h.first.input.onMessage({ _tag: "Ping", activity: "idle" })
							await until(
								async () => (await store.lease())?.activity === "idle",
							)
							const original = (await store.lease())!
							clock += 300_000
							h.first.input.onMessage({ _tag: "Ping", activity: "idle" })
							await until(
								async () => (await store.lease())?.activity_at === clock,
							)
							const cleanup = h.broker.wake().catch((error: unknown) => error)
							await until(() => h.calls.some((call) => call.kind === "remove"))
							if (operation === "command")
								h.startCommand(h.first, "next-operation")
							else h.file(h.first, "next-operation")
							h.file(h.second, "other-during-cleanup")
							await until(() => h.replied(h.second, "other-during-cleanup"))
							assert.equal(h.replied(h.first, "next-operation"), false)
							assert.equal(
								h.calls.some((call) => call.id === "next-operation"),
								false,
							)
							assert.equal(
								h.calls.some((call) => call.id === "other-during-cleanup"),
								false,
							)
							assert.equal(
								(
									await pool.query(
										"SELECT 1 FROM kay_basic_compute_calls WHERE operation_id='next-operation'",
									)
								).rowCount,
								0,
							)
							h.failRemove(outcome === "failed")
							removal.resolve()
							const result = await cleanup
							if (outcome === "failed") {
								assert.ok(result instanceof DockerFailure)
								await until(() => h.replied(h.first, "next-operation"))
								assert.equal(
									h.calls.some((call) => call.id === "next-operation"),
									false,
								)
								assert.equal((await store.lease())?.state, "cleanup_pending")
								assert.equal(
									h.calls.filter((call) => call.kind === "create").length,
									1,
								)
							} else {
								assert.equal(result, undefined)
								await until(() =>
									h.calls.some((call) => call.id === "next-operation"),
								)
								const replacement = (await store.lease())!
								assert.notEqual(replacement.lease_id, original.lease_id)
								assert.equal(replacement.account_id, original.account_id)
								assert.equal(
									h.calls.filter((call) => call.id === "next-operation").length,
									1,
								)
								assert.ok(
									h.calls.findIndex((call) => call.kind === "removed") <
										h.calls.findIndex((call) => call.id === "next-operation"),
								)
								h.commandWait.resolve({
									reason: "finished",
									exitCode: 0,
									signal: null,
									outputBytes: 0,
								})
								await until(() => h.replied(h.first, "next-operation"))
							}
						} finally {
							removal.resolve()
							h.failRemove(false)
							await h.broker.stop()
						}
					},
				)
		await t.test(
			"cleanup admission has a deadline and does not dispatch late work",
			async () => {
				let clock = Date.now()
				const h = await harness(() => clock, undefined, 10)
				const removal = h.holdRemove()
				try {
					h.file(h.first, "old-file")
					await until(() => h.replied(h.first, "old-file"))
					h.first.input.onMessage({ _tag: "Ping", activity: "idle" })
					await until(async () => (await store.lease())?.activity === "idle")
					clock += 300_000
					h.first.input.onMessage({ _tag: "Ping", activity: "idle" })
					await until(async () => (await store.lease())?.activity_at === clock)
					const cleanup = h.broker.wake()
					await until(() => h.calls.some((call) => call.kind === "remove"))
					h.file(h.first, "timed-out")
					await until(() => h.replied(h.first, "timed-out"))
					assert.equal(
						h.calls.some((call) => call.id === "timed-out"),
						false,
					)
					removal.resolve()
					await cleanup
					assert.equal(await store.lease(), null)
					assert.equal(
						h.calls.filter((call) => call.kind === "create").length,
						1,
					)
					assert.equal(
						h.calls.some((call) => call.id === "timed-out"),
						false,
					)
				} finally {
					removal.resolve()
					await h.broker.stop()
				}
			},
		)
	},
)
