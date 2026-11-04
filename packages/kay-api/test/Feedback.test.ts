import { createGateway } from "../src/Gateway.ts"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { test } from "node:test"
import { Pool } from "pg"
import { Schema } from "effect"
import * as Product from "@kaicom/kay-contracts"
import type { NativeClient } from "@kaicom/kay-contracts/Native"
import * as Document from "@kaicom/k/Document"
import { makeFeedback, FeedbackFailure } from "../src/Feedback.ts"
import { feedbackMcpPath } from "../src/FeedbackMcp.ts"
import { prepareFeedback } from "../src/FeedbackSetup.ts"
import { handleProductRequest } from "../src/ProductGateway.ts"
import { runtime } from "../src/Database.ts"
import { start } from "./PostgresTest.ts"

const owner = { accountId: "member-a", organizationId: "org-a", botId: "bot-a" }
const identity = {
	userId: owner.accountId,
	organizationId: owner.organizationId,
	displayName: "Member",
}
const report = (reportId = randomUUID()): Product.FeedbackInput => ({
	reportId,
	title: "The computer is unavailable",
	summary: "The task could not open its workspace.",
	expected: "The assistant should continue after reconnecting.",
	actual: "The workspace was unavailable.",
	steps: ["Ask for a presentation."],
	severity: "blocking",
	errorId: "error-example",
})

test(
	"platform feedback crosses the real MCP transport, persists once and reaches only the administrator inbox",
	{ timeout: 30000 },
	async (t) => {
		const postgres = await start()
		const pool = new Pool({ connectionString: postgres.url })
		const db = runtime({ databaseUrl: postgres.url })
		const feedback = makeFeedback({
			db,
			secret: "feedback-fixture-private-key-at-least-32-characters",
		})
		const gateway = createGateway({
			db,
			config: {
				databaseUrl: postgres.url,
				internalToken: "feedback-fixture-private-key-at-least-32-characters",
				port: 3100,
				internalPort: 3101,
				publicOrigin: "https://kay.example",
				openbotOrigin: "http://127.0.0.1:1",
				eOrigin: "http://127.0.0.1:1",
				authBackend: "openbot",
				backendRouting: "native",
				nextEnabled: true,
				openbotOrganizationId: owner.organizationId,
			},
		})

		let admin = true
		const native: NativeClient = {
			request: async (call) =>
				call.operation === "access"
					? Response.json({ adminConsole: admin })
					: Response.json({}, { status: 404 }),
		}
		const server = createServer((req, res) => {
			void (async () => {
				let body = ""
				for await (const chunk of req) body += chunk.toString()
				await handleProductRequest({
					req,
					res,
					url: new URL(req.url ?? "/", "https://kay.example"),
					payload: body === "" ? undefined : JSON.parse(body),
					client: native,
					identity,
					requestId: "fixture-request",
					db,
					epoch: 1,
					feedback: { service: feedback, origin: "https://kay.example" },
				})
			})().catch((error) => {
				res.statusCode = 500
				res.end(String(error))
			})
		})
		t.after(async () => {
			server.closeAllConnections()
			await new Promise<void>((resolve) => server.close(() => resolve()))
			gateway.closeAllConnections()
			await new Promise<void>((resolve) => gateway.close(() => resolve()))
			await db.dispose()
			await pool.end()
			await postgres.close()
		})
		for (const file of ["001_business.sql", "006_feedback.sql"])
			await pool.query(
				await readFile(
					new URL("../migrations/" + file, import.meta.url),
					"utf8",
				),
			)
		server.listen(0, "127.0.0.1")
		await once(server, "listening")
		const address = server.address()
		assert.ok(address !== null && typeof address !== "string")
		const base = "http://127.0.0.1:" + address.port
		gateway.listen(0, "127.0.0.1")
		await once(gateway, "listening")
		const gatewayAddress = gateway.address()
		assert.ok(gatewayAddress !== null && typeof gatewayAddress !== "string")
		const gatewayBase = "http://127.0.0.1:" + gatewayAddress.port
		const connection = await feedback.connection(owner)
		const token = feedback.credential(connection)
		const rpc = async (
			method: string,
			params: Schema.JsonObject = {},
			authorization = "Bearer " + token,
		) => {
			const response = await fetch(gatewayBase + feedbackMcpPath, {
				method: "POST",
				headers: {
					authorization,
					"content-type": "application/json",
					accept: "application/json, text/event-stream",
					"mcp-protocol-version": Document.protocolVersion,
					"mcp-method": method,
					...(typeof params["name"] === "string"
						? { "mcp-name": params["name"] }
						: {}),
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: randomUUID(),
					method,
					params: {
						_meta: {
							"io.modelcontextprotocol/protocolVersion":
								Document.protocolVersion,
							"io.modelcontextprotocol/clientCapabilities": {},
							"io.modelcontextprotocol/clientInfo": {
								name: "kay-feedback-test",
								version: "1.0.0",
							},
						},
						...params,
					},
				}),
			})
			const text = await response.text()
			return {
				status: response.status,
				value: response.ok ? JSON.parse(text.trim()) : text,
			}
		}
		const tools = await rpc("tools/list")
		assert.equal(tools.status, 200, JSON.stringify(tools.value))
		assert.equal(tools.value.result.tools[0].name, "Feedback2Platform")
		assert.equal((await rpc("tools/list", {}, "Bearer invalid")).status, 401)
		const input = report()
		const submit = () =>
			rpc("tools/call", { name: "Feedback2Platform", arguments: input })
		const first = await submit()
		assert.equal(first.status, 200)
		assert.equal(first.value.result.isError, false, JSON.stringify(first.value))
		const receipt = JSON.parse(first.value.result.content[0].text)
		const duplicate = await submit()
		assert.deepEqual(
			JSON.parse(duplicate.value.result.content[0].text),
			receipt,
		)
		assert.equal(
			(await pool.query("SELECT count(*) FROM kay_feedback_reports")).rows[0]
				.count,
			"1",
		)
		const invalid = await rpc("tools/call", {
			name: "Feedback2Platform",
			arguments: { ...input, userId: "other" },
		})
		assert.ok(invalid.value.error !== undefined || invalid.value.result.isError)
		const changed = await rpc("tools/call", {
			name: "Feedback2Platform",
			arguments: { ...input, title: "Different" },
		})
		assert.equal(changed.value.result.isError, true)
		const page = await fetch(base + "/api/kay/v1/admin/feedback?status=open")
		assert.equal(page.status, 200)
		const listed = Schema.decodeUnknownSync(Product.FeedbackPage)(
			await page.json(),
		)
		assert.equal(listed.items.length, 1)
		assert.equal(listed.items[0]?.accountId, owner.accountId)
		assert.equal(listed.items[0]?.source, "conversation_unknown")
		const patch = async (expected: number, status: string) =>
			fetch(base + "/api/kay/v1/admin/feedback/" + receipt.id, {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ expected, status }),
			})
		assert.equal((await patch(0, "triaged")).status, 200)
		assert.equal((await patch(0, "resolved")).status, 409)
		assert.equal((await patch(1, "resolved")).status, 200)
		assert.equal((await feedback.get(receipt.id)).updatedBy, identity.userId)
		admin = false
		assert.equal((await fetch(base + "/api/kay/v1/admin/feedback")).status, 403)
		assert.equal(
			(await fetch(base + "/api/kay/v1/admin/feedback/" + receipt.id)).status,
			403,
		)
		assert.equal((await patch(2, "open")).status, 403)
		const other = await feedback.connection({ ...owner, accountId: "member-b" })
		assert.notEqual(feedback.credential(other), token)
		const separate = await feedback.submit(other, input)
		assert.notEqual(separate.id, receipt.id)
		const secret = await feedback.submit(owner, {
			...report(),
			actual:
				"Authorization: Bearer fixture-private-token\napi_key=fixture-value\nCookie: session=private",
		})
		assert.doesNotMatch(
			(await feedback.get(secret.id)).content.actual,
			/fixture-private-token|fixture-value|session=private/,
		)
		await pool.query(
			"UPDATE kay_feedback_connections SET enabled=false WHERE account_id=$1",
			[owner.accountId],
		)
		assert.equal((await submit()).status, 401)
		await assert.rejects(
			feedback.submit(owner, { ...report(), title: "x".repeat(161) }),
		)
		await pool.query(
			"UPDATE kay_feedback_connections SET enabled=true WHERE account_id=$1",
			[owner.accountId],
		)
		for (let i = 0; i < 98; i++) await feedback.submit(owner, report())
		await assert.rejects(
			feedback.submit(owner, report()),
			(error) => error instanceof FeedbackFailure && error.status === 429,
		)
	},
)

test(
	"default Bot reporting setup reconciles lost grants and concurrent calls without duplicate writes",
	{ timeout: 30000 },
	async (t) => {
		const postgres = await start()
		const pool = new Pool({ connectionString: postgres.url })
		const db = runtime({ databaseUrl: postgres.url })
		t.after(async () => {
			await db.dispose()
			await pool.end()
			await postgres.close()
		})
		for (const file of ["001_business.sql", "006_feedback.sql"])
			await pool.query(
				await readFile(
					new URL("../migrations/" + file, import.meta.url),
					"utf8",
				),
			)
		const feedback = makeFeedback({
			db,
			secret: "feedback-fixture-private-key-at-least-32-characters",
		})
		const connections = new Map<string, Schema.JsonObject>()
		const grants: Schema.JsonObject[] = []
		const rules: Schema.JsonObject[] = []
		let grantCalls = 0,
			ruleCalls = 0,
			loseGrant = true,
			hideGrant = false,
			sends = 0,
			discoveryFails = false
		const ruleEntered = Promise.withResolvers<void>(),
			releaseRule = Promise.withResolvers<void>()
		const client: NativeClient = {
			request: async (call) => {
				if (call.operation === "bots")
					return Response.json([
						{
							id: owner.botId,
							owner: { _tag: "Member", userId: owner.accountId },
						},
					])
				if (call.operation === "memberSettings")
					return discoveryFails
						? Response.json({}, { status: 503 })
						: Response.json({ defaultBot: owner.botId })
				if (call.operation === "sendToBot") {
					sends++
					return Response.json(
						{
							delivery: "started",
							chat: "chat-a",
							item: "item-a",
							turn: "turn-a",
							response: null,
						},
						{ status: 202 },
					)
				}
				const body = Schema.decodeUnknownSync(Schema.JsonObject)(call.payload)
				const payload =
					body["payload"] === undefined
						? {}
						: Schema.decodeUnknownSync(Schema.JsonObject)(body["payload"])
				if (call.id === "connections.getConnection") {
					const params = Schema.decodeUnknownSync(Schema.JsonObject)(
						body["params"],
					)
					const found = connections.get(String(params["connectionId"]))
					return Response.json(found ?? {}, {
						status: found === undefined ? 404 : 200,
					})
				}
				if (call.id === "connections.createManualConnection") {
					assert.equal(payload["url"], "https://kay.example" + feedbackMcpPath)
					connections.set(String(payload["id"]), payload)
					return Response.json(payload)
				}
				if (call.id === "bots.listGrants")
					return Response.json(hideGrant ? [] : grants)
				if (call.id === "bots.listRules") return Response.json(rules)
				if (call.id === "bots.createGrant") {
					grantCalls++
					const grant = { ...payload, id: "grant-a", status: "active" }
					grants.push(grant)
					if (loseGrant) throw new Error("The response was lost after commit")
					return Response.json(grant)
				}
				if (call.id === "bots.createRule") {
					ruleCalls++
					ruleEntered.resolve()
					await releaseRule.promise
					const rule = { ...payload, id: "rule-a", status: "active" }
					rules.push(rule)
					return Response.json(rule)
				}
				assert.fail("Unexpected setup operation: " + call.id)
			},
		}
		const setup = () =>
			prepareFeedback({
				feedback,
				db,
				client,
				identity,
				epoch: 1,
				origin: "https://kay.example",
				botId: owner.botId,
			})
		const gateway = createServer((req, res) => {
			void handleProductRequest({
				req,
				res,
				url: new URL(req.url ?? "/", "https://kay.example"),
				payload: {
					input: "Please make a presentation.",
					memory: { read: true, write: true },
				},
				client,
				identity,
				requestId: "message-a",
				db,
				epoch: 1,
				feedback: { service: feedback, origin: "https://kay.example" },
			})
		})
		gateway.listen(0, "127.0.0.1")
		await once(gateway, "listening")
		const address = gateway.address()
		assert.ok(address !== null && typeof address !== "string")
		try {
			const sent = await fetch(
				"http://127.0.0.1:" +
					address.port +
					"/api/kay/v1/bots/" +
					owner.botId +
					"/messages",
				{ method: "POST" },
			)
			assert.equal(sent.status, 202, await sent.text())
			assert.equal(sends, 1)
			discoveryFails = true
			const stillSent = await fetch(
				"http://127.0.0.1:" +
					address.port +
					"/api/kay/v1/bots/" +
					owner.botId +
					"/messages",
				{ method: "POST" },
			)
			assert.equal(stillSent.status, 202, await stillSent.text())
			assert.equal(sends, 2)
			discoveryFails = false

			assert.equal(grantCalls, 1)
		} finally {
			gateway.closeAllConnections()
			await new Promise<void>((resolve) => gateway.close(() => resolve()))
		}
		hideGrant = true
		loseGrant = false
		assert.equal(await setup(), false)
		assert.equal(grantCalls, 1)
		hideGrant = false
		const finishing = setup()
		await ruleEntered.promise
		assert.equal(await setup(), false)
		assert.equal(ruleCalls, 1)
		releaseRule.resolve()
		assert.equal(await finishing, true)
		assert.equal(ruleCalls, 1)
		assert.ok((await Promise.all([setup(), setup()])).every(Boolean))
		assert.equal(grantCalls, 1)
		assert.equal(ruleCalls, 1)
		assert.equal(connections.size, 1)
		const connection = await feedback.connection(owner)
		assert.equal(grants[0]?.["capability"] !== undefined, true)
		assert.deepEqual(grants[0]?.["capability"], {
			action: "apps.call",
			target: connection.connectionId + "/Feedback2Platform",
		})
		assert.equal(
			await prepareFeedback({
				feedback,
				db,
				client,
				identity: { ...identity, userId: "other" },
				epoch: 1,
				origin: "https://kay.example",
				botId: owner.botId,
			}),
			false,
		)
	},
)
