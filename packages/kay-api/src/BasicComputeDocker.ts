import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { lstat, mkdir, unlink } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import { startBasicComputeInternet } from "./BasicComputeInternet.ts"
import { basicComputeWorker } from "./BasicComputeWorker.ts"

export const basicComputeImage =
	"node:26.12.1-bookworm-slim@sha256:b3dbaf0531ffedead011f14afc779688202fc975f89d2cebf2a63e8beed89e8a"
export const basicComputeLimits = {
	inputBytes: 256 * 1024,
	outputBytes: 64 * 1024,
	commandMs: 120_000,
	fileReadBytes: 10 * 1024 * 1024,
} as const

export type LeaseRef = {
	readonly leaseId: string
	readonly containerName: string
	/** Set from the persistent creation ledger when recovering after a restart. */
	readonly creationUncertain?: boolean
}
export type Lease = LeaseRef & { readonly idlePid: number }
export type FileOperation =
	| {
			readonly _tag: "Read"
			readonly path: string
			readonly encoding: "utf8" | "base64"
	  }
	| {
			readonly _tag: "Write"
			readonly file: {
				readonly path: string
				readonly encoding: "utf8" | "base64"
				readonly content: string
			}
	  }
	| { readonly _tag: "List"; readonly path: string }
	| { readonly _tag: "Remove"; readonly path: string }
export type CommandReason =
	"finished" | "time_limit" | "output_limit" | "stopped" | "lease_lost"
export type CommandResult = {
	readonly exitCode: number | null
	readonly signal: string | null
	readonly reason: CommandReason
	readonly outputBytes: number
}
export type Running = {
	readonly done: Promise<CommandResult>
	readonly input: (base64: string) => void
	readonly signal: (
		signal: "SIGINT" | "SIGTERM" | "SIGKILL" | "SIGHUP" | "SIGQUIT",
	) => void
	readonly close: () => Promise<CommandResult>
}
export class BasicComputeFailure extends Error {
	readonly code:
		| "busy"
		| "invalid"
		| "unavailable"
		| "lease_lost"
		| "cleanup_failed"
		| "duplicate_operation"
		| "NotFound"
		| "Failed"
	constructor(code: BasicComputeFailure["code"], message: string) {
		super(message)
		this.code = code
		this.name = "BasicComputeFailure"
	}
}

/** Dependencies are supplied only by local tests, never from a product request. */
export type DockerDependencies = {
	readonly internet?: {
		readonly directory: string
		readonly authorize: (lease: LeaseRef) => Promise<void>
	}
	readonly spawn?: (
		args: ReadonlyArray<string>,
	) => ChildProcessWithoutNullStreams
	readonly schedule?: (callback: () => void, milliseconds: number) => () => void
}
const purpose = "kay-basic-compute"
const defaultSchedule = (callback: () => void, milliseconds: number) => {
	const timer = setTimeout(callback, milliseconds)
	timer.unref()
	return () => clearTimeout(timer)
}
const validateLease = (lease: LeaseRef) => {
	if (
		!/^[A-Za-z0-9_-]{8,128}$/.test(lease.leaseId) ||
		!/^kay-basic-[a-z0-9][a-z0-9-]{7,80}$/.test(lease.containerName)
	)
		throw new BasicComputeFailure("invalid", "Invalid task workspace identity.")
}
const data = (value: string) => {
	if (
		!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
			value,
		)
	)
		throw new BasicComputeFailure("invalid", "Invalid base64 input.")
	return Buffer.from(value, "base64")
}
const encoded = (value: unknown) => {
	const line = JSON.stringify(value) + "\n"
	if (Buffer.byteLength(line) > basicComputeLimits.inputBytes * 6)
		throw new BasicComputeFailure("invalid", "Task request is too large.")
	return line
}
const sameLease = (left: LeaseRef, right: LeaseRef) =>
	left.leaseId === right.leaseId && left.containerName === right.containerName
const createArguments = (lease: LeaseRef, internetSocket?: string) => [
	"create",
	"--name",
	lease.containerName,
	"--label",
	`com.kai.purpose=${purpose}`,
	"--label",
	`com.kai.lease=${lease.leaseId}`,
	"--pull=never",
	"--restart=no",
	"--network=none",
	...(internetSocket === undefined
		? []
		: [
				`--mount=type=bind,source=${internetSocket},target=/run/kay-internet.sock,readonly`,
			]),
	"--init",
	"--user=65532:65532",
	"--read-only",
	"--cap-drop=ALL",
	"--security-opt=no-new-privileges=true",
	"--security-opt=apparmor=docker-default",
	"--cpus=0.5",
	"--memory=512m",
	"--memory-swap=512m",
	"--pids-limit=32",
	"--ipc=none",
	"--cgroupns=private",
	"--ulimit=nofile=128:128",
	"--ulimit=core=0:0",
	"--ulimit=fsize=16777216:16777216",
	"--ulimit=cpu=120:120",
	"--tmpfs=/workspace:rw,noexec,nosuid,nodev,size=67108864,uid=65532,gid=65532,mode=0700",
	"--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=67108864,uid=65532,gid=65532,mode=0700",
	"--workdir=/workspace",
	"--env=HOME=/workspace",
	"--log-driver=none",
	"--stop-timeout=1",
	"--entrypoint=/usr/bin/sleep",
	basicComputeImage,
	"infinity",
]
const workerArguments = (lease: LeaseRef) => [
	"exec",
	"-i",
	"--user=65532:65532",
	lease.containerName,
	"node",
	"--max-old-space-size=128",
	"--input-type=module",
	"-e",
	basicComputeWorker,
]

/** A private host controller. Tasks execute only in a fixed, disposable container. */
export const makeBasicComputeDocker = (
	dependencies: DockerDependencies = {},
) => {
	const launch =
		dependencies.spawn ??
		((args) =>
			spawn("sudo", ["-n", "docker", ...args], {
				stdio: ["pipe", "pipe", "pipe"],
			}))
	const schedule = dependencies.schedule ?? defaultSchedule
	let active: LeaseRef | undefined
	let busy = false
	let terminating: Promise<void> | undefined
	let creating:
		{ readonly settled: Promise<void>; stopping: boolean } | undefined
	let creationUncertain = false
	let lastRemoved: LeaseRef | undefined
	let internet:
		Awaited<ReturnType<typeof startBasicComputeInternet>> | undefined
	const operations = new Set<string>()
	const internetSocket = (lease: LeaseRef) => {
		if (dependencies.internet === undefined) return undefined
		const directory = dependencies.internet.directory
		if (!isAbsolute(directory) || /[,\0]/.test(directory))
			throw new BasicComputeFailure(
				"invalid",
				"Invalid internet socket directory.",
			)
		return join(directory, lease.leaseId + ".sock")
	}

	const control = (
		args: ReadonlyArray<string>,
		input?: string,
		maxBytes = 512 * 1024,
	): Promise<string> =>
		new Promise((resolve, reject) => {
			let child: ChildProcessWithoutNullStreams
			try {
				child = launch(args)
			} catch {
				reject(
					new BasicComputeFailure(
						"unavailable",
						"Task container service is unavailable.",
					),
				)
				return
			}
			let output = ""
			let bytes = 0
			let finished = false
			const finish = (error?: BasicComputeFailure) => {
				if (finished) return
				finished = true
				cancel()
				if (error !== undefined) {
					child.kill("SIGKILL")
					reject(error)
				} else resolve(output.trim())
			}
			const cancel = schedule(
				() =>
					finish(
						new BasicComputeFailure(
							"unavailable",
							"Task container control timed out.",
						),
					),
				20_000,
			)
			child.stdout.on("data", (chunk: Buffer) => {
				bytes += chunk.length
				if (bytes > maxBytes)
					finish(
						new BasicComputeFailure(
							"unavailable",
							"Task container response is too large.",
						),
					)
				else output += chunk.toString("utf8")
			})
			child.stderr.on("data", (chunk: Buffer) => {
				bytes += chunk.length
				if (bytes > maxBytes)
					finish(
						new BasicComputeFailure(
							"unavailable",
							"Task container response is too large.",
						),
					)
			})
			child.on("error", () =>
				finish(
					new BasicComputeFailure(
						"unavailable",
						"Task container service is unavailable.",
					),
				),
			)
			child.on("close", (code) =>
				finish(
					code === 0
						? undefined
						: new BasicComputeFailure(
								"unavailable",
								"Task container control failed.",
							),
				),
			)
			child.stdin.on("error", () => {})
			child.stdin.end(input)
		})
	const exists = async (lease: LeaseRef) =>
		(await control([
			"container",
			"ls",
			"--all",
			`--filter=name=^/${lease.containerName}$`,
			"--format={{.ID}}",
		])) !== ""
	const health = async (): Promise<void> => {
		if ((await control(["info", "--format={{.OSType}}"])) !== "linux")
			throw new BasicComputeFailure(
				"unavailable",
				"A Linux task container service is required.",
			)
		if (
			!/^sha256:[a-f0-9]{64}$/.test(
				await control([
					"image",
					"inspect",
					"--format={{.Id}}",
					basicComputeImage,
				]),
			)
		)
			throw new BasicComputeFailure(
				"unavailable",
				"The pinned task image is unavailable.",
			)
	}
	const releaseBusy = (lease: LeaseRef) => {
		if (active === undefined || sameLease(active, lease)) busy = false
	}
	const owned = async (lease: LeaseRef) => {
		const value: unknown = JSON.parse(
			await control([
				"inspect",
				"--format={{json .Config.Labels}}",
				lease.containerName,
			]),
		)
		if (
			typeof value !== "object" ||
			value === null ||
			!("com.kai.purpose" in value) ||
			value["com.kai.purpose"] !== purpose ||
			!("com.kai.lease" in value) ||
			value["com.kai.lease"] !== lease.leaseId
		)
			throw new BasicComputeFailure(
				"cleanup_failed",
				"Container identity does not match this workspace.",
			)
	}
	const removeLease = async (lease: LeaseRef) => {
		try {
			// Stop all outbound work even if Docker removal later needs recovery.
			await internet?.close()
			internet = undefined
			if (await exists(lease)) {
				await owned(lease)
				await control(["rm", "--force", lease.containerName])
				creationUncertain = false
			}
			if (creationUncertain)
				throw new BasicComputeFailure(
					"cleanup_failed",
					"A container creation has not been confirmed. Keep its lease reserved.",
				)
			if (await exists(lease))
				throw new BasicComputeFailure(
					"cleanup_failed",
					"Workspace removal could not be confirmed.",
				)
			const socket = internetSocket(lease)
			if (socket !== undefined) {
				// Recovery runs only after the old controller has stopped and the container is gone.
				const stat = await lstat(socket).catch((error: unknown) => {
					if (
						error instanceof Error &&
						"code" in error &&
						error.code === "ENOENT"
					)
						return undefined
					throw error
				})
				if (stat !== undefined) {
					if (!stat.isSocket() || stat.uid !== process.getuid?.())
						throw new Error("Unexpected internet socket owner.")
					await unlink(socket)
				}
			}
			active = undefined
			busy = false
			operations.clear()
			lastRemoved = lease
		} catch {
			throw new BasicComputeFailure(
				"cleanup_failed",
				"Workspace shutdown could not be confirmed. New work remains blocked.",
			)
		}
	}
	const terminateLease = (lease: LeaseRef): Promise<void> => {
		validateLease(lease)
		if (active !== undefined && !sameLease(active, lease))
			return Promise.reject(
				new BasicComputeFailure("busy", "Another workspace is active."),
			)
		if (terminating !== undefined) return terminating
		active = lease
		if (
			lease.creationUncertain === true &&
			(lastRemoved === undefined || !sameLease(lastRemoved, lease))
		)
			creationUncertain = true
		const pending = creating
		if (pending !== undefined) pending.stopping = true
		const promise = (async () => {
			try {
				// A successful absence query cannot rule out a create RPC still in flight.
				await pending?.settled
				await removeLease(lease)
			} finally {
				terminating = undefined
			}
		})()
		terminating = promise
		return promise
	}
	const one = async (
		lease: LeaseRef,
		request: unknown,
		maxBytes?: number,
	): Promise<unknown> => {
		const response = await control(
			workerArguments(lease),
			encoded(request),
			maxBytes,
		)
		let event: unknown
		try {
			event = JSON.parse(response)
		} catch {
			throw new BasicComputeFailure(
				"lease_lost",
				"The workspace returned an invalid response.",
			)
		}
		if (typeof event !== "object" || event === null || !("event" in event))
			throw new BasicComputeFailure(
				"lease_lost",
				"The workspace returned an invalid response.",
			)
		if (
			event.event === "error" &&
			"message" in event &&
			typeof event.message === "string"
		)
			throw new BasicComputeFailure(
				"code" in event && event.code === "NotFound" ? "NotFound" : "Failed",
				event.message.slice(0, 500),
			)
		if (event.event !== "result" || !("value" in event))
			throw new BasicComputeFailure(
				"lease_lost",
				"The workspace returned an invalid response.",
			)
		return event.value
	}
	const cleanup = async (lease: Lease) => {
		try {
			await one(lease, { mode: "cleanup", idlePid: lease.idlePid })
		} catch {
			await terminateLease(lease)
			throw new BasicComputeFailure(
				"lease_lost",
				"Task processes did not stop; the workspace was discarded.",
			)
		}
	}
	const createLease = async (lease: LeaseRef): Promise<Lease> => {
		validateLease(lease)
		if (active !== undefined || busy || terminating !== undefined)
			throw new BasicComputeFailure("busy", "Another workspace is active.")
		active = lease
		busy = true
		lastRemoved = undefined
		let settle: () => void = () => {}
		const pending = {
			settled: new Promise<void>((resolve) => {
				settle = resolve
			}),
			stopping: false,
		}
		creating = pending
		try {
			if (await exists(lease))
				throw new BasicComputeFailure(
					"cleanup_failed",
					"A previous workspace must be removed before creating another.",
				)
			if (pending.stopping)
				throw new BasicComputeFailure(
					"lease_lost",
					"Workspace creation was stopped.",
				)
			const socket = internetSocket(lease)
			if (socket !== undefined && dependencies.internet !== undefined) {
				await mkdir(dependencies.internet.directory, {
					recursive: true,
					mode: 0o700,
				})
				const directory = await lstat(dependencies.internet.directory)
				if (
					!directory.isDirectory() ||
					directory.isSymbolicLink() ||
					(directory.mode & 0o077) !== 0 ||
					directory.uid !== process.getuid?.()
				)
					throw new Error("Use a private internet socket directory.")
				internet = await startBasicComputeInternet({
					socketPath: socket,
					authorize: () => dependencies.internet!.authorize(lease),
				})
			}
			creationUncertain = true
			await control(createArguments(lease, socket))
			creationUncertain = false
			if (pending.stopping)
				throw new BasicComputeFailure(
					"lease_lost",
					"Workspace creation was stopped.",
				)
			await control(["start", lease.containerName])
			const value = await one(lease, { mode: "health" })
			if (
				typeof value !== "object" ||
				value === null ||
				!("idlePid" in value) ||
				typeof value.idlePid !== "number" ||
				!Number.isInteger(value.idlePid) ||
				value.idlePid <= 1
			)
				throw new BasicComputeFailure(
					"lease_lost",
					"Workspace process identity is unavailable.",
				)
			if (pending.stopping)
				throw new BasicComputeFailure(
					"lease_lost",
					"Workspace creation was stopped.",
				)
			return { ...lease, idlePid: value.idlePid }
		} catch (error) {
			// Public termination waits for this attempt, so its cleanup cannot be used here.
			await removeLease(lease)
			throw error
		} finally {
			if (creating === pending) creating = undefined
			settle()
			releaseBusy(lease)
		}
	}
	const claim = (lease: Lease, operationId: string) => {
		validateLease(lease)
		if (active === undefined || !sameLease(active, lease))
			throw new BasicComputeFailure(
				"lease_lost",
				"This workspace is no longer available.",
			)
		if (busy || terminating !== undefined)
			throw new BasicComputeFailure(
				"busy",
				"A task is already using this workspace.",
			)
		if (!/^[A-Za-z0-9_-]{1,128}$/.test(operationId))
			throw new BasicComputeFailure(
				"invalid",
				"Invalid task operation identity.",
			)
		if (operations.has(operationId))
			throw new BasicComputeFailure(
				"duplicate_operation",
				"This operation was already submitted. Its result must be checked instead of running it again.",
			)
		operations.add(operationId)
		busy = true
	}
	const files = async (options: {
		readonly lease: Lease
		readonly operationId: string
		readonly operation: FileOperation
	}): Promise<unknown> => {
		const request = encoded({ mode: "file", operation: options.operation })
		claim(options.lease, options.operationId)
		try {
			await cleanup(options.lease)
			return await one(options.lease, JSON.parse(request), 16 * 1024 * 1024)
		} catch (error) {
			if (
				!(error instanceof BasicComputeFailure) ||
				!["NotFound", "Failed", "cleanup_failed"].includes(error.code)
			) {
				if (active !== undefined && sameLease(active, options.lease))
					await terminateLease(options.lease)
			}
			throw error
		} finally {
			releaseBusy(options.lease)
		}
	}
	const start = (options: {
		readonly lease: Lease
		readonly operationId: string
		readonly command: string
		readonly cwd?: string
		readonly env?: Readonly<Record<string, string>>
		readonly onOutput: (base64: string) => void
	}): Running => {
		if (
			typeof options.command !== "string" ||
			options.command.includes("\0") ||
			Buffer.byteLength(options.command) > basicComputeLimits.inputBytes
		)
			throw new BasicComputeFailure(
				"invalid",
				"Command exceeds the 256 KiB limit or contains an invalid character.",
			)
		const request = encoded({
			mode: "command",
			command: options.command,
			cwd: options.cwd,
			env: options.env,
		})
		claim(options.lease, options.operationId)
		let child: ChildProcessWithoutNullStreams | undefined
		let outputBytes = 0
		let inputBytes = 0
		let wireBytes = 0
		let buffer = ""
		let completed = false
		let ready = false
		let controlCount = 0
		let queuedBytes = 0
		let exit: { code: number | null; signal: string | null } | undefined
		let reason: CommandReason | undefined
		let cancel = () => {}
		const queued: Array<string> = []
		let resolveDone: (result: CommandResult) => void
		let rejectDone: (error: unknown) => void
		const done = new Promise<CommandResult>((resolve, reject) => {
			resolveDone = resolve
			rejectDone = reject
		})
		const finish = async (requested: CommandReason) => {
			if (completed) return
			completed = true
			reason = requested
			cancel()
			try {
				if (requested === "finished") await cleanup(options.lease)
				else await terminateLease(options.lease)
				resolveDone({
					exitCode: exit?.code ?? null,
					signal: exit?.signal ?? null,
					reason: requested,
					outputBytes,
				})
			} catch (error) {
				rejectDone(error)
			} finally {
				child?.stdin.destroy()
				child?.stdout.destroy()
				child?.stderr.destroy()
				child?.kill("SIGKILL")
				releaseBusy(options.lease)
			}
		}
		const accept = (line: string) => {
			if (completed) return
			try {
				const event: unknown = JSON.parse(line)
				if (typeof event !== "object" || event === null || !("event" in event))
					throw new Error("Invalid event")
				if (event.event === "ready") {
					ready = true
					for (const item of queued.splice(0)) child?.stdin.write(item)
					queuedBytes = 0
					return
				}
				if (
					event.event === "output" &&
					"data" in event &&
					typeof event.data === "string"
				) {
					const chunk = data(event.data)
					const remaining = basicComputeLimits.outputBytes - outputBytes
					if (remaining > 0) {
						const portion = chunk.subarray(0, remaining)
						outputBytes += portion.length
						options.onOutput(portion.toString("base64"))
					}
					if (chunk.length > remaining) void finish("output_limit")
					return
				}
				if (
					event.event === "limit" &&
					"reason" in event &&
					(event.reason === "output_limit" || event.reason === "time_limit")
				) {
					void finish(event.reason)
					return
				}
				if (
					event.event === "exit" &&
					"code" in event &&
					(event.code === null ||
						(typeof event.code === "number" && Number.isInteger(event.code))) &&
					"signal" in event &&
					(event.signal === null || typeof event.signal === "string")
				) {
					if (exit !== undefined) throw new Error("Repeated exit")
					exit = { code: event.code, signal: event.signal }
					return
				}
				throw new Error("Unexpected event")
			} catch {
				void finish("lease_lost")
			}
		}
		void (async () => {
			try {
				await cleanup(options.lease)
				if (completed) return
				child = launch(workerArguments(options.lease))
				cancel = schedule(() => {
					void finish("time_limit")
				}, basicComputeLimits.commandMs)
				child.stdout.on("data", (chunk: Buffer) => {
					if (completed) return
					wireBytes += chunk.length
					if (wireBytes > 1024 * 1024) {
						void finish("output_limit")
						return
					}
					buffer += chunk.toString("utf8")
					let newline: number
					while ((newline = buffer.indexOf("\n")) !== -1) {
						const line = buffer.slice(0, newline)
						buffer = buffer.slice(newline + 1)
						accept(line)
					}
					if (buffer.length > 128 * 1024) void finish("output_limit")
				})
				child.stderr.on("data", () => {
					void finish("lease_lost")
				})
				child.on("error", () => {
					void finish("lease_lost")
				})
				child.on("close", (code) => {
					void finish(
						code === 0 && exit !== undefined && buffer === ""
							? "finished"
							: "lease_lost",
					)
				})
				child.stdin.on("error", () => {
					if (!completed && exit === undefined) void finish("lease_lost")
				})
				child.stdin.write(request)
			} catch {
				await finish("lease_lost")
			}
		})()
		const send = (value: unknown) => {
			if (completed || reason !== undefined)
				throw new BasicComputeFailure(
					"lease_lost",
					"This command has finished.",
				)
			const line = encoded(value)
			if (++controlCount > 1024)
				throw new BasicComputeFailure(
					"invalid",
					"Command control limit reached.",
				)
			if (ready) child?.stdin.write(line)
			else {
				queuedBytes += Buffer.byteLength(line)
				if (queuedBytes > 512 * 1024)
					throw new BasicComputeFailure(
						"invalid",
						"Command input queue is full.",
					)
				queued.push(line)
			}
		}
		return {
			done,
			input: (base64) => {
				inputBytes += data(base64).length
				if (inputBytes > basicComputeLimits.inputBytes)
					throw new BasicComputeFailure(
						"invalid",
						"Command input exceeds 256 KiB.",
					)
				send({ type: "input", data: base64 })
			},
			signal: (signal) => {
				if (
					!["SIGINT", "SIGTERM", "SIGKILL", "SIGHUP", "SIGQUIT"].includes(
						signal,
					)
				)
					throw new BasicComputeFailure("invalid", "Unsupported task signal.")
				send({ type: "signal", signal })
			},
			close: () => {
				void finish("stopped")
				return done
			},
		}
	}
	return { health, createLease, terminateLease, start, files }
}

export type BasicComputeDocker = ReturnType<typeof makeBasicComputeDocker>
