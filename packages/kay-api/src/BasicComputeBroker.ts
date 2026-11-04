import { randomUUID } from "node:crypto"
import { createServer, type IncomingMessage } from "node:http"
import { chmod, lstat, mkdir, unlink } from "node:fs/promises"
import { dirname, join } from "node:path"
import { Schema } from "effect"
import { openNativeComputerSocket } from "@kaicom/kay-openbot"
import { makeMembership, MembershipFailure } from "./Membership.ts"
import {
	makeComputeStore,
	type ComputeAccount,
	type ComputeLease,
	type ComputeOwner,
} from "./BasicComputeStore.ts"
import { openComputeToken, readComputeKey } from "./BasicComputeSecrets.ts"
import {
	BasicComputeFailure as DockerFailure,
	makeBasicComputeDocker,
	type Lease,
	type Running,
} from "./BasicComputeDocker.ts"
import type { DatabaseRuntime } from "./Database.ts"

type WireSocket = ReturnType<typeof openNativeComputerSocket>
type Connection = {
	readonly account: ComputeAccount
	readonly nonce: string
	socket: WireSocket | undefined
	lastMessage: number
	closed: boolean
	leaseRequest?: Promise<Active>
	activity: ComputeLease["activity"]
	activityAt: number | null
	activityUpdate?: Promise<void>
	starting: number
	activityRequest?: {
		readonly id: string
		readonly resolve: (activity: ComputeLease["activity"]) => void
	}
}
type Active = {
	readonly row: ComputeLease
	readonly lease: Lease
	busy: boolean
	idle: Promise<void>
	releaseIdle: () => void
	files: Promise<void>
	waitingFiles: number
	session?: { readonly id: string; readonly running: Running }
}
const object = Schema.decodeUnknownSync(Schema.JsonObject)
const text = Schema.decodeUnknownSync(Schema.String)
const fileOperation = Schema.decodeUnknownSync(
	Schema.Union([
		Schema.TaggedStruct("Read", {
			path: Schema.String,
			encoding: Schema.Literals(["utf8", "base64"]),
		}),
		Schema.TaggedStruct("Write", {
			file: Schema.Struct({
				path: Schema.String,
				encoding: Schema.Literals(["utf8", "base64"]),
				content: Schema.String,
			}),
		}),
		Schema.TaggedStruct("List", { path: Schema.String }),
		Schema.TaggedStruct("Remove", { path: Schema.String }),
	]),
)
const keyOf = (owner: ComputeOwner) =>
	JSON.stringify([owner.accountId, owner.organizationId])
const ownerOf = (account: ComputeAccount): ComputeOwner => ({
	accountId: account.account_id,
	organizationId: account.organization_id,
})
const safeMessage = (error: unknown) =>
	error instanceof MembershipFailure || error instanceof DockerFailure
		? error.message
		: "The basic task workspace could not finish this operation. Its outcome may be unknown."

/** One private controller owns all task containers. It never executes a user command on its host. */
export const makeBasicComputeBroker = (input: {
	readonly db: DatabaseRuntime
	readonly origin: string
	readonly key: Buffer
	readonly driver?: ReturnType<typeof makeBasicComputeDocker>
	readonly connect?: typeof openNativeComputerSocket
	readonly now?: () => number
	readonly internetDirectory?: string
	readonly activityTimeoutMs?: number
	readonly cleanupWaitMs?: number
}) => {
	const connect = input.connect ?? openNativeComputerSocket
	const now = input.now ?? Date.now
	const store = makeComputeStore(input.db)
	const membership = makeMembership({ db: input.db })
	const connections = new Map<string, Connection>()
	const driver =
		input.driver ??
		makeBasicComputeDocker({
			...(input.internetDirectory === undefined
				? {}
				: {
						internet: {
							directory: input.internetDirectory,
							authorize: async (lease) => {
								const row = await store.lease()
								if (
									row === null ||
									row.lease_id !== lease.leaseId ||
									row.state !== "active" ||
									row.expires_at <= now()
								)
									throw new Error("This workspace has ended.")
								const connection = connections.get(
									keyOf({
										accountId: row.account_id,
										organizationId: row.organization_id,
									}),
								)
								if (
									connection === undefined ||
									connection.nonce !== row.connection_nonce ||
									connection.account.generation !== row.generation
								)
									throw new Error("This workspace connection has changed.")
								await authorize(connection)
							},
						},
					}),
		})
	let active: Active | undefined
	let stopping = false
	let scanning: Promise<void> | undefined
	let stoppingLease:
		| {
				readonly row: ComputeLease
				readonly promise: Promise<void>
		  }
		| undefined
	let creatingLease:
		{ readonly id: string; readonly promise: Promise<Lease> } | undefined
	const current = (connection: Connection) =>
		!stopping &&
		!connection.closed &&
		connections.get(keyOf(ownerOf(connection.account))) === connection
	const send = (connection: Connection, message: unknown) =>
		current(connection) && connection.socket?.send(message) === true
	const stopLease = async (expected?: {
		readonly owner?: ComputeOwner
		readonly generation?: number
		readonly maxGeneration?: number
		readonly nonce?: string
		readonly leaseId?: string
		readonly idle?: { readonly now: number; readonly activityAt: number | null }
	}): Promise<void> => {
		const row = await store.lease()
		if (row === null) return
		if (
			expected !== undefined &&
			((expected.owner !== undefined &&
				(row.account_id !== expected.owner.accountId ||
					row.organization_id !== expected.owner.organizationId)) ||
				(expected.generation !== undefined &&
					row.generation !== expected.generation) ||
				(expected.maxGeneration !== undefined &&
					row.generation > expected.maxGeneration) ||
				(expected.nonce !== undefined &&
					row.connection_nonce !== expected.nonce) ||
				(expected.leaseId !== undefined && row.lease_id !== expected.leaseId))
		)
			return
		if (stoppingLease !== undefined) {
			if (stoppingLease.row.lease_id === row.lease_id)
				return stoppingLease.promise
			await stoppingLease.promise
			return stopLease({ leaseId: row.lease_id })
		}
		if (expected?.idle !== undefined) {
			const connection = connections.get(
				keyOf({
					accountId: row.account_id,
					organizationId: row.organization_id,
				}),
			)
			if (
				active?.row.lease_id === row.lease_id &&
				(active.busy || active.waitingFiles > 0)
			)
				return
			if (connection?.activity !== "idle" || connection.starting > 0) return
		}
		const work = (async () => {
			if (expected?.idle !== undefined) {
				if (
					!(await store.claimIdleCleanup({
						leaseId: row.lease_id,
						...expected.idle,
					}))
				)
					return
			} else
				await store.leaseState({
					leaseId: row.lease_id,
					state: "cleanup_pending",
				})
			await store.interruptCalls(row.lease_id)
			if (creatingLease?.id === row.lease_id)
				await creatingLease.promise.catch(() => {})
			await driver.terminateLease({
				leaseId: row.lease_id,
				containerName: row.container_name,
				creationUncertain: !row.creation_confirmed,
			})
			// A failed or uncertain removal leaves the global slot occupied.
			await store.releaseLease(row.lease_id)
			if (active?.row.lease_id === row.lease_id) {
				release(active)
				active = undefined
			}
		})()
		stoppingLease = { row, promise: work }
		try {
			await work
		} finally {
			if (stoppingLease?.promise === work) stoppingLease = undefined
		}
	}
	const authorize = async (connection: Connection) => {
		if (!current(connection))
			throw new Error("This connector is no longer current.")
		const owner = ownerOf(connection.account)
		try {
			const entitlement = await membership.requireContainerEntitlement(
				owner.accountId,
			)
			const saved = await store.account(owner)
			if (
				!current(connection) ||
				saved?.generation !== connection.account.generation ||
				saved.computer_id !== connection.account.computer_id ||
				saved.token_ciphertext !== connection.account.token_ciphertext
			)
				throw new Error("This connector is no longer current.")
			return entitlement
		} catch (error) {
			await stopLease({
				owner,
				generation: connection.account.generation,
				nonce: connection.nonce,
			})
			throw error
		}
	}
	const acquireLease = async (connection: Connection): Promise<Active> => {
		const cleanup = stoppingLease
		if (
			cleanup?.row.creation_confirmed === true &&
			cleanup.row.account_id === connection.account.account_id &&
			cleanup.row.organization_id === connection.account.organization_id &&
			cleanup.row.generation === connection.account.generation &&
			cleanup.row.connection_nonce === connection.nonce
		) {
			// Wait before admitting this operation; a sent command is never retried.
			let timer: ReturnType<typeof setTimeout> | undefined
			try {
				await Promise.race([
					cleanup.promise,
					new Promise<never>((_, reject) => {
						timer = setTimeout(
							() =>
								reject(
									new DockerFailure(
										"busy",
										"The previous workspace is still closing. This operation was not started.",
									),
								),
							input.cleanupWaitMs ?? 10_000,
						)
					}),
				])
			} finally {
				clearTimeout(timer)
			}
		}
		const entitlement = await authorize(connection)
		const saved = await store.lease()
		if (saved !== null) {
			if (
				saved.account_id !== connection.account.account_id ||
				saved.organization_id !== connection.account.organization_id ||
				saved.generation !== connection.account.generation ||
				saved.connection_nonce !== connection.nonce ||
				active?.row.lease_id !== saved.lease_id ||
				saved.state !== "active" ||
				stoppingLease !== undefined
			)
				throw new Error(
					"The basic task service is busy. Another workspace is active.",
				)
			await refreshActivity(connection)
			const renewed = await store.lease()
			if (
				renewed?.lease_id !== saved.lease_id ||
				renewed.state !== "active" ||
				stoppingLease !== undefined ||
				active?.row.lease_id !== saved.lease_id
			)
				throw new Error(
					"This workspace was released before the operation started.",
				)
			if (renewed.expires_at <= now()) {
				await stopLease({ leaseId: saved.lease_id })
				throw new Error("This temporary workspace has ended. Start a new task.")
			}
			return active
		}
		const leaseId = randomUUID()
		const row: ComputeLease = {
			lease_id: leaseId,
			account_id: connection.account.account_id,
			organization_id: connection.account.organization_id,
			computer_id: connection.account.computer_id!,
			generation: connection.account.generation,
			connection_nonce: connection.nonce,
			creation_confirmed: false,
			container_name: "kay-basic-" + leaseId,
			expires_at: entitlement.expiresAt,
			activity: "unknown",
			activity_at: null,
			idle_since: null,
			state: "starting",
		}
		if (!(await store.claimLease(row)))
			throw new Error(
				"The basic task service is busy. Another workspace is active.",
			)
		try {
			const creation = driver.createLease({
				leaseId,
				containerName: row.container_name,
			})
			creatingLease = { id: leaseId, promise: creation }
			const created = await creation
			await store.confirmCreation(leaseId)
			const currentLease = await store.lease()
			if (
				currentLease?.lease_id !== leaseId ||
				currentLease.state !== "starting"
			)
				throw new Error("This workspace was released during setup.")
			await authorize(connection)
			await store.leaseState({ leaseId, state: "active" })
			active = {
				row: { ...row, creation_confirmed: true, state: "active" },
				lease: created,
				busy: false,
				idle: Promise.resolve(),
				releaseIdle: () => {},
				files: Promise.resolve(),
				waitingFiles: 0,
			}
			return active
		} catch (error) {
			await stopLease({ leaseId })
			throw error
		} finally {
			if (creatingLease?.id === leaseId) creatingLease = undefined
		}
	}
	const lease = async (connection: Connection): Promise<Active> => {
		if (connection.leaseRequest !== undefined) return connection.leaseRequest
		connection.starting++
		const pending = acquireLease(connection)
		connection.leaseRequest = pending
		try {
			return await pending
		} finally {
			connection.starting--
			if (connection.leaseRequest === pending) delete connection.leaseRequest
		}
	}
	const hold = (held: Active) => {
		held.busy = true
		held.idle = new Promise<void>((resolve) => {
			held.releaseIdle = resolve
		})
	}
	const release = (held: Active) => {
		held.busy = false
		held.releaseIdle()
	}
	const refreshActivity = (
		connection: Connection,
		reported?: ComputeLease["activity"],
	): Promise<void> => {
		const pending = (async () => {
			await connection.activityUpdate
			if (!current(connection)) return
			const entitlement = await authorize(connection)
			const held = active
			if (
				held === undefined ||
				held.row.connection_nonce !== connection.nonce ||
				held.row.generation !== connection.account.generation
			)
				return
			const activity =
				held.busy || held.waitingFiles > 0
					? "working"
					: connection.starting > 0
						? "unknown"
						: connection.activityAt !== null &&
							  connection.activityAt >= now() - 60_000
							? (reported ?? connection.activity)
							: "unknown"
			await store.activity({
				leaseId: held.row.lease_id,
				generation: held.row.generation,
				nonce: connection.nonce,
				activity,
				now: now(),
				membershipExpiresAt: entitlement.expiresAt,
			})
		})()
		connection.activityUpdate = pending
		void pending
			.finally(() => {
				if (connection.activityUpdate === pending)
					delete connection.activityUpdate
			})
			.catch(() => {})
		return pending
	}
	const readFreshActivity = (
		connection: Connection,
	): Promise<ComputeLease["activity"]> => {
		const id = randomUUID()
		return new Promise((resolve) => {
			const finish = (activity: ComputeLease["activity"]) => {
				clearTimeout(timer)
				if (connection.activityRequest?.id === id)
					delete connection.activityRequest
				resolve(activity)
			}
			const timer = setTimeout(
				() => finish("unknown"),
				input.activityTimeoutMs ?? 7000,
			)
			connection.activityRequest = { id, resolve: finish }
			if (!send(connection, { _tag: "Pong", activityRequestId: id }))
				finish("unknown")
		})
	}
	const failureText = (error: unknown) => {
		if (
			error instanceof Error &&
			error.message ===
				"The basic task service is busy. Another workspace is active."
		)
			return error.message
		return safeMessage(error)
	}
	const handle = async (connection: Connection, raw: unknown) => {
		if (!current(connection)) return
		const message = object(raw)
		connection.lastMessage = now()
		if (message["_tag"] === "Ping") {
			const reported =
				message["activity"] === "working" || message["activity"] === "idle"
					? message["activity"]
					: "unknown"
			connection.activity = reported
			connection.activityAt = now()
			await refreshActivity(connection, reported)
			await store.connection({
				...ownerOf(connection.account),
				generation: connection.account.generation,
				connected: true,
			})
			send(connection, { _tag: "Pong" })
			if (connection.activityRequest?.id === message["activityRequestId"])
				connection.activityRequest?.resolve(reported)
			return
		}
		if (message["_tag"] === "Start") {
			const session = text(message["session"])
			if (message["tty"] !== false) {
				send(connection, {
					_tag: "Exit",
					session,
					code: null,
					signal: null,
					error:
						"Interactive terminals are not supported by this basic task workspace.",
				})
				return
			}
			let held: Active | undefined
			let claimed = false
			let ownsBusy = false
			try {
				held = await lease(connection)
				if (
					active !== held ||
					stoppingLease !== undefined ||
					held.busy ||
					held.waitingFiles > 0
				)
					throw new Error(
						"The basic task service is busy. Another workspace is active.",
					)
				hold(held)
				ownsBusy = true
				await refreshActivity(connection)
				claimed = await store.claimCall({
					...ownerOf(connection.account),
					computerId: connection.account.computer_id!,
					generation: connection.account.generation,
					operationId: session,
					kind: "command",
					leaseId: held.row.lease_id,
				})
				if (!claimed)
					throw new Error(
						"This command has already been received. It will not be sent again.",
					)
				await authorize(connection)
				let sequence = 0
				const running = driver.start({
					lease: held.lease,
					operationId: session,
					command: text(message["command"]),
					...(typeof message["cwd"] === "string"
						? { cwd: message["cwd"] }
						: {}),
					...(message["env"] === undefined
						? {}
						: {
								env: Schema.decodeUnknownSync(
									Schema.Record(Schema.String, Schema.String),
								)(message["env"]),
							}),
					onOutput: (data) => {
						send(connection, { _tag: "Output", session, seq: sequence++, data })
					},
				})
				held.session = { id: session, running }
				const result = await running.done
				await store.finishCall({
					computerId: connection.account.computer_id!,
					operationId: session,
					generation: connection.account.generation,
					status: result.reason === "finished" ? "completed" : "unknown",
				})
				send(connection, {
					_tag: "Exit",
					session,
					code: result.exitCode,
					signal: result.signal,
					...(result.reason === "finished"
						? {}
						: {
								error:
									result.reason === "time_limit"
										? "This command reached the 120 second limit."
										: result.reason === "output_limit"
											? "This command reached the 64 KiB output limit."
											: "The temporary task workspace stopped. This command was not repeated.",
							}),
				})
				if (result.reason !== "finished")
					await stopLease({ leaseId: held.row.lease_id })
			} catch (error) {
				if (claimed)
					await store.finishCall({
						computerId: connection.account.computer_id!,
						operationId: session,
						generation: connection.account.generation,
						status: "unknown",
					})
				if (
					ownsBusy &&
					held !== undefined &&
					error instanceof DockerFailure &&
					["lease_lost", "unavailable", "cleanup_failed"].includes(error.code)
				)
					await stopLease({ leaseId: held.row.lease_id })
				send(connection, {
					_tag: "Exit",
					session,
					code: null,
					signal: null,
					error: failureText(error),
				})
			} finally {
				if (ownsBusy && held !== undefined) {
					if (held.session?.id === session) delete held.session
					release(held)
					await refreshActivity(connection)
				}
			}
			return
		}
		if (message["_tag"] === "Call") {
			const call = object(message["call"]),
				id = text(call["id"]),
				operation = object(call["operation"])
			let held: Active | undefined
			let claimed = false
			let ownsBusy = false
			let queued: Active | undefined
			let releaseQueue: (() => void) | undefined
			try {
				if (
					!["Read", "Write", "List", "Remove"].includes(text(operation["_tag"]))
				)
					throw new Error(
						"This basic workspace supports commands and files only.",
					)
				held = await lease(connection)
				if (held.waitingFiles >= 8)
					throw new DockerFailure(
						"busy",
						"This workspace has too many pending file operations.",
					)
				const previous = held.files
				held.files = new Promise<void>((resolve) => {
					releaseQueue = resolve
				})
				held.waitingFiles++
				queued = held
				// Native connector calls time out after two minutes. Leave time for the file transfer.
				let timer: ReturnType<typeof setTimeout> | undefined
				try {
					await Promise.race([
						Promise.all([previous, held.idle]),
						new Promise<never>((_, reject) => {
							timer = setTimeout(
								() =>
									reject(
										new DockerFailure(
											"busy",
											"The current command is still running. This file operation was not started.",
										),
									),
								90_000,
							)
						}),
					])
				} finally {
					clearTimeout(timer)
				}
				await authorize(connection)
				const saved = await store.lease()
				if (
					active !== held ||
					saved?.lease_id !== held.row.lease_id ||
					saved.state !== "active" ||
					saved.expires_at <= now() ||
					stoppingLease !== undefined
				)
					throw new DockerFailure(
						"lease_lost",
						"This workspace ended before the file operation could start.",
					)
				if (held.busy)
					throw new DockerFailure(
						"busy",
						"The workspace is still running another operation.",
					)
				hold(held)
				ownsBusy = true
				await refreshActivity(connection)
				claimed = await store.claimCall({
					...ownerOf(connection.account),
					computerId: connection.account.computer_id!,
					generation: connection.account.generation,
					operationId: id,
					kind: "file",
					leaseId: held.row.lease_id,
				})
				if (!claimed)
					throw new Error(
						"This file operation has already been received. It will not be sent again.",
					)
				await authorize(connection)
				const value = await driver.files({
					lease: held.lease,
					operationId: id,
					operation: fileOperation(operation),
				})
				await store.finishCall({
					computerId: connection.account.computer_id!,
					operationId: id,
					generation: connection.account.generation,
					status: "completed",
				})
				send(connection, {
					_tag: "Reply",
					reply: { id, result: { _tag: "Done", value } },
				})
			} catch (error) {
				if (claimed)
					await store.finishCall({
						computerId: connection.account.computer_id!,
						operationId: id,
						generation: connection.account.generation,
						status: "unknown",
					})
				if (
					ownsBusy &&
					held !== undefined &&
					error instanceof DockerFailure &&
					["lease_lost", "unavailable", "cleanup_failed"].includes(error.code)
				)
					await stopLease({ leaseId: held.row.lease_id })
				send(connection, {
					_tag: "Reply",
					reply: {
						id,
						result: {
							_tag: "Failed",
							reason: "Failed",
							message: failureText(error),
						},
					},
				})
			} finally {
				if (ownsBusy && held !== undefined) release(held)
				if (queued !== undefined) queued.waitingFiles--
				releaseQueue?.()
				if (ownsBusy) await refreshActivity(connection)
			}
			return
		}
		await authorize(connection)
		const session = text(message["session"])
		if (
			active?.row.account_id !== connection.account.account_id ||
			active.row.organization_id !== connection.account.organization_id ||
			active.row.generation !== connection.account.generation ||
			active.row.connection_nonce !== connection.nonce ||
			active.session?.id !== session
		)
			return
		if (message["_tag"] === "Close") await active.session.running.close()
		else if (message["_tag"] === "Signal")
			active.session.running.signal(
				Schema.decodeUnknownSync(
					Schema.Literals([
						"SIGINT",
						"SIGTERM",
						"SIGKILL",
						"SIGHUP",
						"SIGQUIT",
					]),
				)(message["signal"]),
			)
		else if (message["_tag"] === "Input")
			active.session.running.input(text(message["data"]))
		// Resize is unsupported: all basic commands are non-interactive.
	}
	const scan = () => {
		if (scanning !== undefined) return scanning
		const work = (async () => {
			if (stopping) return
			const before = await store.lease()
			if (before !== null) {
				const connection = connections.get(
					keyOf({
						accountId: before.account_id,
						organizationId: before.organization_id,
					}),
				)
				if (connection !== undefined)
					await refreshActivity(connection).catch(() => {})
			}
			const row = await store.lease()
			if (row !== null) {
				try {
					const entitlement = await membership.requireContainerEntitlement(
						row.account_id,
					)
					if (row.expires_at <= now()) {
						if (row.activity === "idle" && entitlement.expiresAt > now()) {
							const connection = connections.get(
								keyOf({
									accountId: row.account_id,
									organizationId: row.organization_id,
								}),
							)
							if (connection?.nonce === row.connection_nonce) {
								const result = await readFreshActivity(connection)
								if (result === "unknown") {
									connection.activity = "unknown"
									await refreshActivity(connection)
								} else if (result === "idle") {
									const confirmed = await store.lease()
									if (confirmed?.lease_id === row.lease_id)
										await stopLease({
											leaseId: row.lease_id,
											idle: { now: now(), activityAt: confirmed.activity_at },
										})
								}
							}
						} else await stopLease({ leaseId: row.lease_id })
					}
				} catch {
					await stopLease({ leaseId: row.lease_id })
				}
			}
			for (const account of await store.accounts()) {
				const owner = ownerOf(account),
					id = keyOf(owner)
				let previous = connections.get(id)
				if (
					previous !== undefined &&
					(previous.account.generation !== account.generation ||
						previous.lastMessage < now() - 60000)
				) {
					previous.socket?.close()
					previous = undefined
				}
				try {
					await membership.requireContainerEntitlement(owner.accountId)
				} catch {
					previous?.socket?.close()
					continue
				}
				if (previous !== undefined && !previous.closed) continue
				if (account.computer_id === null || account.token_ciphertext === null)
					continue
				const connection: Connection = {
					account,
					nonce: randomUUID(),
					socket: undefined,
					lastMessage: now(),
					closed: false,
					activity: "unknown",
					activityAt: null,
					starting: 0,
				}
				connections.set(id, connection)
				try {
					const token = openComputeToken({
						key: input.key,
						binding: {
							...owner,
							computerId: account.computer_id,
							generation: account.generation,
						},
						ciphertext: account.token_ciphertext,
					})
					connection.socket = connect({
						origin: input.origin,
						token,
						onOpen: () => {
							if (!current(connection)) {
								connection.socket?.close()
								return
							}
							send(connection, {
								_tag: "Hello",
								hello: {
									version: 3,
									os: "linux",
									arch: process.arch,
									desktop: false,
								},
							})
						},
						onMessage: (message) => {
							void handle(connection, message).catch(() =>
								connection.socket?.close(),
							)
						},
						onClose: () => {
							connection.closed = true
							connection.activityRequest?.resolve("unknown")
							if (connections.get(id) !== connection) return
							connections.delete(id)
							void stopLease({
								owner,
								generation: account.generation,
								nonce: connection.nonce,
							})
								.then(async () => {
									if (!connections.has(id))
										await store.connection({
											...owner,
											generation: account.generation,
											connected: false,
										})
								})
								.catch(() => {})
						},
					})
				} catch {
					connection.closed = true
					connections.delete(id)
					await store.connection({
						...owner,
						generation: account.generation,
						connected: false,
					})
				}
			}
		})()
		scanning = work
		void work
			.finally(() => {
				if (scanning === work) scanning = undefined
			})
			.catch(() => {})
		return work
	}
	return {
		health: () => driver.health(),
		start: async () => {
			await stopLease()
			await driver.health()
			await scan()
		},
		wake: async (starting?: ComputeOwner) => {
			if (starting !== undefined) {
				const connection = connections.get(keyOf(starting))
				if (connection !== undefined) {
					// A message is about to be admitted. The next core Ping supplies its saved state.
					connection.starting++
					try {
						connection.activity = "unknown"
						connection.activityAt = now()
						await refreshActivity(connection)
					} finally {
						connection.starting--
					}
				}
			}
			await scan()
		},
		release: (owner: ComputeOwner & { readonly maxGeneration?: number }) =>
			stopLease({
				owner,
				...(owner.maxGeneration === undefined
					? {}
					: { maxGeneration: owner.maxGeneration }),
			}),
		stop: async () => {
			stopping = true
			for (const connection of connections.values()) connection.socket?.close()
			await scanning?.catch(() => {})
			await stopLease()
		},
	}
}

/** Explicit host recovery only: never listen, scan accounts, or connect to OpenBot. */
export const recoverBasicComputeBroker = async (input: {
	readonly db: DatabaseRuntime
	readonly origin: string
	readonly keyFile: string
	readonly driver?: ReturnType<typeof makeBasicComputeDocker>
	readonly connect?: typeof openNativeComputerSocket
}) => {
	const key = await readComputeKey(input.keyFile)
	const broker = makeBasicComputeBroker({
		db: input.db,
		origin: input.origin,
		key,
		internetDirectory: join(dirname(input.keyFile), "internet"),
		...(input.driver === undefined ? {} : { driver: input.driver }),
		...(input.connect === undefined ? {} : { connect: input.connect }),
	})
	// Reuse the same persisted-lease cleanup as startup. Only confirmed removal
	// releases its slot; uncertain creation/removal remains fenced for inspection.
	await broker.stop()
}

/** The control socket is private to Kay API and this host process. It has no TCP listener. */
export const startBasicComputeBroker = async (input: {
	readonly db: DatabaseRuntime
	readonly origin: string
	readonly socketPath: string
	readonly keyFile: string
	readonly driver?: ReturnType<typeof makeBasicComputeDocker>
}) => {
	const key = await readComputeKey(input.keyFile)
	const broker = makeBasicComputeBroker({
		db: input.db,
		origin: input.origin,
		key,
		internetDirectory: join(dirname(input.keyFile), "internet"),
		...(input.driver === undefined ? {} : { driver: input.driver }),
	})
	await mkdir(dirname(input.socketPath), { recursive: true, mode: 0o700 })
	const directory = await lstat(dirname(input.socketPath))
	if (
		!directory.isDirectory() ||
		directory.isSymbolicLink() ||
		(directory.mode & 0o077) !== 0
	)
		throw new Error("Use a private directory for the compute control socket.")
	const body = async (req: IncomingMessage) => {
		let data = ""
		for await (const chunk of req) {
			data += String(chunk)
			if (Buffer.byteLength(data) > 4096)
				throw new Error("Control request is too large.")
		}
		return JSON.parse(data)
	}
	let ready = false
	const server = createServer((req, res) => {
		void (async () => {
			if (!ready)
				throw new Error("The private compute controller is not ready.")
			if (req.method !== "POST") throw new Error("Invalid control method.")
			const value = await body(req)
			if (req.url === "/health") await broker.health()
			else if (req.url === "/wake")
				await broker.wake(
					Schema.decodeUnknownSync(
						Schema.Struct({
							starting: Schema.optionalKey(
								Schema.Struct({
									accountId: Schema.NonEmptyString,
									organizationId: Schema.NonEmptyString,
								}),
							),
						}),
					)(value).starting,
				)
			else if (req.url === "/release")
				await broker.release(
					Schema.decodeUnknownSync(
						Schema.Struct({
							accountId: Schema.NonEmptyString,
							organizationId: Schema.NonEmptyString,
							maxGeneration: Schema.Natural,
						}),
					)(value, { onExcessProperty: "error" }),
				)
			else throw new Error("Invalid control path.")
			res.writeHead(204)
			res.end()
		})().catch(() => {
			if (!res.headersSent) res.writeHead(503)
			res.end()
		})
	})
	// Never unlink an existing socket automatically: another controller may own it.
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject)
		server.listen(input.socketPath, () => resolve())
	})
	await chmod(input.socketPath, 0o600)
	const removeSocket = async () => {
		try {
			await unlink(input.socketPath)
		} catch (error) {
			if (!(
				error instanceof Error &&
				"code" in error &&
				error.code === "ENOENT"
			))
				throw error
		}
	}
	try {
		await broker.start()
		ready = true
	} catch (error) {
		await new Promise<void>((resolve) => server.close(() => resolve()))
		await removeSocket()
		throw error
	}
	const timer = setInterval(() => {
		void broker.wake().catch(() => {})
	}, 1000)
	timer.unref()
	return {
		close: async () => {
			ready = false
			clearInterval(timer)
			const closed = new Promise<void>((resolve) =>
				server.close(() => resolve()),
			)
			try {
				await broker.stop()
			} finally {
				await closed
				await removeSocket()
			}
		},
	}
}
