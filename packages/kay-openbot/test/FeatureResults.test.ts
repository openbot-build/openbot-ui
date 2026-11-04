import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer } from "node:http"
import { test } from "node:test"
import * as Api from "@openbot-build/client/Api"
import { createNativeClient } from "../src/index.ts"

const fixture = async (responses: Record<string, unknown>) => {
	const requests: Array<{ path: string; method: string; body: unknown }> = []
	const server = createServer(async (req, res) => {
		const path = req.url ?? ""
		const chunks = []
		for await (const chunk of req) chunks.push(chunk)
		const body = Buffer.concat(chunks).toString()
		requests.push({
			path,
			method: req.method ?? "",
			body: body === "" ? null : JSON.parse(body),
		})
		const value = responses[path]
		res.writeHead(value === undefined ? 403 : 200, {
			"content-type": "application/json",
		})
		res.end(JSON.stringify(value === undefined ? {} : value))
	})
	server.listen(0, "127.0.0.1")
	await once(server, "listening")
	const address = server.address()
	if (address === null || typeof address === "string")
		throw new Error("Expected address")
	return {
		requests,
		client: createNativeClient({ origin: `http://127.0.0.1:${address.port}` })({
			headers: new Headers({ cookie: "session=owner" }),
			signal: new AbortController().signal,
		}),
		close: async () => {
			server.closeAllConnections()
			await new Promise<void>((resolve) => server.close(() => resolve()))
		},
	}
}
const execution = (kind: string, status = "completed", id = "resource-a") => ({
	id: "execution-a",
	resource: { kind, id },
	status,
	sequence: 4,
	createdAt: 1,
	updatedAt: 2,
	failure: null,
})

test("feature results read the authorized native resource and never replay a command", async () => {
	const responses: Record<string, unknown> = {
		"/v1/executions/execution-a": execution("Computer", "running"),
		"/v1/computers/resource-a": {
			id: "resource-a",
			name: "My computer",
			status: "running",
		},
	}
	const f = await fixture(responses)
	try {
		const call = {
			operation: "featureResult" as const,
			id: "execution-a",
			query: { operation: "computers.createComputer" },
		}
		assert.equal((await (await f.client.request(call)).json()).pending, true)
		assert.equal(f.requests.length, 1)
		responses["/v1/executions/execution-a"] = execution("Computer")
		const completed = await (await f.client.request(call)).json()
		assert.equal(completed.pending, false)
		assert.equal(completed.result.id, "resource-a")
		assert.ok(f.requests.every((request) => request.method === "GET"))
	} finally {
		await f.close()
	}
})

test("approval result is available before the approved external operation finishes", async () => {
	const f = await fixture({
		"/v1/executions/execution-a": execution("Request", "running"),
		"/v1/requests/resource-a": {
			id: "resource-a",
			status: "allowed",
			executionStatus: "running",
		},
	})
	try {
		const value = await (
			await f.client.request({
				operation: "featureResult",
				id: "execution-a",
				query: { operation: "requests.resolveRequest" },
			})
		).json()
		assert.equal(value.pending, false)
		assert.equal(value.result.status, "allowed")
		assert.equal(f.requests.length, 2)
	} finally {
		await f.close()
	}
})

test("OAuth results keep the native return destination without retaining OAuth input", async () => {
	const f = await fixture({
		"/v1/executions/execution-a": execution("AppAuthorization"),
		"/v1/app-authorization-actions/execution-a": {
			result: {
				_tag: "AuthorizationStarted",
				flowId: "flow-a",
				authorizationUrl: "https://identity.example/authorize",
			},
		},
		"/v1/app-authorizations/flow-a": {
			flowId: "flow-a",
			returnTo: "/apps?returnTo=%2F",
		},
	})
	try {
		const value = await (
			await f.client.request({
				operation: "featureResult",
				id: "execution-a",
				query: { operation: "appAuthorization.beginAppAuthorization" },
			})
		).json()
		assert.equal(value.result.returnTo, "/apps?returnTo=%2F")
		assert.equal(value.result.flowId, "flow-a")
		assert.ok(
			f.requests.every(
				(request) => request.method === "GET" && request.body === null,
			),
		)
	} finally {
		await f.close()
	}
})

test("unknown results and unapproved work remain actionable, never successful", async () => {
	const responses: Record<string, unknown> = {
		"/v1/executions/execution-a": execution("Computer", "outcome_unknown"),
	}
	const f = await fixture(responses)
	try {
		const call = {
			operation: "featureResult" as const,
			id: "execution-a",
			query: { operation: "computers.createComputer" },
		}
		const unknown = await f.client.request(call)
		assert.equal(unknown.status, 409)
		assert.equal((await unknown.json()).code, "outcome_unknown")
		responses["/v1/executions/execution-a"] = execution("Computer", "waiting")
		responses["/v1/executions/execution-a/events?afterSequence=0"] = {
			events: [
				{
					executionId: "execution-a",
					sequence: 4,
					createdAt: 1,
					body: { _tag: "State", status: "waiting", failure: null },
				},
			],
			afterSequence: 4,
			terminal: false,
		}
		assert.equal((await f.client.request(call)).status, 409)
		responses["/v1/executions/execution-a"] = {
			...execution("Computer", "waiting"),
			sequence: 3,
		}
		responses["/v1/executions/execution-a/events?afterSequence=0"] = {
			events: [
				{
					executionId: "execution-a",
					sequence: 3,
					createdAt: 1,
					body: {
						_tag: "DecisionMade",
						decisionId: "approval",
						answer: "allow",
					},
				},
			],
			afterSequence: 3,
			terminal: false,
		}
		assert.equal((await (await f.client.request(call)).json()).pending, true)
	} finally {
		await f.close()
	}
})

test("execution permissions and resource kinds are checked before reading business objects", async () => {
	const responses: Record<string, unknown> = {}
	const f = await fixture(responses)
	try {
		const call = {
			operation: "featureResult" as const,
			id: "execution-a",
			query: { operation: "computers.createComputer" },
		}
		assert.equal((await f.client.request(call)).status, 403)
		responses["/v1/executions/execution-a"] = execution("AppConnection")
		assert.equal((await f.client.request(call)).status, 400)
		assert.ok(
			f.requests.every(
				(request) => request.path === "/v1/executions/execution-a",
			),
		)
	} finally {
		await f.close()
	}
})

test("queued input recovery follows only InputMoved and never a child tool execution", async () => {
	const responses: Record<string, unknown> = {
		"/v1/executions/execution-a": { ...execution("Chat"), sequence: 3 },
		"/v1/executions/execution-a/events?afterSequence=0": {
			events: [
				{
					executionId: "execution-a",
					sequence: 2,
					createdAt: 1,
					body: {
						_tag: "InputMoved",
						executionId: "turn-execution",
						items: ["input-a"],
					},
				},
				{
					executionId: "execution-a",
					sequence: 3,
					createdAt: 1,
					body: {
						_tag: "ChildExecution",
						executionId: "tool-execution",
						step: "tool",
					},
				},
			],
			afterSequence: 3,
			terminal: true,
		},
	}
	const f = await fixture(responses)
	try {
		const view = await (
			await f.client.request({ operation: "execution", id: "execution-a" })
		).json()
		assert.equal(view.forwardedTo, "turn-execution")
		responses["/v1/executions/execution-a"] = execution("Turn")
		f.requests.length = 0
		const turn = await (
			await f.client.request({ operation: "execution", id: "execution-a" })
		).json()
		assert.equal(turn.forwardedTo, undefined)
		assert.equal(f.requests.length, 1)
	} finally {
		await f.close()
	}
})

test("a finished Turn follows only its command's moved inputs, including after failure or cancellation", async () => {
	const receiptPath =
		Api.OpenBotApi.groups.executions.endpoints.receipt.path.replace(
			":commandKey",
			"my-key",
		)
	const responses: Record<string, unknown> = {
		"/v1/executions/execution-a": execution("Turn"),
		[receiptPath]: {
			executionId: "execution-a",
			commandKey: "my-key",
			sequence: 1,
			inputItems: ["my-input"],
		},
		"/v1/executions/execution-a/events?afterSequence=0": {
			events: [
				{
					executionId: "execution-a",
					sequence: 2,
					createdAt: 1,
					body: {
						_tag: "InputMoved",
						executionId: "my-turn",
						items: ["my-input"],
					},
				},
				{
					executionId: "execution-a",
					sequence: 3,
					createdAt: 1,
					body: {
						_tag: "InputMoved",
						executionId: "other-turn",
						items: ["someone-else"],
					},
				},
			],
			afterSequence: 3,
			terminal: true,
		},
	}
	const f = await fixture(responses)
	try {
		const call = {
			operation: "execution" as const,
			id: "execution-a",
			query: { commandKey: "my-key" },
		}
		for (const status of ["completed", "interrupted", "failed", "cancelled"]) {
			responses["/v1/executions/execution-a"] = {
				...execution("Turn", status),
				sequence: 3,
			}
			responses[receiptPath] = {
				executionId: "execution-a",
				commandKey: "my-key",
				sequence: 1,
				inputItems: ["my-input"],
			}
			assert.equal(
				(await (await f.client.request(call)).json()).forwardedTo,
				"my-turn",
				status,
			)
			responses[receiptPath] = null
			assert.equal(
				(await (await f.client.request(call)).json()).forwardedTo,
				undefined,
				status,
			)
		}
		assert.ok(f.requests.every((request) => request.method === "GET"))
		delete responses[receiptPath]
		assert.equal((await f.client.request(call)).status, 403)
	} finally {
		await f.close()
	}
})

const savedEvent = (sequence: number, body: unknown) => ({
	executionId: "execution-a",
	sequence,
	createdAt: 1,
	body,
})
const firstEventPage = () => ({
	events: Array.from({ length: 128 }, (_, index) =>
		savedEvent(index + 1, { _tag: "Wake", key: `step-${index}` }),
	),
	afterSequence: 128,
	terminal: false,
})

test("moved input beyond the first event page is recovered only through the saved revision", async () => {
	const f = await fixture({
		"/v1/executions/execution-a": {
			...execution("Turn", "failed"),
			sequence: 130,
		},
		"/v1/execution-commands/my-key": {
			executionId: "execution-a",
			commandKey: "my-key",
			sequence: 1,
			inputItems: ["my-input"],
		},
		"/v1/executions/execution-a/events?afterSequence=0": firstEventPage(),
		"/v1/executions/execution-a/events?afterSequence=128": {
			events: [
				savedEvent(129, {
					_tag: "InputMoved",
					executionId: "my-turn",
					items: ["my-input"],
				}),
				savedEvent(130, { _tag: "State", status: "failed", failure: null }),
				savedEvent(131, {
					_tag: "InputMoved",
					executionId: "future-turn",
					items: ["my-input"],
				}),
			],
			afterSequence: 131,
			terminal: false,
		},
	})
	try {
		const response = await f.client.request({
			operation: "execution",
			id: "execution-a",
			query: { commandKey: "my-key" },
		})
		assert.equal(response.status, 200)
		assert.equal((await response.json()).forwardedTo, "my-turn")
		assert.deepEqual(
			f.requests
				.filter((request) => request.path.includes("/events?"))
				.map((request) => request.path),
			[
				"/v1/executions/execution-a/events?afterSequence=0",
				"/v1/executions/execution-a/events?afterSequence=128",
			],
		)
		assert.ok(f.requests.every((request) => request.method === "GET"))
	} finally {
		await f.close()
	}
})

test("an answered decision on a later page stays pending without following later decisions", async () => {
	const first = firstEventPage()
	const responses: Record<string, unknown> = {
		"/v1/executions/execution-a": {
			...execution("Computer", "waiting"),
			sequence: 130,
		},
		"/v1/executions/execution-a/events?afterSequence=0": {
			...first,
			events: [
				...first.events.slice(0, 127),
				savedEvent(128, {
					_tag: "DecisionNeeded",
					decisionId: "approval",
					choices: ["allow", "deny"],
				}),
			],
		},
		"/v1/executions/execution-a/events?afterSequence=128": {
			events: [
				savedEvent(129, {
					_tag: "DecisionMade",
					decisionId: "approval",
					answer: "allow",
				}),
				savedEvent(130, { _tag: "Wake", key: "decision-recorded" }),
				savedEvent(131, {
					_tag: "DecisionNeeded",
					decisionId: "future",
					choices: ["retry", "stop"],
				}),
			],
			afterSequence: 131,
			terminal: false,
		},
	}
	const f = await fixture(responses)
	try {
		const response = await f.client.request({
			operation: "featureResult",
			id: "execution-a",
			query: { operation: "computers.createComputer" },
		})
		assert.equal(response.status, 200)
		assert.equal((await response.json()).pending, true)
		assert.equal(f.requests.length, 3)
		assert.ok(f.requests.every((request) => request.method === "GET"))
	} finally {
		await f.close()
	}
})

test("missing, repeated, foreign, or unauthorized event pages never resolve partial history", async () => {
	const responses: Record<string, unknown> = {
		"/v1/executions/execution-a": { ...execution("Chat"), sequence: 129 },
		"/v1/executions/execution-a/events?afterSequence=0": firstEventPage(),
	}
	const pagePath = "/v1/executions/execution-a/events?afterSequence=128"
	const f = await fixture(responses)
	try {
		const call = { operation: "execution" as const, id: "execution-a" }
		for (const page of [
			{ events: [], afterSequence: 128, terminal: true },
			{
				events: [savedEvent(128, { _tag: "Wake", key: "duplicate" })],
				afterSequence: 128,
				terminal: false,
			},
			{
				events: [
					{
						...savedEvent(129, {
							_tag: "InputMoved",
							executionId: "other",
							items: [],
						}),
						executionId: "foreign",
					},
				],
				afterSequence: 129,
				terminal: true,
			},
		]) {
			responses[pagePath] = page
			const before = f.requests.length
			const response = await f.client.request(call)
			assert.equal(response.status, 503)
			assert.equal((await response.json()).code, "unavailable")
			assert.equal(f.requests.length - before, 3)
		}
		delete responses[pagePath]
		assert.equal((await f.client.request(call)).status, 403)
		assert.ok(f.requests.every((request) => request.method === "GET"))
	} finally {
		await f.close()
	}
})

test("generated feature dispatch supplies hidden command keys in payloads and query", async () => {
	const f = await fixture({ "/v1/requests/request-a": {} })
	try {
		await f.client.request({
			operation: "feature",
			id: "requests.resolveRequest",
			payload: {
				params: { requestId: "request-a" },
				payload: { expected: 2, decision: "deny", commandKey: "stable-key" },
			},
		})
		assert.deepEqual(f.requests[0]?.body, {
			expected: 2,
			decision: "deny",
			commandKey: "stable-key",
		})
		await f.client.request({
			operation: "feature",
			id: "developer.deleteTest",
			payload: { params: { id: "test-a" } },
		})
		assert.match(
			f.requests[1]?.path ?? "",
			/^\/v1\/developer\/tests\/test-a\?commandKey=[0-9a-f-]{36}$/,
		)
		const catalog = await (
			await f.client.request({ operation: "featureCatalog" })
		).json()
		const approval = catalog.find(
			(entry: { id: string }) => entry.id === "requests.resolveRequest",
		)
		assert.equal(approval.resultMode, "execution")
		assert.equal(approval.payload.properties.commandKey, undefined)
	} finally {
		await f.close()
	}
})

test("every asynchronous feature reads its native business result instead of returning a receipt as success", async () => {
	const cases: Array<{
		operation: string
		kind: string
		reads?: Record<string, unknown>
		result: unknown
	}> = []
	const testState = {
		id: "resource-a",
		status: "Succeeded",
		authorization: null,
	}
	for (const operation of [
		"developer.runTest",
		"developer.cancelTest",
		"developer.authorizeTest",
		"developer.completeTestAuthorization",
	])
		cases.push({
			operation,
			kind: "DeveloperTest",
			reads: { "/v1/developer/tests/resource-a": testState },
			result: testState,
		})
	cases.push({
		operation: "developer.cleanupTest",
		kind: "DeveloperTestCleanup",
		reads: { "/v1/developer/tests/resource-a": testState },
		result: testState,
	})
	cases.push({
		operation: "developer.deleteTest",
		kind: "DeveloperTestCleanup",
		result: null,
	})
	for (const operation of ["developer.verifyClaim", "developer.verifyProof"])
		cases.push({
			operation,
			kind: "DeveloperProof",
			reads: {
				"/v1/developer/proofs/resource-a": {
					id: "resource-a",
					status: "Confirmed",
				},
			},
			result: { id: "resource-a", status: "Confirmed" },
		})
	const actionPath = "/v1/app-authorization-actions/execution-a"
	const started = {
		_tag: "AuthorizationStarted",
		flowId: "flow-a",
		authorizationUrl: "https://identity.example/authorize",
	}
	const state = { flowId: "flow-a", returnTo: "/apps", status: "Succeeded" }
	cases.push({
		operation: "appAuthorization.beginAppAuthorization",
		kind: "AppAuthorization",
		reads: {
			[actionPath]: { result: started },
			"/v1/app-authorizations/flow-a": state,
		},
		result: { ...started, returnTo: "/apps" },
	})
	cases.push({
		operation: "appAuthorization.completeAppAuthorization",
		kind: "AppAuthorization",
		reads: {
			[actionPath]: { result: { _tag: "Authorized", flowId: "flow-a" } },
			"/v1/app-authorizations/flow-a": state,
		},
		result: state,
	})
	cases.push({
		operation: "appAuthorization.revokeAppAuthorization",
		kind: "AppAuthorization",
		reads: { [actionPath]: { result: { _tag: "Revoked" } } },
		result: { _tag: "Revoked" },
	})
	for (const operation of ["chats.deleteChat", "chats.interruptChat"])
		cases.push({ operation, kind: "ChatControl", result: null })
	for (const operation of ["executions.cancel", "executions.decide"])
		cases.push({ operation, kind: "Computer", result: execution("Computer") })
	const delegation = { id: "resource-a", status: "Cancelled" }
	cases.push({
		operation: "delegations.cancelDelegation",
		kind: "Delegation",
		reads: { "/v1/delegations/resource-a": delegation },
		result: delegation,
	})
	const request = { id: "resource-a", status: "denied" }
	cases.push({
		operation: "requests.resolveRequest",
		kind: "Request",
		reads: { "/v1/requests/resource-a": request },
		result: request,
	})
	cases.push({
		operation: "channels.deleteChannel",
		kind: "ChannelRemoval",
		result: null,
	})
	const computer = { id: "resource-a", status: "running" }
	for (const operation of [
		"computers.createComputer",
		"computers.pauseComputer",
		"computers.resumeComputer",
	])
		cases.push({
			operation,
			kind: "Computer",
			reads: { "/v1/computers/resource-a": computer },
			result: computer,
		})
	cases.push({
		operation: "computers.deleteComputer",
		kind: "Computer",
		result: null,
	})
	const reminder = {
		id: "resource-a",
		chatId: "chat-a",
		turnId: "turn-a",
		executionId: "execution-a",
		note: "Check the saved presentation",
		dueAt: 1000,
		status: "cancelled",
	}
	cases.push({
		operation: "reminders.cancelReminder",
		kind: "Reminder",
		reads: { "/v1/reminders/resource-a": reminder },
		result: reminder,
	})
	const appOperation = { id: "resource-a", status: "Completed" }
	cases.push({
		operation: "appOperations.respond",
		kind: "AppCall",
		reads: { "/v1/app-operations/resource-a": appOperation },
		result: appOperation,
	})
	const reset = { execution: execution("AppReset"), connections: [] }
	cases.push({
		operation: "appExperience.reset",
		kind: "AppReset",
		reads: { "/v1/app-experience/resets/execution-a": reset },
		result: reset,
	})
	const connection = { id: "resource-a", revision: 3, enabled: true }
	for (const operation of [
		"connections.updateManualConnection",
		"connections.revalidateConnection",
		"connections.updateConnection",
	])
		cases.push({
			operation,
			kind: "AppConnection",
			reads: {
				"/v1/connections/resource-a/executions/execution-a": {
					result: { _tag: "Updated", connectionId: "resource-a", revision: 3 },
				},
				"/v1/connections/resource-a": connection,
			},
			result: connection,
		})
	const capabilities = {
		protocolVersion: "2025-03-26",
		tools: [],
		resources: [],
		resourceTemplates: [],
		prompts: [],
	}
	cases.push({
		operation: "connections.verifyConnection",
		kind: "AppConnection",
		reads: {
			"/v1/connections/resource-a/executions/execution-a": {
				result: {
					_tag: "Verified",
					connectionId: "resource-a",
					revision: 3,
					capabilities,
				},
			},
		},
		result: { _tag: "Verified", capabilities },
	})
	cases.push({
		operation: "connections.refreshConnectionAuthorization",
		kind: "AppAuthorization",
		reads: {
			[actionPath]: {
				result: { _tag: "Refreshed", connectionId: "resource-a" },
			},
			"/v1/connections/resource-a": connection,
		},
		result: connection,
	})
	cases.push({
		operation: "connections.deleteConnection",
		kind: "AppAuthorization",
		reads: {
			[actionPath]: { result: { _tag: "Removed", connectionId: "resource-a" } },
		},
		result: null,
	})
	const responses: Record<string, unknown> = {}
	const f = await fixture(responses)
	try {
		const catalog: Array<{ id: string; resultMode?: string }> = await (
			await f.client.request({ operation: "featureCatalog" })
		).json()
		assert.deepEqual(
			cases.map((entry) => entry.operation).sort(),
			catalog
				.filter((entry) => entry.resultMode === "execution")
				.map((entry) => entry.id)
				.sort(),
		)
		for (const scenario of cases) {
			for (const key of Object.keys(responses)) delete responses[key]
			Object.assign(responses, {
				"/v1/executions/execution-a": execution(scenario.kind),
				...scenario.reads,
			})
			f.requests.length = 0
			const response = await f.client.request({
				operation: "featureResult",
				id: "execution-a",
				query: { operation: scenario.operation },
			})
			assert.equal(response.status, 200, scenario.operation)
			const body = await response.json()
			assert.equal(body.pending, false, scenario.operation)
			assert.deepEqual(body.result, scenario.result, scenario.operation)
			assert.deepEqual(
				f.requests.map((request) => request.path),
				Object.keys(responses),
				scenario.operation,
			)
			assert.ok(
				f.requests.every((request) => request.method === "GET"),
				scenario.operation,
			)
		}
	} finally {
		await f.close()
	}
})

test("cancelled reminder receipts read the saved reminder and preserve permission failures", async () => {
	const reminder = {
		id: "resource-a",
		chatId: "chat-a",
		turnId: "turn-a",
		executionId: "execution-a",
		note: "Check the file",
		dueAt: 1000,
		status: "cancelled",
	}
	const responses: Record<string, unknown> = {
		"/v1/executions/execution-a": execution("Reminder", "cancelled"),
		"/v1/reminders/resource-a": reminder,
	}
	const f = await fixture(responses)
	const call = {
		operation: "featureResult" as const,
		id: "execution-a",
		query: { operation: "reminders.cancelReminder" },
	}
	try {
		const response = await f.client.request(call)
		assert.equal(response.status, 200)
		const value = await response.json()
		assert.equal(value.pending, false)
		assert.deepEqual(value.result, reminder)
		delete responses["/v1/reminders/resource-a"]
		assert.equal((await f.client.request(call)).status, 403)
		responses["/v1/executions/execution-a"] = execution("Computer", "cancelled")
		const before = f.requests.length
		assert.equal((await f.client.request(call)).status, 400)
		assert.equal(f.requests.length, before + 1)
		assert.ok(f.requests.every((request) => request.method === "GET"))
	} finally {
		await f.close()
	}
})
