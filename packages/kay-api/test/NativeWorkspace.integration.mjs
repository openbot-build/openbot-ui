// Run explicitly with OPENBOT_NATIVE_SOURCE_DIR pointing to the built SDK-compatible core.
// Real PostgreSQL, signed OIDC and native services; model, MCP and S3 are local fixtures.
import assert from "node:assert/strict"
import { test } from "node:test"
import { once } from "node:events"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { resolve, join } from "node:path"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"
import { randomUUID, randomBytes } from "node:crypto"
import { Pool } from "pg"
import { createNativeClient } from "@kaicom/kay-openbot"
import { events as chatEvents } from "@kaicom/kay-contracts/Client"
import { createGateway } from "../src/Gateway.ts"
import { fromEnvironment } from "../src/Configuration.ts"
import { runtime } from "../src/Database.ts"
import { startBasicComputeBroker } from "../src/BasicComputeBroker.ts"
import { checkReadiness } from "../src/Readiness.ts"
import { start as startDatabase } from "./PostgresTest.ts"
import { filesPageInput } from "../../../src/next/features/FilesQuery.ts"

const source = process.env.OPENBOT_NATIVE_SOURCE_DIR
if (!source)
	throw new Error(
		"Set OPENBOT_NATIVE_SOURCE_DIR to the built native OpenBot checkout.",
	)
const native = (path) => import(pathToFileURL(resolve(source, path)).href)
const listen = async (server) => {
	server.listen(0, "127.0.0.1")
	await once(server, "listening")
	return `http://127.0.0.1:${server.address().port}`
}
const close = async (server) => {
	server.closeAllConnections()
	await new Promise((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	)
}
const until = async (label, check, timeout = 15000) => {
	const deadline = Date.now() + timeout
	while (Date.now() < deadline) {
		const result = await check()
		if (result) return result
		await new Promise((resolve) => setTimeout(resolve, 50))
	}
	throw new Error(`Timed out waiting for ${label}`)
}

test(
	"fresh Kay workspace completes native chat, approval, files, MCP and automation workflows",
	{ timeout: 180000 },
	async (t) => {
		const cleanup = []
		t.after(async () => {
			const errors = []
			for (const finish of cleanup.reverse()) {
				try {
					await finish()
				} catch (error) {
					errors.push(error)
				}
			}
			if (errors.length)
				throw new AggregateError(
					errors,
					"Native workspace fixture cleanup failed",
				)
		})
		const BrowserHost = await native("packages/openbot/test/BrowserHost.ts")
		const AppFixture = await native("packages/openbot/test/AppFixture.ts")
		const { AppNetwork } = await native("packages/openbot/src/apps/AppHost.ts")
		const NodeHttpServer = await native(
			"packages/protocol/src/node/NodeHttpServer.ts",
		)
		const { Effect, Exit, Layer, ManagedRuntime, Option, Scope, Stream } =
			await native("packages/openbot/node_modules/effect/dist/index.js")
		const LanguageModel = await native(
			"packages/openbot/node_modules/effect/dist/ai/LanguageModel.js",
		)
		const ModelResponse = await native(
			"packages/openbot/node_modules/effect/dist/ai/Response.js",
		)
		const Caller = await native("packages/openbot/test/Caller.ts")
		const managed = ManagedRuntime.make(BrowserHost.layerPlatform)
		cleanup.push(() => managed.dispose())
		const scope = await managed.runPromise(Scope.make())
		cleanup.push(() => managed.runPromise(Scope.close(scope, Exit.void)))
		const run = (effect) =>
			managed.runPromise(Effect.provideService(effect, Scope.Scope, scope))
		const publisher = await run(AppFixture.start({ capabilities: true }))
		const objects = new Map()
		const storageOrigin = "http://s3.native-fixture.test"
		// Match the upstream Files fixture: the real storage adapter signs every request.
		const storage = (request) =>
			Effect.promise(async () => {
				const url = new URL(request.url)
				assert.equal(url.origin, storageOrigin)
				assert.ok(
					request.headers.has("authorization") ||
						url.searchParams.has("X-Amz-Signature"),
				)
				if (request.method === "PUT") {
					objects.set(url.pathname, {
						bytes: await request.arrayBuffer(),
						type: request.headers.get("content-type"),
					})
					return new Response(null)
				}
				if (request.method === "DELETE") {
					objects.delete(url.pathname)
					return new Response(null, { status: 204 })
				}
				const item = objects.get(url.pathname)
				return item
					? new Response(request.method === "HEAD" ? null : item.bytes, {
							headers: {
								"content-length": String(item.bytes.byteLength),
								"content-type": item.type ?? "application/octet-stream",
							},
						})
					: new Response(null, { status: 404 })
			})
		const publicOrigin = "https://native-workspace.example.test"
		let activityModel
		const host = await run(
			BrowserHost.start({
				publicOrigin,
				// Only the activity scenario overrides the existing upstream fixture model.
				get model() {
					return activityModel
				},
				platformAdmins: ["native-owner@example.com"],
				discovery: publisher.discovery,
				appProbe: publisher.probe,
				appNetwork: Layer.succeed(AppNetwork, {
					layer: (owner, origins) =>
						NodeHttpServer.layerUserNetwork({
							owner,
							allowedOrigins: origins,
							allowAddress: (ip) => ip === "127.0.0.1",
							ca: [publisher.ca],
						}),
				}),
				platformFetch: storage,
				bots: { memory: false },
			}),
		)
		const returnTo = "/next?feature=files"
		const owner = await run(host.login("native-owner", returnTo))
		assert.equal(
			Option.getOrThrow(owner.returnLocation),
			publicOrigin + returnTo,
		)
		const other = await run(host.login("native-other"))
		const openbotOrigin = await run(host.address)
		const postgres = await startDatabase()
		cleanup.push(() => postgres.close())
		const pool = new Pool({ connectionString: postgres.url })
		cleanup.push(() => pool.end())
		for (const name of [
			"001_business.sql",
			"002_chat_automations.sql",
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
		const computeDirectory = await mkdtemp(
			join(tmpdir(), "kay-native-compute-"),
		)
		cleanup.push(() => rm(computeDirectory, { recursive: true, force: true }))
		const computeKey = join(computeDirectory, "key"),
			computeSocket = join(computeDirectory, "broker.sock")
		await writeFile(computeKey, randomBytes(32), { mode: 0o600 })
		const config = fromEnvironment({
			KAY_PUBLIC_ORIGIN: publicOrigin,
			KAY_OPENBOT_ORIGIN: openbotOrigin,
			KAY_DATABASE_URL: postgres.url,
			KAY_INTERNAL_TOKEN:
				"disposable-native-fixture-token-at-least-32-characters",
			KAY_TARGET_ORGANIZATION_ID: owner.identity.organizationId,
			KAY_AUTH_BACKEND: "openbot",
			KAY_BACKEND_ROUTING: "native",
			KAY_NEXT_ENABLED: "true",
			KAY_BASIC_COMPUTE_SOCKET: computeSocket,
			KAY_BASIC_COMPUTE_KEY_FILE: computeKey,
			KAY_MEMBERSHIP_CODE_MANAGER_ACCOUNT_ID: owner.identity.userId,
		})
		const db = runtime(config)
		cleanup.push(() => db.dispose())
		const computeFiles = new Map(),
			computeCalls = [],
			computeRemoved = []
		let activityCommandGate
		let activityCommandRuns = 0
		let activityCommandStops = 0
		const computeBroker = await startBasicComputeBroker({
			db,
			origin: openbotOrigin,
			socketPath: computeSocket,
			keyFile: computeKey,
			driver: {
				health: async () => {},
				createLease: async (lease) => ({ ...lease, idlePid: 1 }),
				terminateLease: async (lease) => {
					computeRemoved.push(lease.leaseId)
					computeFiles.clear()
				},
				files: async ({ operationId, operation }) => {
					computeCalls.push(operationId)
					if (operation._tag === "Write") {
						computeFiles.set(operation.file.path, operation.file)
						return null
					}
					if (operation._tag === "Read") return computeFiles.get(operation.path)
					if (operation._tag === "Remove") {
						computeFiles.delete(operation.path)
						return null
					}
					return Array.from(computeFiles.keys()).map((path) => ({
						name: path.split("/").at(-1),
						kind: "file",
						size: 7,
						modifiedAt: Date.now(),
					}))
				},
				start: ({ operationId, command, onOutput }) => {
					computeCalls.push(operationId)
					const heldActivity = command === "echo native-activity"
					if (heldActivity) activityCommandRuns++
					const result = {
						reason: "finished",
						exitCode: 0,
						signal: null,
						outputBytes: 15,
					}
					const done = (async () => {
						if (heldActivity) await activityCommandGate?.promise
						await new Promise((resolve) => setTimeout(resolve, 10))
						onOutput(Buffer.from("native compute\n").toString("base64"))
						return result
					})()
					return {
						done,
						input: () => {},
						signal: () => {
							if (heldActivity) activityCommandStops++
						},
						close: async () => {
							if (heldActivity) activityCommandStops++
							return result
						},
					}
				},
			},
		})
		cleanup.push(() => computeBroker.close())
		const gateway = createGateway({
			config,
			db,
			nativeProduct: createNativeClient({ origin: openbotOrigin }),
		})
		const origin = await listen(gateway)
		cleanup.push(() => close(gateway))
		const request = (path, method = "GET", payload, identity = owner) =>
			fetch(origin + path, {
				method,
				headers: {
					cookie: Caller.sessionCookie(identity.session),
					origin: publicOrigin,
					...(payload === undefined || payload instanceof FormData
						? {}
						: { "content-type": "application/json" }),
				},
				...(payload === undefined
					? {}
					: {
							body:
								payload instanceof FormData ? payload : JSON.stringify(payload),
						}),
				redirect: "manual",
				signal: AbortSignal.timeout(20000),
			})
		const json = async (response) => {
			const body = await response.text()
			assert.ok(response.ok, `${response.status}: ${body}`)
			return body === "" ? null : JSON.parse(body)
		}
		const product = async (path, method, payload, identity) =>
			json(await request("/api/kay/v1" + path, method, payload, identity))
		const activity = async (chatId) => {
			const response = await request(`/api/kay/v1/chats/${chatId}/activity`)
			return response.status === 409 ? null : json(response)
		}
		const featurePath = (id, method = "GET", input = {}) =>
			"/features/" +
			encodeURIComponent(id) +
			(method === "GET"
				? "?input=" + encodeURIComponent(JSON.stringify(input))
				: "")
		const catalog = await product("/features/catalog")
		const feature = async (
			id,
			method = "GET",
			input = {},
			identity = owner,
		) => {
			const operation = catalog.find((operation) => operation.id === id)
			assert.ok(operation, `The native catalog must expose ${id}`)
			const response = await request(
				"/api/kay/v1" + featurePath(id, method, input),
				method,
				method === "GET" ? undefined : input,
				identity,
			)
			const value = await json(response)
			if (operation.resultMode !== "execution") return value
			assert.equal(response.status, 202)
			assert.equal(typeof value.executionId, "string")
			assert.equal(typeof value.commandKey, "string")
			const outcome = await until(`${id} saved result`, async () => {
				const result = await product(
					`/feature-results/${encodeURIComponent(value.executionId)}?operation=${encodeURIComponent(id)}`,
					"GET",
					undefined,
					identity,
				)
				assert.equal(result.execution.id, value.executionId)
				return result.pending ? null : result
			})
			assert.ok(
				Object.hasOwn(outcome, "result"),
				`${id} must return its saved business result`,
			)
			return outcome.result
		}
		const completedExecution = async (receipt, statuses = ["completed"]) => {
			assert.equal(typeof receipt.executionId, "string")
			let executionId = receipt.executionId
			const visited = new Set([executionId])
			return until("durable execution completion", async () => {
				const execution = await product(
					`/executions/${encodeURIComponent(executionId)}`,
				)
				assert.equal(execution.id, executionId)
				if (execution.forwardedTo !== undefined) {
					assert.ok(
						!visited.has(execution.forwardedTo),
						"Moved input must not form a cycle",
					)
					executionId = execution.forwardedTo
					visited.add(executionId)
					return null
				}
				if (statuses.includes(execution.status)) return execution
				assert.ok(
					![
						"completed",
						"failed",
						"cancelled",
						"interrupted",
						"outcome_unknown",
					].includes(execution.status),
					`Execution ${execution.id} ended with ${execution.status}: ${JSON.stringify(execution.failure)}`,
				)
				return null
			})
		}
		const send = async (chatId, input) => {
			const response = await request(
				`/api/kay/v1/chats/${chatId}/messages`,
				"POST",
				{
					input,
					stream: false,
				},
			)
			const receipt = await json(response)
			assert.equal(response.status, 202)
			assert.equal(receipt.delivery, "accepted")
			assert.equal(receipt.itemId, null)
			assert.equal(receipt.chatId, chatId)
			assert.equal(typeof receipt.executionId, "string")
			assert.equal(typeof receipt.commandKey, "string")
			const saved = await product(
				`/execution-commands/${encodeURIComponent(receipt.commandKey)}`,
			)
			assert.equal(saved.executionId, receipt.executionId)
			assert.equal(saved.commandKey, receipt.commandKey)
			return receipt
		}
		await checkReadiness({ config, db, origin })
		const initial = await product("/bootstrap")
		assert.equal(initial.access.adminConsole, true)
		const memberBootstrap = await product("/bootstrap", "GET", undefined, other)
		assert.equal(memberBootstrap.access.adminConsole, false)
		const memberCatalog = await product(
			"/features/catalog",
			"GET",
			undefined,
			other,
		)
		for (const operation of [
			"platform.getPlatformSettings",
			"platform.updatePlatformSettings",
			"modelProviders.listModelProviders",
			"computerProviders.listComputerProviders",
		]) {
			assert.ok(catalog.some((item) => item.id === operation))
			assert.ok(!memberCatalog.some((item) => item.id === operation))
		}
		for (const operation of [
			"bots.botMemory",
			"connections.listConnections",
			"modelProviders.getModelCatalog",
		])
			assert.ok(
				memberCatalog.some((item) => item.id === operation),
				`Members retain ${operation}`,
			)
		const originalPlatform = await feature("platform.getPlatformSettings")
		for (const [operation, method, input] of [
			["platform.getPlatformSettings", "GET", {}],
			["modelProviders.listModelProviders", "GET", {}],
			["computerProviders.listComputerProviders", "GET", {}],
			[
				"platform.updatePlatformSettings",
				"PATCH",
				{
					payload: {
						expectedVersion: originalPlatform.version,
						publicOrigin: "https://denied.example.test",
					},
				},
			],
		]) {
			const denied = await request(
				"/api/kay/v1" + featurePath(operation, method, input),
				method,
				method === "GET" ? undefined : input,
				other,
			)
			assert.equal(
				denied.status,
				403,
				`${operation} must require administration access`,
			)
			assert.equal(denied.headers.get("location"), null)
		}
		assert.deepEqual(
			await feature("platform.getPlatformSettings"),
			originalPlatform,
		)
		assert.equal(initial.defaultBotId, null)
		assert.equal(
			(
				await request("/api/kay/v1/default-bot", "POST", {
					userId: other.identity.userId,
					organizationId: initial.identity.organizationId,
				})
			).status,
			409,
		)
		assert.deepEqual(await product("/default-bot"), {
			phase: "uninitialized",
			botId: null,
		})
		const setup = await product("/default-bot", "POST", {
			userId: initial.identity.userId,
			organizationId: initial.identity.organizationId,
		})
		assert.equal(setup.phase, "ready")
		const botId = setup.botId
		assert.deepEqual(
			await product("/default-bot", "POST", {
				userId: initial.identity.userId,
				organizationId: initial.identity.organizationId,
			}),
			setup,
		)
		const bootstrap = await product("/bootstrap")
		assert.equal(bootstrap.defaultBotId, botId)
		assert.equal(bootstrap.identity.userId, owner.identity.userId)
		const createdBot = (await feature("bots.listBots")).find(
			(bot) => bot.id === botId,
		)
		assert.ok(
			createdBot.model,
			"New members must have an explicit language model, independently of the fixture host default",
		)
		const availableModels = await feature("modelProviders.getModelCatalog")
		assert.ok(
			availableModels.models.some(
				(model) =>
					model.provider === createdBot.model.provider &&
					model.id === createdBot.model.model &&
					model.type === "language",
			),
		)
		const member = await product(
			"/default-bot",
			"POST",
			{
				userId: other.identity.userId,
				organizationId: other.identity.organizationId,
			},
			other,
		)
		assert.equal(member.phase, "ready")
		assert.notEqual(member.botId, botId)
		assert.equal(
			(
				await pool.query(
					"SELECT to_regclass('kay_migration_accounts') AS ledger",
				)
			).rows[0].ledger,
			null,
		)
		assert.equal((await request("/v1/sessions")).status, 410)

		const chat = await product("/chats", "POST", {
			botId,
			requestId: randomUUID(),
		})
		const chatId = chat.id
		assert.ok(chatId)
		const streamed = await request(
			`/api/kay/v1/chats/${chatId}/messages`,
			"POST",
			{ input: "Hello from the native workspace", stream: true },
		)
		assert.equal(streamed.status, 200)
		assert.match(streamed.headers.get("content-type"), /text\/event-stream/)
		const stream = await streamed.text()
		const events = stream
			.split(/\r?\n/)
			.filter((line) => line.startsWith("data:"))
			.map((line) => JSON.parse(line.slice(5)))
		assert.equal(events[0].type, "response.accepted")
		assert.match(stream, /response\.output_text\.delta/)
		assert.match(stream, /useful result/)
		await completedExecution(events[0])
		const history = await product(`/chats/${chatId}/items`)
		assert.match(JSON.stringify(history), /Hello from the native workspace/)
		assert.match(JSON.stringify(history), /useful result/)
		const initialActivity = await until("saved conversation activity", () =>
			activity(chatId),
		)
		assert.equal(initialActivity.chatId, chatId)
		assert.equal(initialActivity.status, "Completed")
		assert.equal(initialActivity.plan.source, "none")
		assert.equal(initialActivity.progress, null)
		assert.deepEqual(initialActivity.updates, [])
		assert.deepEqual(initialActivity.tools, [])
		const named = await product(`/chats/${chatId}`)
		assert.equal(named.title, "Hello from the native workspace")
		const metadata = await product(`/chats/${chatId}/metadata`)
		await product(`/chats/${chatId}/metadata`, "PATCH", {
			expected: metadata.revision,
			title: "My research notes",
		})
		assert.equal((await product(`/chats/${chatId}`)).title, "My research notes")
		assert.equal(
			(await request(`/api/kay/v1/chats/${chatId}`, "GET", undefined, other))
				.status,
			404,
		)
		assert.equal(
			(
				await request(
					`/api/kay/v1/chats/${chatId}/activity`,
					"GET",
					undefined,
					other,
				)
			).status,
			404,
		)

		const reminderTask = await send(chatId, "Remind me in thirty minutes")
		await completedExecution(reminderTask)
		const waitingReminder = await until("native reminder in Kay", async () =>
			(
				await product(`/reminders?chatId=${encodeURIComponent(chatId)}`)
			).items.find((row) => row.status === "waiting"),
		)
		assert.equal(waitingReminder.note, "Review the result")
		assert.equal(waitingReminder.chatId, chatId)
		assert.equal(typeof waitingReminder.executionId, "string")
		assert.deepEqual(
			await product(`/reminders/${waitingReminder.id}`),
			waitingReminder,
		)
		const { Reminders } = await native(
			"packages/openbot/src/plugins/work/Reminders.ts",
		)
		await run(
			host.run(
				Effect.gen(function* () {
					const reminders = yield* Reminders
					yield* reminders.start(owner.identity.organizationId, {
						id: "legacy-done-reminder",
						userId: owner.identity.userId,
						author: owner.identity.userId,
						chat: chatId,
						turn: waitingReminder.turnId,
						toolCallId: "legacy-reminder-call",
						note: "An earlier reminder already reached this Chat",
						dueAt: 0,
					})
					yield* reminders.change(
						owner.identity.organizationId,
						"legacy-done-reminder",
						"waiting",
						"done",
					)
				}),
			),
		)
		const reminderPage = await product(
			`/reminders?chatId=${encodeURIComponent(chatId)}`,
		)
		const legacyReminder = reminderPage.items.find(
			(row) => row.id === "legacy-done-reminder",
		)
		assert.equal(legacyReminder.status, "done")
		assert.equal(legacyReminder.executionId, null)
		assert.equal(
			(await product("/reminders/legacy-done-reminder")).note,
			legacyReminder.note,
		)
		assert.equal(
			(
				await request(
					`/api/kay/v1/reminders/${waitingReminder.id}`,
					"GET",
					undefined,
					other,
				)
			).status,
			404,
		)
		const cancelKey = randomUUID()
		const cancelledReminder = await request(
			`/api/kay/v1/reminders/${waitingReminder.id}/cancel`,
			"POST",
			{ commandKey: cancelKey },
		)
		assert.equal(cancelledReminder.status, 202)
		const cancelReceipt = await json(cancelledReminder)
		assert.equal(cancelReceipt.executionId, waitingReminder.executionId)
		await completedExecution(cancelReceipt, ["cancelled"])
		assert.equal(
			(await product(`/reminders/${waitingReminder.id}`)).status,
			"cancelled",
		)
		assert.deepEqual(
			await product(`/reminders/${waitingReminder.id}/cancel`, "POST", {
				commandKey: cancelKey,
			}),
			cancelReceipt,
		)

		const slow = await send(chatId, "slow answer")
		await until("running slow answer", async () => {
			const execution = await product(`/executions/${slow.executionId}`)
			return execution.status === "running" && execution
		})
		await product(`/chats/${chatId}/interrupt`, "POST", { includeTasks: false })
		await completedExecution(slow, ["cancelled", "interrupted"])
		await until("interrupted chat", async () => {
			const current = await product(`/chats/${chatId}`)
			return current.activity === "inactive" && current
		})

		assert.equal((await product(`/chats/${chatId}`)).title, "My research notes")

		const approvalChat = await product("/chats", "POST", {
			botId,
			requestId: randomUUID(),
		})
		const approvalExecution = await send(
			approvalChat.id,
			"Please perform the approval action",
		)
		const pending = await until("native approval", async () =>
			(
				await feature("requests.listRequests", "GET", {
					query: { status: "pending" },
				})
			).find((item) => item.chat === approvalChat.id),
		)
		assert.equal(await run(host.toolCalls), 0)
		const approved = await feature("requests.resolveRequest", "POST", {
			params: { requestId: pending.id },
			payload: { expected: pending.revision, decision: "allow", scope: "once" },
		})
		assert.equal(approved.status, "allowed")
		await until(
			"approved tool result",
			async () => (await run(host.toolCalls)) === 1,
		)
		await completedExecution(approvalExecution)
		const approvedActivity = await until("saved approved activity", () =>
			activity(approvalChat.id),
		)
		const approvedTool = approvedActivity.tools.find(
			(tool) => tool.name === "ConfirmChange",
		)
		assert.ok(approvedTool)
		assert.equal(approvedTool.status, "completed")
		assert.equal(approvedTool.turnId, approvedActivity.turnId)
		assert.equal(approvedTool.computerId, null)
		assert.ok(approvedTool.itemId)
		assert.ok(approvedTool.executionId)
		assert.ok(
			!(await activity(chatId)).tools.some(
				(tool) => tool.id === approvedTool.id,
			),
		)
		assert.equal(
			(
				await request(
					`/api/kay/v1/executions/${approvalExecution.executionId}`,
					"GET",
					undefined,
					other,
				)
			).status,
			403,
		)
		assert.equal(
			await product(
				`/execution-commands/${approvalExecution.commandKey}`,
				"GET",
				undefined,
				other,
			),
			null,
			"A different actor cannot discover whether this command key exists",
		)
		assert.equal(
			(
				await request(
					"/api/kay/v1/features/requests.getRequest?input=" +
						encodeURIComponent(
							JSON.stringify({ params: { requestId: pending.id } }),
						),
					"GET",
					undefined,
					other,
				)
			).status,
			404,
		)

		const platform = await feature("platform.getPlatformSettings")
		assert.equal(typeof platform.version, "number", `Platform settings keys: ${Object.keys(platform)}`)
		await feature("platform.updatePlatformSettings", "PATCH", {
			payload: {
				expectedVersion: platform.version,
				files: {
					storage: {
						endpoint: storageOrigin,
						publicEndpoint: null,
						region: "us-east-1",
						bucket: "native-test",
						accessKeyId: "fixture-access",
						secretAccessKey: "fixture-secret",
						forcePathStyle: true,
					},
				},
			},
		})
		const fileBody = new FormData()
		fileBody.set(
			"file",
			new File(
				["A file carried through Kay and OpenBot.\n"],
				"native-workflow.txt",
				{ type: "text/plain" },
			),
		)
		const uploaded = await product(
			"/features/files.uploadFile",
			"POST",
			fileBody,
		)
		assert.equal(uploaded.status, "ready")
		const files = await feature("files.listFiles", "GET", filesPageInput())
		assert.ok(files.items.some((file) => file.id === uploaded.id))
		const downloadPath =
			"/api/kay/v1/features/files.getFileContent?input=" +
			encodeURIComponent(JSON.stringify({ params: { fileId: uploaded.id } }))
		assert.equal(
			await (await request(downloadPath)).text(),
			"A file carried through Kay and OpenBot.\n",
		)
		assert.equal(
			(await request(downloadPath, "GET", undefined, other)).status,
			404,
		)

		const draft = await feature("connections.prepareConnection", "POST", {
			payload: { input: publisher.origin + "/card" },
		})
		const connection = await feature("connections.createConnection", "POST", {
			payload: {
				draftId: draft.id,
				revision: draft.revision,
				cardUrl: publisher.origin + "/card",
				remoteIndex: 0,
				name: "Fixture documents",
				values: {
					"header:X-Account": "Work",
					"header:X-Secret": "fixture-secret",
				},
				confirmed: true,
			},
		})
		assert.ok(connection.id)
		assert.ok(
			(await feature("connections.listConnections")).some(
				(item) => item.id === connection.id,
			),
		)
		assert.ok((await run(publisher.operations)).includes("tools/list"))

		const trigger = await feature("triggers.createTrigger", "POST", {
			payload: {
				bot: botId,
				prompt: "Review the native workspace",
				schedule: { cron: "0 9 * * 1", timeZone: "Asia/Shanghai" },
			},
		})
		assert.equal(trigger.enabled, true)
		assert.ok(trigger.nextRunAt > Date.now())
		const link = await product(
			`/automations/${trigger.id}/conversation`,
			"PUT",
			{ chatId, expectedChatId: null },
		)
		assert.equal(link.chatId, chatId)
		assert.equal(
			(await product(`/automations/${trigger.id}/conversation`)).chatId,
			chatId,
		)
		const hook = await feature("triggers.setTriggerWebhook", "PUT", {
			params: { triggerId: trigger.id },
		})
		const hookPath = `/v1/hooks/triggers/${trigger.id}`
		const invokeHook = (secret, commandKey = randomUUID()) =>
			fetch(origin + hookPath, {
				method: "POST",
				headers: {
					authorization: "Bearer " + secret,
					"content-type": "application/json",
					"idempotency-key": commandKey,
				},
				body: '{ "order": 42 }',
				signal: AbortSignal.timeout(20000),
			})
		assert.equal((await invokeHook("wrong-fixture-secret")).status, 401)
		const triggerCommandKey = randomUUID()
		const firedResponse = await invokeHook(hook.secret, triggerCommandKey)
		const fired = await json(firedResponse)
		assert.equal(firedResponse.status, 202)
		assert.equal(fired.commandKey, `trigger:${trigger.id}:${triggerCommandKey}`)
		assert.equal(typeof fired.executionId, "string")
		const repeated = await json(
			await invokeHook(hook.secret, triggerCommandKey),
		)
		assert.deepEqual(
			repeated,
			fired,
			"The same hook command must not start a second task",
		)
		await completedExecution(fired)
		const task = await until("trigger task completion", async () => {
			const result = await feature("delegations.getDelegation", "GET", {
				params: { delegationId: fired.delegation },
			})
			return result.status === "completed" ? result : null
		})
		assert.ok(task.chat)
		const tasks = await feature("chats.listChats", "GET", {
			query: { kind: "task" },
		})
		assert.ok(tasks.some((item) => item.chat.id === task.chat))
		const latestTrigger = await feature("triggers.getTrigger", "GET", {
			params: { triggerId: trigger.id },
		})
		const paused = await feature("triggers.updateTrigger", "PATCH", {
			params: { triggerId: trigger.id },
			payload: { expected: latestTrigger.revision, enabled: false },
		})
		assert.equal(paused.enabled, false)
		assert.equal(paused.nextRunAt, null)
		assert.equal((await invokeHook(hook.secret)).status, 401)
		assert.ok(
			Array.isArray(
				await feature("chats.listChats", "GET", { query: { kind: "task" } }),
			),
		)
		const unlinked = await product(
			`/automations/${trigger.id}/conversation`,
			"PUT",
			{ chatId: null, expectedChatId: chatId },
		)
		assert.equal(unlinked.chatId, null)
		assert.equal(await run(host.toolCalls), 1)
		assert.equal((await product("/membership")).canManageCodes, true)
		const ownerCode = await product("/admin/membership/codes", "POST", {
			requestId: "native-owner-code",
			planId: "precious",
		})
		const ownerMembership = await product("/membership/redeem", "POST", {
			requestId: "native-owner-redemption",
			code: ownerCode.code,
		})
		assert.equal(ownerMembership.membership.container.allowed, true)
		let basicSetup = await product("/basic-compute/provision", "POST", {
			requestId: "native-basic-setup",
		})
		if (basicSetup.phase !== "ready")
			basicSetup = await product("/basic-compute/provision", "POST", {
				requestId: "native-basic-setup",
			})
		assert.equal(basicSetup.phase, "ready")
		assert.equal(
			(await product("/membership", "GET", undefined, other)).canManageCodes,
			false,
		)
		assert.equal(
			(
				await request(
					"/api/kay/v1/admin/membership/codes",
					"POST",
					{ requestId: "native-unauthorized-code", planId: "precious" },
					other,
				)
			).status,
			403,
		)
		const ordinaryCode = await product("/admin/membership/codes", "POST", {
			requestId: "native-ordinary-code",
			planId: "precious",
		})
		const ordinaryMembership = await product(
			"/membership/redeem",
			"POST",
			{
				requestId: "native-ordinary-redemption",
				code: ordinaryCode.code,
			},
			other,
		)
		assert.equal(ordinaryMembership.membership.container.allowed, true)
		assert.equal(ordinaryMembership.membership.canManageCodes, false)
		await product(
			"/default-bot",
			"POST",
			{
				userId: other.identity.userId,
				organizationId: other.identity.organizationId,
			},
			other,
		)
		let ordinarySetup = await product(
			"/basic-compute/provision",
			"POST",
			{ requestId: "ordinary-member-compute" },
			other,
		)
		if (ordinarySetup.phase !== "ready")
			ordinarySetup = await product(
				"/basic-compute/provision",
				"POST",
				{ requestId: "ordinary-member-compute" },
				other,
			)
		assert.equal(ordinarySetup.phase, "ready")
		assert.notEqual(ordinarySetup.computerId, basicSetup.computerId)
		const basicComputer = await feature("computers.getComputer", "GET", {
			params: { computerId: basicSetup.computerId },
		})
		assert.deepEqual(basicComputer.owner, {
			_tag: "Member",
			userId: owner.identity.userId,
		})
		assert.equal(
			(
				await feature("computers.listComputerBots", "GET", {
					params: { computerId: basicSetup.computerId },
				})
			).some((grant) => grant.bot === botId),
			true,
		)
		await until(
			"native connector handshake",
			async () => (await product("/basic-compute")).state === "ready",
			30000,
		)
		const personalComputer = await feature("computers.createComputer", "POST", {
			payload: {
				commandKey: randomUUID(),
				name: "Activity fixture laptop",
				source: { _tag: "Connector" },
			},
		})
		const findDevice = (overview, computerId) =>
			overview.groups
				.find((group) => group.category === "computer")
				.devices.find((device) => device.id === computerId)
		const initialDevices = await product("/devices")
		assert.equal(initialDevices.defaultBotId, botId)
		assert.equal(
			findDevice(initialDevices, basicSetup.computerId).management,
			"managed",
		)
		assert.equal(
			findDevice(initialDevices, basicSetup.computerId).state,
			"running",
		)
		assert.equal(
			findDevice(initialDevices, basicSetup.computerId).kayAccess,
			"granted",
		)
		assert.equal(
			findDevice(initialDevices, personalComputer.id).state,
			"offline",
		)
		assert.equal(
			findDevice(initialDevices, personalComputer.id).management,
			"personal",
		)
		assert.equal(
			findDevice(initialDevices, personalComputer.id).kayAccess,
			"not_granted",
		)
		assert.equal(
			findDevice(initialDevices, personalComputer.id).capabilities.desktop,
			false,
		)
		for (const category of ["phone", "smart"]) {
			const group = initialDevices.groups.find(
				(group) => group.category === category,
			)
			assert.equal(group.connection.status, "unavailable")
			assert.deepEqual(group.devices, [])
		}
		assert.equal(
			findDevice(initialDevices, ordinarySetup.computerId),
			undefined,
		)
		const otherDevices = await product("/devices", "GET", undefined, other)
		assert.equal(findDevice(otherDevices, basicSetup.computerId), undefined)
		assert.equal(findDevice(otherDevices, personalComputer.id), undefined)
		assert.equal(
			findDevice(otherDevices, ordinarySetup.computerId).kayAccess,
			"granted",
		)
		await feature("computers.grantComputer", "PUT", {
			params: { computerId: personalComputer.id, botId },
		})
		const grantedDevice = findDevice(
			await product("/devices"),
			personalComputer.id,
		)
		assert.equal(grantedDevice.kayAccess, "granted")
		assert.equal(
			grantedDevice.state,
			"offline",
			"Granting access does not connect a computer",
		)
		await feature("computers.revokeComputer", "DELETE", {
			params: { computerId: personalComputer.id, botId },
		})
		assert.equal(
			findDevice(await product("/devices"), personalComputer.id).kayAccess,
			"not_granted",
		)
		await feature("computers.deleteComputer", "DELETE", {
			params: { computerId: personalComputer.id },
			payload: { commandKey: randomUUID() },
		})
		assert.equal(
			findDevice(await product("/devices"), personalComputer.id),
			undefined,
		)

		const planItems = [
			{
				id: "inspect",
				content: "Inspect the task workspace",
				status: "in_progress",
			},
			{ id: "deliver", content: "Record the result", status: "pending" },
		]
		const completedPlan = planItems.map((item) => ({ ...item, status: "done" }))
		const continuePlan = Promise.withResolvers()
		activityCommandGate = Promise.withResolvers()
		const usage = {
			inputTokens: { total: 12, uncached: 12, cacheRead: 0, cacheWrite: 0 },
			outputTokens: { total: 6, text: 6, reasoning: 0 },
		}
		const toolResponse = (id, name, params) =>
			Stream.make(
				ModelResponse.makePart("tool-call", {
					id,
					name,
					params,
					providerExecuted: false,
				}),
				ModelResponse.makePart("finish", { reason: "tool-calls", usage }),
			)
		let planStep = 0
		activityModel = await run(
			LanguageModel.make({
				generateText: () =>
					Effect.succeed([
						ModelResponse.makePart("text", { text: '{"changes":[]}' }),
					]),
				streamText: () =>
					Stream.suspend(() => {
						const step = planStep++
						if (step === 0)
							return toolResponse("activity-plan-start", "openbot_todos", {
								items: planItems,
							})
						if (step === 1)
							return Stream.fromEffect(
								Effect.promise(() => continuePlan.promise),
							).pipe(
								Stream.flatMap(() =>
									toolResponse("activity-computer", "openbot_computer_exec", {
										computer: basicSetup.computerId,
										command: "echo native-activity",
										tty: false,
										yield_time_ms: 30000,
									}),
								),
							)
						if (step === 2)
							return toolResponse("activity-plan-done", "openbot_todos", {
								items: completedPlan,
							})
						return Stream.make(
							ModelResponse.makePart("text-start", { id: "activity-result" }),
							ModelResponse.makePart("text-delta", {
								id: "activity-result",
								delta: "The workspace result is recorded.",
							}),
							ModelResponse.makePart("text-end", { id: "activity-result" }),
							ModelResponse.makePart("finish", { reason: "stop", usage }),
						)
					}),
			}),
		)
		const planChat = await product("/chats", "POST", {
			botId,
			requestId: randomUUID(),
		})
		let completedActivity
		const activeReaders = new Set()
		const observeChat = async () => {
			const response = await request(`/api/kay/v1/chats/${planChat.id}/events`)
			assert.equal(response.status, 200)
			assert.match(response.headers.get("content-type"), /text\/event-stream/)
			const reader = chatEvents(response.body)[Symbol.asyncIterator]()
			activeReaders.add(reader)
			return reader
		}
		try {
			const planReceipt = await send(
				planChat.id,
				"Inspect the workspace and keep a plan",
			)
			await until("saved running native plan", async () => {
				const current = await feature("chats.chatTodos", "GET", {
					params: { chatId: planChat.id },
				})
				return current.items.length === 2 && current
			})
			const runningActivity = await until("current activity plan", async () => {
				const value = await activity(planChat.id)
				return value?.plan.source === "current" && value
			})
			assert.equal(runningActivity.status, "Running")
			assert.deepEqual(runningActivity.plan.items, planItems)
			assert.deepEqual(runningActivity.progress, { completed: 0, total: 2 })
			assert.ok(runningActivity.turnId)
			assert.equal(runningActivity.activeExecution.id, planReceipt.executionId)
			assert.ok(
				!runningActivity.tools.some(
					(tool) => tool.name === "openbot_computer_exec",
				),
			)
			const observer = await observeChat()
			const connected = (await observer.next()).value
			assert.equal(connected.type, "response.checkpoint")
			assert.equal(connected.executionId, planReceipt.executionId)
			assert.ok(!("commandKey" in connected))
			continuePlan.resolve()
			let started
			for await (const event of { [Symbol.asyncIterator]: () => observer }) {
				if (event.toolActivity?.name === "openbot_computer_exec") {
					started = event
					break
				}
			}
			activeReaders.delete(observer)
			assert.ok(
				started,
				"The running command must publish a safe tool intent before its result",
			)
			assert.equal(started.toolActivity.status, "queued")
			assert.equal(started.toolActivity.computerId, basicSetup.computerId)
			assert.equal(started.chatId, planChat.id)
			assert.equal(started.turnId, runningActivity.turnId)
			assert.equal(started.executionId, planReceipt.executionId)
			assert.doesNotMatch(
				JSON.stringify(started),
				/echo native-activity|params|arguments/,
			)
			const activeComputer = await until(
				"foreground computer call before history commit",
				async () => {
					const value = await activity(planChat.id)
					return (
						value?.tools.some(
							(tool) =>
								tool.name === "openbot_computer_exec" &&
								tool.status === "running",
						) && value
					)
				},
			)
			const currentTool = activeComputer.tools.find(
				(tool) => tool.name === "openbot_computer_exec",
			)
			assert.equal(currentTool.executionId, planReceipt.executionId)
			assert.equal(currentTool.turnId, runningActivity.turnId)
			assert.equal(currentTool.itemId, started.toolActivity.itemId)
			assert.equal(currentTool.computerId, basicSetup.computerId)
			await until(
				"the held Computer command reaches its driver",
				async () => activityCommandRuns === 1,
			)
			assert.equal(activityCommandRuns, 1)
			assert.equal(
				activityCommandStops,
				0,
				"Closing the first observation must not stop its Computer command",
			)
			assert.equal(
				(
					await request(
						`/api/kay/v1/chats/${planChat.id}/events`,
						"GET",
						undefined,
						other,
					)
				).status,
				404,
			)
			assert.ok(
				!(await activity(chatId)).tools.some(
					(tool) => tool.id === currentTool.id,
				),
			)
			const refreshed = await observeChat()
			const resumed = (await refreshed.next()).value
			assert.equal(resumed.type, "response.checkpoint")
			assert.equal(resumed.executionId, planReceipt.executionId)
			assert.ok(
				resumed.executionSequence >= activeComputer.activeExecution.sequence,
			)
			const completionEvents = Array.fromAsync({
				[Symbol.asyncIterator]: () => refreshed,
			})
			activityCommandGate.resolve()
			await completedExecution(planReceipt)
			const observedCompletion = await completionEvents
			activeReaders.delete(refreshed)
			assert.ok(
				observedCompletion.some(
					(event) =>
						event.type === "response.checkpoint" &&
						event.executionSequence > resumed.executionSequence,
				),
			)
			assert.ok(
				observedCompletion.some((event) => event.type === "response.completed"),
			)
			assert.ok(
				observedCompletion.every(
					(event) =>
						event.type !== "response.accepted" &&
						event.executionId === planReceipt.executionId,
				),
			)
			assert.equal(
				activityCommandRuns,
				1,
				"Reading or reconnecting must not send the Computer command again",
			)
			assert.deepEqual(
				(
					await feature("chats.chatTodos", "GET", {
						params: { chatId: planChat.id },
					})
				).items,
				[],
			)
			const computerCallsBeforeReading = computeCalls.length
			completedActivity = await until(
				"completed plan recovered from history",
				() => activity(planChat.id),
			)
			assert.equal(completedActivity.status, "Completed")
			assert.equal(
				completedActivity.activeExecution.id,
				planReceipt.executionId,
			)
			assert.equal(completedActivity.activeExecution.status, "completed")
			assert.ok(
				completedActivity.tools.every((tool) => tool.status === "completed"),
			)
			assert.equal(
				(await request(`/api/kay/v1/chats/${planChat.id}/events`)).status,
				204,
			)
			assert.equal(completedActivity.plan.source, "history")
			assert.deepEqual(completedActivity.plan.items, completedPlan)
			assert.equal(completedActivity.plan.turnId, runningActivity.turnId)
			assert.ok(completedActivity.plan.sourceItemId)
			assert.deepEqual(completedActivity.progress, { completed: 2, total: 2 })
			const savedPlan = await feature("chats.chatItems", "GET", {
				params: { chatId: planChat.id },
				query: { limit: 100 },
			})
			const savedComputerResult = savedPlan.items
				.flatMap((item) => item.content.content)
				.filter((message) => message.role === "tool")
				.flatMap((message) => message.content)
				.find(
					(part) =>
						part.type === "tool-result" && part.id === "activity-computer",
				)
			assert.ok(savedComputerResult)
			assert.notEqual(savedComputerResult.isFailure, true)
			assert.match(JSON.stringify(savedComputerResult.result), /native compute/)
			const tool = completedActivity.tools.find(
				(tool) => tool.name === "openbot_computer_exec",
			)
			assert.ok(tool)
			assert.equal(tool.status, "completed")
			assert.equal(tool.executionId, null)
			assert.equal(tool.computerId, basicSetup.computerId)
			assert.equal(tool.turnId, runningActivity.turnId)
			assert.ok(tool.itemId)
			assert.deepEqual(tool.fileIds, [])
			assert.equal(computeCalls.length, computerCallsBeforeReading)
		} finally {
			continuePlan.resolve()
			activityCommandGate.resolve()
			for (const reader of activeReaders) await reader.return()
			activityModel = undefined
		}
		await completedExecution(
			await send(planChat.id, "Continue with an ordinary answer"),
		)
		const continuedActivity = await until("activity after a later turn", () =>
			activity(planChat.id),
		)
		assert.notEqual(continuedActivity.turnId, completedActivity.turnId)
		assert.equal(continuedActivity.progress, null)
		assert.equal(continuedActivity.plan.turnId, completedActivity.plan.turnId)
		assert.deepEqual(continuedActivity.tools, completedActivity.tools)
		assert.deepEqual(
			continuedActivity.updates,
			[],
			"Final answer text is not invented progress",
		)
		assert.ok(
			!(await activity(chatId)).tools.some(
				(tool) => tool.computerId === basicSetup.computerId,
			),
		)
		let basicParams = { computerId: basicSetup.computerId }
		await feature("computers.writeFile", "PUT", {
			params: basicParams,
			payload: {
				path: "/workspace/native.txt",
				encoding: "utf8",
				content: "fixture",
			},
		})
		assert.equal(
			(
				await feature("computers.readFile", "GET", {
					params: basicParams,
					query: { path: "/workspace/native.txt" },
				})
			).content,
			"fixture",
		)
		// The real core Ping must survive the pinned SDK and reach the durable broker lease.
		const activityStatus = await until(
			"native task activity Ping",
			async () => {
				const status = await product("/basic-compute")
				return status.lease?.activity === "idle" ||
					status.lease?.activity === "working"
					? status
					: null
			},
			// A connector sends activity with its 20-second Ping, not on every task change.
			30000,
		)
		assert.equal(activityStatus.automatic, true)
		assert.equal(activityStatus.idleSeconds, 300)
		assert.equal(
			activityStatus.lease.expiresAt === null,
			activityStatus.lease.activity !== "idle",
		)
		// Deliverables use the native binary file path, not the command log stream.
		const largeDocument = Buffer.alloc(2 * 1024 * 1024, 71)
		computeFiles.set("/workspace/report.pptx", {
			path: "/workspace/report.pptx",
			encoding: "base64",
			content: largeDocument.toString("base64"),
		})
		const downloadedDocument = await feature("computers.readFile", "GET", {
			params: basicParams,
			query: { path: "/workspace/report.pptx", encoding: "base64" },
		})
		assert.deepEqual(
			Buffer.from(downloadedDocument.content, "base64"),
			largeDocument,
		)
		const command = await feature("computers.exec", "POST", {
			params: basicParams,
			payload: { command: "echo fixture", tty: false, yieldTimeMs: 1000 },
		})
		assert.match(JSON.stringify(command), /native compute/)
		assert.equal(new Set(computeCalls).size, computeCalls.length)
		assert.ok(
			[403, 410].includes(
				(
					await request(
						`/v1/computers/${basicSetup.computerId}/connector-token`,
						"PUT",
					)
				).status,
			),
		)
		assert.equal(
			(
				await request(
					"/api/kay/v1" + featurePath("computers.grantComputer", "PUT"),
					"PUT",
					{ params: { ...basicParams, botId } },
				)
			).status,
			403,
		)
		let readBasicFile =
			"/api/kay/v1" +
			featurePath("computers.readFile", "GET", {
				params: basicParams,
				query: { path: "/workspace/native.txt" },
			})
		assert.equal(
			(await request(readBasicFile, "GET", undefined, other)).status,
			404,
		)
		let repaired = await product("/basic-compute/repair", "POST", {
			requestId: "native-basic-repair",
		})
		if (repaired.phase !== "ready")
			repaired = await product("/basic-compute/repair", "POST", {
				requestId: "native-basic-repair",
			})
		assert.equal(repaired.phase, "ready")
		assert.notEqual(repaired.computerId, basicSetup.computerId)
		assert.equal(
			(
				await request(
					"/api/kay/v1" +
						featurePath("computers.getComputer", "GET", {
							params: basicParams,
						}),
				)
			).status,
			404,
		)
		await until(
			"replacement native connector handshake",
			async () => (await product("/basic-compute")).state === "ready",
			30000,
		)
		basicParams = { computerId: repaired.computerId }
		await feature("computers.writeFile", "PUT", {
			params: basicParams,
			payload: {
				path: "/workspace/native.txt",
				encoding: "utf8",
				content: "replacement",
			},
		})
		readBasicFile =
			"/api/kay/v1" +
			featurePath("computers.readFile", "GET", {
				params: basicParams,
				query: { path: "/workspace/native.txt" },
			})
		assert.equal(
			(await json(await request(readBasicFile))).content,
			"replacement",
		)
		await pool.query(
			"UPDATE kay_subscriptions SET starts_at=1,expires_at=2 WHERE account_id=$1",
			[owner.identity.userId],
		)
		const beforeExpiryCall = computeCalls.length
		assert.ok(!(await request(readBasicFile)).ok)
		assert.equal(computeCalls.length, beforeExpiryCall)
		await until(
			"expired workspace cleanup",
			async () => computeRemoved.length > 0,
		)
		await feature(
			"computers.writeFile",
			"PUT",
			{
				params: { computerId: ordinarySetup.computerId },
				payload: {
					path: "/workspace/member.txt",
					encoding: "utf8",
					content: "ordinary member",
				},
			},
			other,
		)
		assert.equal(
			(
				await feature(
					"computers.readFile",
					"GET",
					{
						params: { computerId: ordinarySetup.computerId },
						query: { path: "/workspace/member.txt" },
					},
					other,
				)
			).content,
			"ordinary member",
		)
		t.diagnostic(
			"Verified native runtime, PostgreSQL, current and completed activity plans, historical tool ownership, scoped device permissions and authenticated computer connector via Kay API; deterministic model/MCP/S3/container fixtures, not production-provider acceptance. Docker isolation has a separate real-VM test.",
		)
	},
)
