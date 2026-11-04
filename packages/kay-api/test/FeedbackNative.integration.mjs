// Opt in with OPENBOT_NATIVE_SOURCE_DIR pointing to the built native core.
// Native services, signed OIDC, TLS and PostgreSQL are real; the model is deterministic.
import assert from "node:assert/strict"
import { test } from "node:test"
import { once } from "node:events"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { randomUUID } from "node:crypto"
import { Pool } from "pg"
import * as Document from "@kaicom/k/Document"
import { createNativeClient } from "@kaicom/kay-openbot"
import { createGateway } from "../src/Gateway.ts"
import { fromEnvironment } from "../src/Configuration.ts"
import { runtime } from "../src/Database.ts"
import { start as startDatabase } from "../test/PostgresTest.ts"

const source = process.env.OPENBOT_NATIVE_SOURCE_DIR
if (!source)
	throw new Error(
		"Set OPENBOT_NATIVE_SOURCE_DIR to the built native OpenBot checkout.",
	)
const native = (path) => import(pathToFileURL(resolve(source, path)).href)
const until = async (label, check) => {
	const deadline = Date.now() + 20000
	while (Date.now() < deadline) {
		const result = await check()
		if (result) return result
		await new Promise((resolve) => setTimeout(resolve, 30))
	}
	throw new Error(`Timed out waiting for ${label}`)
}

test(
	"native default Bot discovers and calls Feedback2Platform with its exact grant",
	{ timeout: 90000 },
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
					"Native feedback fixture cleanup failed",
				)
		})
		const BrowserHost = await native("packages/openbot/test/BrowserHost.ts")
		const Fixture = await native("packages/protocol/test/Fixture.ts")
		const Probe = await native("packages/openbot/src/apps/Probe.ts")
		const { AppNetwork } = await native("packages/openbot/src/apps/AppHost.ts")
		const NodeHttpServer = await native(
			"packages/protocol/src/node/NodeHttpServer.ts",
		)
		const Caller = await native("packages/openbot/test/Caller.ts")
		const { Effect, Exit, Layer, ManagedRuntime, Scope, Stream } = await native(
			"packages/openbot/node_modules/effect/dist/index.js",
		)
		const { LanguageModel, Response } = await native(
			"packages/openbot/node_modules/effect/dist/ai/index.js",
		)
		const { HttpServerRequest, HttpServerResponse } = await native(
			"packages/openbot/node_modules/effect/dist/http/index.js",
		)
		const managed = ManagedRuntime.make(BrowserHost.layerPlatform)
		cleanup.push(() => managed.dispose())
		const scope = await managed.runPromise(Scope.make())
		cleanup.push(() => managed.runPromise(Scope.close(scope, Exit.void)))
		const run = (effect) =>
			managed.runPromise(Effect.provideService(effect, Scope.Scope, scope))
		let gatewayOrigin
		const methods = []
		const discoveryResponses = []
		const proxyFailures = []
		const remote = await run(
			Fixture.serveHttps(
				Effect.gen(function* () {
					const request = yield* HttpServerRequest.HttpServerRequest
					assert.ok(
						gatewayOrigin,
						"The Kay gateway must be ready before native discovery",
					)
					const body =
						request.method === "GET" || request.method === "HEAD"
							? undefined
							: yield* request.text
					if (body) {
						const rpc = JSON.parse(body)
						if (typeof rpc.method === "string") methods.push(rpc.method)
					}
					const target = new URL(request.originalUrl, remote.ipOrigin)
					const headers = new Headers(request.headers)
					for (const name of [
						"host",
						"connection",
						"content-length",
						"transfer-encoding",
					])
						headers.delete(name)
					const response = yield* Effect.promise(() =>
						fetch(gatewayOrigin + target.pathname + target.search, {
							method: request.method,
							headers,
							...(body === undefined ? {} : { body }),
							redirect: "manual",
							signal: AbortSignal.timeout(15000),
						}).catch((error) => {
							proxyFailures.push({
								message: error.message,
								cause: error.cause?.message,
							})
							throw error
						}),
					)
					if (body && JSON.parse(body).method === "server/discover")
						discoveryResponses.push({
							status: response.status,
							contentType: response.headers.get("content-type"),
							body: yield* Effect.promise(() => response.clone().text()),
						})
					return HttpServerResponse.fromWeb(response)
				}),
			),
		)
		const report = {
			reportId: randomUUID(),
			title: "The test task could not open its workspace",
			summary: "The native feedback integration reports a local fixture error.",
			expected: "The task can continue after the workspace reconnects.",
			actual: "The workspace is unavailable in this test case.",
			steps: ["Ask the assistant to prepare a presentation."],
			severity: "major",
			errorId: "local-feedback-reference",
		}
		let emittedCalls = 0
		const model = await run(
			LanguageModel.make({
				generateText: () =>
					Effect.succeed([
						Response.makePart("text", { text: '{"changes":[]}' }),
					]),
				streamText: ({ prompt, tools }) => {
					const lastUser = prompt.content.findLastIndex(
						(entry) => entry.role === "user",
					)
					const finished = prompt.content
						.slice(lastUser + 1)
						.some((entry) => entry.role === "tool")
					const usage = {
						inputTokens: { total: 1, uncached: 1, cacheRead: 0, cacheWrite: 0 },
						outputTokens: { total: 1, text: 1, reasoning: 0 },
					}
					if (finished)
						return Stream.make(
							Response.makePart("finish", { reason: "stop", usage }),
						)
					const tool = tools.find((entry) =>
						entry.description?.includes(" / Feedback2Platform."),
					)
					assert.ok(
						tool,
						"Native discovery must expose the actual Feedback2Platform binding to the model",
					)
					emittedCalls++
					return Stream.make(
						Response.makePart("tool-call", {
							id: "feedback-call-" + emittedCalls,
							name: tool.name,
							params: report,
							providerExecuted: false,
						}),
						Response.makePart("finish", { reason: "tool-calls", usage }),
					)
				},
			}),
		)
		const network = (owner) =>
			NodeHttpServer.layerUserNetwork({
				owner,
				allowedOrigins: [remote.ipOrigin],
				allowAddress: (ip) => ip === "127.0.0.1",
				ca: remote.ca,
			})
		const host = await run(
			BrowserHost.start({
				publicOrigin: remote.ipOrigin,
				platformAdmins: ["feedback-admin@example.com"],
				bots: { memory: false },
				model,
				appProbe: Probe.layerWithNetwork((connection) =>
					network(connection.owner),
				),
				appNetwork: Layer.succeed(AppNetwork, {
					layer: (owner) => network(owner),
				}),
			}),
		)
		const admin = await run(host.login("feedback-admin"))
		const member = await run(host.login("feedback-member"))
		const coreOrigin = await run(host.address)
		const postgres = await startDatabase()
		cleanup.push(() => postgres.close())
		const pool = new Pool({ connectionString: postgres.url })
		cleanup.push(() => pool.end())
		for (const file of [
			"001_business.sql",
			"002_chat_automations.sql",
			"003_membership.sql",
			"004_basic_compute.sql",
			"005_compute_activity.sql",
			"006_feedback.sql",
		])
			await pool.query(
				await readFile(
					new URL("../migrations/" + file, import.meta.url),
					"utf8",
				),
			)
		const config = fromEnvironment({
			KAY_PUBLIC_ORIGIN: remote.ipOrigin,
			KAY_OPENBOT_ORIGIN: coreOrigin,
			KAY_DATABASE_URL: postgres.url,
			KAY_INTERNAL_TOKEN:
				"native-feedback-fixture-private-key-at-least-32-characters",
			KAY_TARGET_ORGANIZATION_ID: member.identity.organizationId,
			KAY_AUTH_BACKEND: "openbot",
			KAY_BACKEND_ROUTING: "native",
			KAY_NEXT_ENABLED: "true",
		})
		const db = runtime(config)
		cleanup.push(() => db.dispose())
		const nativeFailures = []
		const nativeFactory = createNativeClient({ origin: coreOrigin })
		const gateway = createGateway({
			config,
			db,
			nativeProduct: (input) => {
				const client = nativeFactory(input)
				return {
					request: async (call) => {
						const response = await client.request(call)
						if (!response.ok)
							nativeFailures.push({
								operation: call.operation,
								id: call.id,
								status: response.status,
								error: await response.clone().text(),
							})
						return response
					},
				}
			},
		})
		cleanup.push(async () => {
			gateway.closeAllConnections()
			await new Promise((resolve, reject) =>
				gateway.close((error) => (error ? reject(error) : resolve())),
			)
		})
		gateway.listen(0, "127.0.0.1")
		await once(gateway, "listening")
		gatewayOrigin = `http://127.0.0.1:${gateway.address().port}`
		const request = (path, method = "GET", payload, identity = member) =>
			fetch(gatewayOrigin + "/api/kay/v1" + path, {
				method,
				headers: {
					cookie: Caller.sessionCookie(identity.session),
					origin: remote.ipOrigin,
					...(payload === undefined
						? {}
						: { "content-type": "application/json" }),
				},
				...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
				redirect: "manual",
				signal: AbortSignal.timeout(20000),
			})
		const json = async (response) => {
			const text = await response.text()
			assert.ok(response.ok, `${response.status}: ${text}`)
			return text ? JSON.parse(text) : null
		}
		const product = async (path, method, payload, identity) =>
			json(await request(path, method, payload, identity))
		const feature = (id, input = {}, identity = member) =>
			product(
				"/features/" +
					encodeURIComponent(id) +
					"?input=" +
					encodeURIComponent(JSON.stringify(input)),
				"GET",
				undefined,
				identity,
			)
		const identity = (await product("/bootstrap")).identity
		const setup = await product("/default-bot", "POST", {
			userId: identity.userId,
			organizationId: identity.organizationId,
		})
		assert.equal(setup.phase, "ready")
		const connection = (await feature("connections.listConnections")).find(
			(row) => row.name === "Kay platform feedback",
		)
		assert.ok(
			connection,
			"Default Bot setup must create the native feedback connection: " +
				JSON.stringify({
					methods,
					discoveryResponses,
					proxyFailures,
					nativeFailures,
				}),
		)
		assert.equal(connection.cardUrl, "urn:openbot:manual:" + connection.id)
		assert.ok(
			!JSON.stringify(connection).includes("kay-feedback_"),
			"Native public connection views must not expose its credential",
		)
		const grants = await feature("bots.listGrants", {
			params: { botId: setup.botId },
		})
		const exact = (grant) =>
			grant.status === "active" &&
			grant.scope === "lifetime" &&
			grant.effect === "allow" &&
			grant.capability.action === "apps.call" &&
			grant.capability.target === connection.id + "/Feedback2Platform"
		assert.equal(grants.filter(exact).length, 1)
		await product("/default-bot", "POST", {
			userId: identity.userId,
			organizationId: identity.organizationId,
		})
		assert.equal(
			(await feature("connections.listConnections")).filter(
				(row) => row.name === connection.name,
			).length,
			1,
		)
		assert.equal(
			(
				await feature("bots.listGrants", { params: { botId: setup.botId } })
			).filter(exact).length,
			1,
		)
		assert.equal(
			methods.filter((method) => method === "tools/call").length,
			0,
			"Setup only discovers capabilities",
		)
		const chat = await product("/chats", "POST", {
			botId: setup.botId,
			requestId: randomUUID(),
		})
		for (let attempt = 0; attempt < 2; attempt++) {
			const receipt = await product(`/chats/${chat.id}/messages`, "POST", {
				input: "Report the local fixture error " + attempt,
				stream: false,
			})
			assert.equal(receipt.delivery, "accepted")
			await until("native feedback execution", async () => {
				const execution = await product("/executions/" + receipt.executionId)
				assert.ok(
					!["failed", "cancelled", "interrupted", "outcome_unknown"].includes(
						execution.status,
					),
					JSON.stringify(execution.failure),
				)
				return execution.status === "completed"
			})
		}
		assert.equal(emittedCalls, 2)
		assert.ok(discoveryResponses.length > 0)
		for (const discovery of discoveryResponses) {
			assert.equal(discovery.status, 200)
			assert.match(discovery.contentType, /application\/json/)
			const envelope = JSON.parse(discovery.body)
			assert.equal(envelope.jsonrpc, "2.0")
			assert.ok(
				envelope.result.supportedVersions.includes(Document.protocolVersion),
			)
			assert.ok(envelope.result.capabilities.tools)
		}
		assert.ok(
			methods.includes("tools/list"),
			"The native connector must list actual MCP tools",
		)
		assert.equal(methods.filter((method) => method === "tools/call").length, 2)
		const operations = await feature("appOperations.list", {
			params: { chatId: chat.id },
		})
		assert.equal(operations.length, 2)
		for (const operation of operations) {
			assert.equal(operation.status, "completed")
			assert.equal(
				operation.source.cardUrl,
				"urn:openbot:manual:" + connection.id,
			)
		}
		assert.equal(
			(await pool.query("SELECT count(*) FROM kay_feedback_reports")).rows[0]
				.count,
			"1",
		)
		assert.equal((await request("/admin/feedback")).status, 403)
		const inbox = await product(
			"/admin/feedback?status=open",
			"GET",
			undefined,
			admin,
		)
		assert.equal(inbox.items.length, 1)
		const stored = inbox.items[0]
		assert.equal(stored.accountId, identity.userId)
		assert.equal(stored.reportId, report.reportId)
		assert.equal(stored.source, "conversation_unknown")
		assert.deepEqual(stored.content, report)
		assert.equal((await request("/admin/feedback/" + stored.id)).status, 403)
		assert.equal(
			(
				await request("/admin/feedback/" + stored.id, "PATCH", {
					expected: stored.revision,
					status: "resolved",
				})
			).status,
			403,
		)
		const triaged = await product(
			"/admin/feedback/" + stored.id,
			"PATCH",
			{ expected: stored.revision, status: "triaged" },
			admin,
		)
		assert.equal(triaged.status, "triaged")
		assert.equal(triaged.updatedBy, admin.identity.userId)
		assert.equal(
			(await product("/admin/feedback/" + stored.id, "GET", undefined, admin))
				.status,
			"triaged",
		)
		t.diagnostic(
			"Verified real native discovery, exact grant, MCP call, idempotent database write and administrator inbox; deterministic local model, no production or paid provider.",
		)
	},
)
