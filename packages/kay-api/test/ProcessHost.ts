import { fork } from "node:child_process"
import type { Configuration } from "../src/Configuration.ts"

export interface ProcessDiagnostics {
	readonly pid: number
	readonly eventLoop: { readonly p95: number; readonly max: number }
	readonly gc: ReadonlyArray<{
		readonly startUnixMs: number
		readonly duration: number
	}>
	readonly heapUsed: number
}

export interface OpenBotProcessOptions {
	readonly sourceDir: string
	readonly publicOrigin: string
	readonly mode: "fencing"
	readonly execution: {
		readonly origin: string
		readonly token: string
		readonly backend: "openbot"
	}
	readonly ledgerDatabaseUrl: string
}

export interface OpenBotProcessStats extends ProcessDiagnostics {
	readonly sends: number
	readonly verifiedSendLeases: number
	readonly modelMarks: ReadonlyArray<{
		readonly startUnixMs: number
		readonly deltaUnixMs: number
	}>
}

export interface GatewayProcessStats extends ProcessDiagnostics {
	readonly gates: Readonly<Record<string, number>>
	readonly authorityTimings: Readonly<Record<string, ReadonlyArray<number>>>
	readonly observations: ReadonlyArray<{
		readonly name: string
		readonly value: number
		readonly atUnixMs: number
	}>
}

export interface OpenBotProcessReady {
	readonly pid: number
	readonly address: string
	readonly databaseUrl: string
	readonly account: {
		readonly userId: string
		readonly organizationId: string
		/** A disposable fixture credential, passed only over the private IPC channel. */
		readonly session: string
	}
}

/** A failed child must not prevent the other fixture resources from closing. */
export const closeAll = async (cleanup: ReadonlyArray<() => Promise<void>>) => {
	const errors: unknown[] = []
	for (const close of [...cleanup].reverse())
		try {
			await close()
		} catch (error) {
			errors.push(error)
		}
	if (errors.length > 0)
		throw new AggregateError(errors, "Fixture cleanup failed")
}

/** IPC configures the fixture and retrieves diagnostics; measured traffic uses HTTP. */
const startProcess = () => {
	const child = fork(new URL("./ProcessHostChild.ts", import.meta.url), [], {
		execArgv: [],
		stdio: ["ignore", "inherit", "inherit", "ipc"],
	})
	let serial = 0
	let closed = false
	let closing = false
	let exitFailure: Error | undefined
	const pending = new Map<
		number,
		{ resolve: (value: unknown) => void; reject: (error: Error) => void }
	>()
	let finishExit: (() => void) | undefined
	const exited = new Promise<void>((resolve) => {
		finishExit = resolve
		child.once("exit", (code, signal) => {
			closed = true
			const error = new Error(
				`Fixture process exited (${code ?? signal ?? "unknown"})`,
			)
			if (code !== 0 || signal !== null || !closing) exitFailure ??= error
			for (const request of pending.values())
				request.reject(exitFailure ?? error)
			pending.clear()
			resolve()
		})
	})
	child.on("error", (error) => {
		exitFailure ??= error
		for (const request of pending.values()) request.reject(error)
		pending.clear()
		if (child.pid === undefined) {
			closed = true
			finishExit?.()
		}
	})
	child.on(
		"message",
		(message: { id: number; value?: unknown; error?: string }) => {
			const request = pending.get(message.id)
			if (request === undefined) return
			pending.delete(message.id)
			if (message.error !== undefined) request.reject(new Error(message.error))
			else request.resolve(message.value)
		},
	)
	const call = async <A>(operation: string, input?: unknown): Promise<A> => {
		if (closed) throw exitFailure ?? new Error("The fixture process is closed")
		const id = ++serial
		let timer: NodeJS.Timeout | undefined
		try {
			return (await new Promise<unknown>((resolve, reject) => {
				pending.set(id, { resolve, reject })
				timer = setTimeout(() => {
					pending.delete(id)
					reject(new Error(`Fixture ${operation} exceeded 30 seconds`))
				}, 30000)
				child.send({ id, operation, input }, (error) => {
					if (error !== null) {
						pending.delete(id)
						reject(error)
					}
				})
			})) as A
		} finally {
			clearTimeout(timer)
		}
	}
	const close = async () => {
		if (closed) {
			if (exitFailure !== undefined) throw exitFailure
			return
		}
		closing = true
		try {
			await call<void>("close")
		} finally {
			if (child.connected) child.disconnect()
			let forced = false
			const timer = setTimeout(() => child.kill("SIGTERM"), 15000)
			const deadline = setTimeout(() => {
				forced = true
				child.kill("SIGKILL")
			}, 20000)
			try {
				await exited
			} finally {
				clearTimeout(timer)
				clearTimeout(deadline)
			}
			if (forced)
				throw new Error("Fixture cleanup required a forced process exit")
			if (exitFailure !== undefined) throw exitFailure
		}
	}
	return { call, close }
}

export const startOpenBotProcess = async (options: OpenBotProcessOptions) => {
	const process = startProcess()
	try {
		const ready = await process.call<OpenBotProcessReady>("openbot", options)
		return {
			...ready,
			stats: () => process.call<OpenBotProcessStats>("stats"),
			setInspectSend: (enabled: boolean) =>
				process.call<void>("inspectSend", enabled),
			close: process.close,
		}
	} catch (error) {
		await process.close()
		throw error
	}
}

export const startGatewayProcess = async (options: {
	readonly config: Configuration
}) => {
	const process = startProcess()
	try {
		const ready = await process.call<{ pid: number; internalOrigin: string }>(
			"gateway",
			options,
		)
		return {
			...ready,
			configureOpenBot: (input: {
				readonly address: string
				readonly organizationId: string
			}) => process.call<string>("configureOpenBot", input),
			stats: () => process.call<GatewayProcessStats>("stats"),
			close: process.close,
		}
	} catch (error) {
		await process.close()
		throw error
	}
}
