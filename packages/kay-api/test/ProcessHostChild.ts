// Test-only processes keep server work out of the benchmark client's event loop.
import assert from "node:assert/strict"
import { once } from "node:events"
import type { Server } from "node:http"
import { resolve } from "node:path"
import { monitorEventLoopDelay, PerformanceObserver } from "node:perf_hooks"
import { pathToFileURL } from "node:url"
import { Pool } from "pg"
import { Match } from "effect"
import type { Configuration } from "../src/Configuration.ts"
import { runtime } from "../src/Database.ts"
import { createExecutionAuthority } from "../src/ExecutionAuthority.ts"
import { createGateway } from "../src/Gateway.ts"
import { makeTelemetry } from "../src/Telemetry.ts"
import { closeAll } from "./ProcessHost.ts"
import type {
	GatewayProcessStats,
	OpenBotProcessOptions,
	OpenBotProcessReady,
	OpenBotProcessStats,
} from "./ProcessHost.ts"

const now = () => performance.timeOrigin + performance.now()
const cleanup: Array<() => Promise<void>> = []
const eventLoop = monitorEventLoopDelay({ resolution: 10 })
const gc: Array<{ startUnixMs: number; duration: number }> = []
const observer = new PerformanceObserver((list) => {
	for (const entry of list.getEntries())
		gc.push({
			startUnixMs: performance.timeOrigin + entry.startTime,
			duration: entry.duration,
		})
})
observer.observe({ entryTypes: ["gc"] })
eventLoop.enable()
const diagnostics = () => ({
	pid: process.pid,
	eventLoop: { p95: eventLoop.percentile(95) / 1e6, max: eventLoop.max / 1e6 },
	gc,
	heapUsed: process.memoryUsage().heapUsed,
})
const listen = async (server: Server) => {
	server.listen(0, "127.0.0.1")
	await once(server, "listening")
	const address = server.address()
	assert.ok(address !== null && typeof address !== "string")
	return `http://127.0.0.1:${address.port}`
}
const closeServer = async (server: Server) => {
	server.closeAllConnections()
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error === undefined ? resolve() : reject(error))),
	)
}
let stopping: Promise<void> | undefined
const stop = () =>
	(stopping ??= (async () => {
		observer.disconnect()
		eventLoop.disable()
		await closeAll(cleanup)
	})())

let getStats: (() => OpenBotProcessStats | GatewayProcessStats) | undefined
let inspectSend = true
let configureOpenBot:
	((address: string, organizationId: string) => Promise<string>) | undefined

const startGateway = async ({ config }: { config: Configuration }) => {
	const db = runtime(config)
	cleanup.push(() => db.dispose())
	const pool = new Pool({ connectionString: config.databaseUrl })
	cleanup.push(() => pool.end())
	const authority = createExecutionAuthority({ config, runtime: db })
	const gates = new Map<string, number>()
	const authorityTimings = new Map<string, number[]>()
	const sendLeases = new Map<string, { accountId: string; epoch: number }>()
	// Observe real authority responses. No request or authority decision is mocked.
	authority.on("request", (request, response) => {
		if (request.url === "/__fixture/send-proof") return
		const started = performance.now()
		const chunks: Buffer[] = []
		let reply = ""
		const end = response.end.bind(response)
		response.end = ((...args: Parameters<typeof response.end>) => {
			if (typeof args[0] === "string") reply = args[0]
			return end(...args)
		}) as typeof response.end
		request.on("data", (chunk: Buffer) => chunks.push(chunk))
		response.once("finish", () => {
			if (response.statusCode !== 200 || chunks.length === 0) return
			const input: {
				intent?: string
				accountId: string
				epoch: number
				leaseId?: string
			} = JSON.parse(Buffer.concat(chunks).toString("utf8"))
			const key = `${request.url ?? ""}:${input.intent ?? ""}`
			gates.set(key, (gates.get(key) ?? 0) + 1)
			const values = authorityTimings.get(key) ?? []
			values.push(performance.now() - started)
			authorityTimings.set(key, values)
			if (
				request.url === "/internal/execution/acquire" &&
				input.intent === "send"
			) {
				const result: { allowed: boolean; leaseId?: string } = JSON.parse(reply)
				if (result.allowed && result.leaseId !== undefined)
					sendLeases.set(result.leaseId, {
						accountId: input.accountId,
						epoch: input.epoch,
					})
			}
			if (
				request.url === "/internal/execution/release" &&
				input.leaseId !== undefined
			)
				sendLeases.delete(input.leaseId)
		})
	})
	// The two functional Turns prove the send lease while the provider is running.
	// Sampling disables this extra probe; all production authority routes are unchanged.
	const handlers = authority.listeners("request")
	authority.removeAllListeners("request")
	authority.on("request", (request, response) => {
		if (request.url !== "/__fixture/send-proof") {
			for (const handler of handlers) handler.call(authority, request, response)
			return
		}
		void (async () => {
			if (request.headers.authorization !== `Bearer ${config.internalToken}`) {
				response.writeHead(401).end()
				return
			}
			const chunks: Buffer[] = []
			for await (const chunk of request) chunks.push(Buffer.from(chunk))
			const input: { accountId: string; epoch: number } = JSON.parse(
				Buffer.concat(chunks).toString("utf8"),
			)
			const send = [...sendLeases].find(
				([, lease]) =>
					lease.accountId === input.accountId && lease.epoch === input.epoch,
			)
			const rows =
				send === undefined
					? []
					: (
							await pool.query(
								"SELECT account_id,epoch::int FROM kay_migration_write_leases WHERE request_id=$1",
								[send[0]],
							)
						).rows
			const verified =
				rows.length === 1 &&
				rows[0].account_id === input.accountId &&
				rows[0].epoch === input.epoch
			response
				.writeHead(200, { "content-type": "application/json" })
				.end(JSON.stringify({ verified }))
		})().catch(() => response.writeHead(500).end())
	})
	const internalOrigin = await listen(authority)
	cleanup.push(() => closeServer(authority))
	const observations: Array<{ name: string; value: number; atUnixMs: number }> =
		[]
	const telemetry = makeTelemetry({
		onObservation: (name, value) =>
			observations.push({ name, value, atUnixMs: now() }),
	})
	let configured = false
	configureOpenBot = async (address, organizationId) => {
		assert.equal(
			configured,
			false,
			"The runtime address is configured once before sampling",
		)
		configured = true
		const gateway = createGateway({
			config: {
				...config,
				openbotOrigin: address,
				openbotOrganizationId: organizationId,
			},
			db,
			telemetry,
		})
		const origin = await listen(gateway)
		cleanup.push(() => closeServer(gateway))
		return origin
	}
	getStats = () => ({
		...diagnostics(),
		gates: Object.fromEntries(gates),
		authorityTimings: Object.fromEntries(authorityTimings),
		observations,
	})
	return { pid: process.pid, internalOrigin }
}

const startOpenBot = async (
	options: OpenBotProcessOptions,
): Promise<OpenBotProcessReady> => {
	const openbot = (file: string) =>
		import(pathToFileURL(resolve(options.sourceDir, file)).href)
	const BrowserHost = await openbot("packages/openbot/test/BrowserHost.ts")
	const { Effect, Stream, Redacted } = await openbot(
		"packages/openbot/node_modules/effect/dist/index.js",
	)
	const { LanguageModel, Response: ModelResponse } = await openbot(
		"packages/openbot/node_modules/effect/dist/ai/index.js",
	)
	const { CurrentExecution } = await openbot(
		"packages/openbot/dist/execution/ExecutionFence.js",
	)
	let sends = 0
	let verifiedSendLeases = 0
	const modelMarks: Array<{ startUnixMs: number; deltaUnixMs: number }> = []
	const usage = {
		inputTokens: { total: 1, uncached: 1, cacheRead: 0, cacheWrite: 0 },
		outputTokens: { total: 1, text: 1, reasoning: 0 },
	}
	const model = await Effect.runPromise(
		LanguageModel.make({
			generateText: () =>
				Effect.succeed([
					ModelResponse.makePart("text", { text: '{"changes":[]}' }),
				]),
			streamText: () =>
				Stream.unwrap(
					Effect.gen(function* () {
						const mark = { startUnixMs: now(), deltaUnixMs: 0 }
						modelMarks.push(mark)
						const lease = yield* CurrentExecution
						assert.ok(lease !== undefined)
						assert.equal(lease.backend, "openbot")
						sends++
						if (inspectSend) {
							const proof = yield* Effect.promise(async () => {
								const response = await fetch(
									options.execution.origin + "/__fixture/send-proof",
									{
										method: "POST",
										headers: {
											authorization: `Bearer ${options.execution.token}`,
											"content-type": "application/json",
										},
										body: JSON.stringify({
											accountId: lease.accountId,
											epoch: lease.epoch,
										}),
									},
								)
								assert.equal(response.status, 200)
								return response.json()
							})
							assert.equal(
								proof.verified,
								true,
								"The provider must hold a real, durable send lease",
							)
							verifiedSendLeases++
						}
						return Stream.make(
							ModelResponse.makePart("text-start", { id: "answer" }),
						).pipe(
							Stream.concat(
								Stream.fromEffect(
									Effect.sleep("25 millis").pipe(
										Effect.tap(() =>
											Effect.sync(() => {
												mark.deltaUnixMs = now()
											}),
										),
										Effect.as(
											ModelResponse.makePart("text-delta", {
												id: "answer",
												delta: "Fenced reply 🌍",
											}),
										),
									),
								),
							),
							Stream.concat(
								Stream.make(
									ModelResponse.makePart("text-end", { id: "answer" }),
									ModelResponse.makePart("finish", { reason: "stop", usage }),
								),
							),
						)
					}),
				),
		}),
	)
	const host = await BrowserHost.start({
		publicOrigin: options.publicOrigin,
		model,
		execution: {
			...options.execution,
			token: Redacted.make(options.execution.token),
		},
		authCompatibility: {
			sessionCookie: "__Host-e-session",
			loginCookie: "__Host-e-login",
			callbackPath: "/auth/callback",
			providerId: "kai",
		},
	})
	cleanup.push(() => host.close())
	const account = await host.login("fenced-account")
	getStats = () => ({ ...diagnostics(), sends, verifiedSendLeases, modelMarks })
	return {
		pid: process.pid,
		address: host.address,
		databaseUrl: host.databaseUrl,
		account: {
			userId: account.identity.userId,
			organizationId: account.identity.organizationId,
			session: Redacted.value(account.session),
		},
	}
}

process.on(
	"message",
	(message: { id: number; operation: string; input: unknown }) => {
		void (async () => {
			const value = await Match.value(message.operation).pipe(
				Match.when("openbot", () =>
					startOpenBot(message.input as OpenBotProcessOptions),
				),
				Match.when("gateway", () =>
					startGateway(message.input as { config: Configuration }),
				),
				Match.when("configureOpenBot", () => {
					assert.ok(configureOpenBot !== undefined)
					return configureOpenBot(
						(message.input as { address: string }).address,
						(message.input as { organizationId: string }).organizationId,
					)
				}),
				Match.when("stats", () => {
					assert.ok(getStats !== undefined)
					return getStats()
				}),
				Match.when("inspectSend", () => {
					assert.equal(typeof message.input, "boolean")
					inspectSend = message.input as boolean
				}),
				Match.when("close", stop),
				Match.orElse(() => {
					throw new Error("Unknown fixture operation")
				}),
			)
			process.send?.({ id: message.id, value })
		})().catch((error: unknown) => {
			process.send?.({
				id: message.id,
				error:
					error instanceof Error ? error.message : "Fixture request failed",
			})
		})
	},
)
process.once("disconnect", () => {
	void stop().then(
		() => process.exit(0),
		() => process.exit(1),
	)
})
process.once("SIGTERM", () => {
	void stop().then(
		() => process.exit(0),
		() => process.exit(1),
	)
})
