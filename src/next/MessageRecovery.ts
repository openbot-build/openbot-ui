import * as Product from "@kaicom/kay-contracts"
import { RequestFailed } from "@kaicom/kay-contracts/Client"
import { Schema } from "effect"
import { dual } from "effect/Function"

const PendingSendSchema = Schema.Struct({
	id: Product.Id,
	viewKey: Schema.NonEmptyString.check(Schema.isMaxLength(512)),
	chatId: Schema.NullOr(Product.Id),
	botId: Schema.NullOr(Product.Id),
	accepted: Schema.Boolean,
	turnId: Schema.NullOr(Product.Id),
	itemId: Schema.NullOr(Product.Id),
	executionId: Schema.optionalKey(Product.Id),
	commandKey: Schema.optionalKey(Product.RequestId),
})

export type PendingSend = typeof PendingSendSchema.Type

export interface MessageSnapshot {
	readonly chat: Product.Conversation
	readonly turns: typeof Product.TurnPage.Type
}

export const messageRecoveryKey = (identity: string): string =>
	"kay:message-recovery:" + encodeURIComponent(identity)

/** A proxy or transport failure cannot prove that a write was rejected. */
export const messageWasRejected = (error: unknown): boolean =>
	error instanceof RequestFailed &&
	error.status >= 400 &&
	error.status < 500 &&
	error.problem.code !== "outcome_unknown"

const decodeRecoveries = Schema.decodeUnknownSync(
	Schema.Array(PendingSendSchema),
)

/** Recovery keeps request identities, never message text, files, or credentials. */
export const readMessageRecoveries = ({
	storage,
	key,
}: {
	readonly storage: Pick<Storage, "getItem">
	readonly key: string
}): ReadonlyArray<PendingSend> => {
	try {
		const raw = storage.getItem(key)
		return raw === null
			? []
			: decodeRecoveries(JSON.parse(raw), { onExcessProperty: "error" })
	} catch {
		return []
	}
}

export const writeMessageRecoveries = ({
	storage,
	key,
	value,
}: {
	readonly storage: Pick<Storage, "setItem" | "removeItem">
	readonly key: string
	readonly value: ReadonlyArray<PendingSend>
}): void => {
	try {
		if (value.length === 0) storage.removeItem(key)
		else {
			const safe = value.map(
				({
					id,
					viewKey,
					chatId,
					botId,
					accepted,
					turnId,
					itemId,
					executionId,
					commandKey,
				}) => ({
					id,
					viewKey,
					chatId,
					botId,
					accepted,
					turnId,
					itemId,
					...(executionId === undefined ? {} : { executionId }),
					...(commandKey === undefined ? {} : { commandKey }),
				}),
			)
			storage.setItem(key, JSON.stringify(decodeRecoveries(safe)))
		}
	} catch {
		/* The current view retains recovery when browser storage is unavailable. */
	}
}

export const recoveryDelay: {
	(milliseconds: number, signal: AbortSignal): Promise<void>
	(signal: AbortSignal): (milliseconds: number) => Promise<void>
} = dual(
	2,
	(milliseconds: number, signal: AbortSignal): Promise<void> =>
		new Promise((resolve, reject) => {
			signal.throwIfAborted()
			const abort = () => {
				clearTimeout(timer)
				reject(signal.reason)
			}
			const timer = setTimeout(() => {
				signal.removeEventListener("abort", abort)
				resolve()
			}, milliseconds)
			signal.addEventListener("abort", abort, { once: true })
		}),
)

/** Read the saved result of one send. No recovery path can submit work. */
export const recoverMessage = async ({
	pending,
	signal,
	read,
	turns,
	findDirect,
	wait,
	execution,
	commandReceipt,
	delay = recoveryDelay,
	onSnapshot,
	onRetry,
}: {
	readonly pending: PendingSend
	readonly signal: AbortSignal
	readonly read: (
		chatId: string,
		signal: AbortSignal,
	) => Promise<MessageSnapshot>
	readonly turns: (
		chatId: string,
		cursor: string,
		signal: AbortSignal,
	) => Promise<typeof Product.TurnPage.Type>
	readonly findDirect: (
		botId: string,
		signal: AbortSignal,
	) => Promise<string | undefined>
	readonly wait: (
		chatId: string,
		revision: number,
		signal: AbortSignal,
	) => Promise<unknown>
	readonly execution?: (
		id: string,
		signal: AbortSignal,
	) => Promise<Product.Execution>
	readonly commandReceipt?: (
		key: string,
		signal: AbortSignal,
	) => Promise<Product.ExecutionReceipt | null>
	readonly delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>
	readonly onSnapshot?: (snapshot: MessageSnapshot) => void
	readonly onRetry?: (error: unknown) => void
}): Promise<void> => {
	let failures = 0
	let executionId = pending.executionId
	let forwarded: ReadonlyArray<string> = []
	// A recovery can outlive a connection, so keep no growing chain of recursive promises.
	for (;;) {
		signal.throwIfAborted()
		try {
			if (
				executionId === undefined &&
				pending.commandKey !== undefined &&
				commandReceipt !== undefined
			) {
				const receipt = await commandReceipt(pending.commandKey, signal)
				if (receipt !== null) {
					if (receipt.commandKey !== pending.commandKey)
						throw new Error("Recovery returned another command.")
					executionId = receipt.executionId
				}
			}
			const saved =
				executionId === undefined || execution === undefined
					? undefined
					: await execution(executionId, signal)
			if (
				saved !== undefined &&
				(saved.id !== executionId ||
					!["Chat", "Turn"].includes(saved.resource.kind))
			)
				throw new Error("Recovery returned another command resource.")
			if (saved?.forwardedTo !== undefined) {
				if (
					forwarded.includes(saved.forwardedTo) ||
					saved.forwardedTo === executionId
				)
					throw new Error("Recovery returned a command cycle.")
				forwarded = [...forwarded, saved.id]
				executionId = saved.forwardedTo
				continue
			}
			const chatId =
				pending.chatId ??
				(saved?.resource.kind === "Chat" ? saved.resource.id : undefined) ??
				(pending.botId === null
					? undefined
					: await findDirect(pending.botId, signal))
			signal.throwIfAborted()
			if (chatId === undefined) {
				await delay(Math.min(1_000 * 2 ** failures, 15_000), signal)
				failures = Math.min(failures + 1, 4)
				continue
			}
			const snapshot = await read(chatId, signal)
			signal.throwIfAborted()
			if (snapshot.chat.id !== chatId)
				throw new Error("Recovery returned another conversation.")
			if (saved !== undefined) {
				if (saved.resource.kind === "Chat" && saved.resource.id !== chatId)
					throw new Error("Recovery returned another conversation execution.")
				if (saved.resource.kind === "Turn") {
					let page = snapshot.turns
					const visited = new Set<string>()
					while (
						!page.items.some(
							(turn) => turn.chatId === chatId && turn.id === saved.resource.id,
						)
					) {
						if (page.next === null || visited.has(page.next))
							throw new Error("The execution Turn is not in this conversation.")
						visited.add(page.next)
						page = await turns(chatId, page.next, signal)
					}
				}
			}
			signal.throwIfAborted()
			onSnapshot?.(snapshot)
			if (saved !== undefined) {
				// Restoring a waiting command exposes its saved approval or failure.
				// It does not claim that the command succeeded or submit it again.
				if (
					[
						"completed",
						"failed",
						"cancelled",
						"interrupted",
						"waiting",
						"outcome_unknown",
					].includes(saved.status)
				)
					return
				await delay(1_000, signal)
				continue
			}
			if (pending.commandKey !== undefined) {
				await delay(1_000, signal)
				continue
			}
			if (!pending.accepted) {
				// A saved conversation cannot prove that an unacknowledged send arrived.
				await wait(chatId, snapshot.chat.revision, signal)
				signal.throwIfAborted()
				failures = 0
				await delay(1_000, signal)
				continue
			}
			// A receipt or successful stream response confirms acceptance. With no
			// stream Turn to track, restoring the Chat restores observation only.
			if (pending.itemId !== null || pending.turnId === null) return
			let page = snapshot.turns
			let visited: ReadonlyArray<string> = []
			let turn = page.items.find(
				(item) => item.chatId === chatId && item.id === pending.turnId,
			)
			while (turn === undefined && page.next !== null) {
				signal.throwIfAborted()
				if (visited.includes(page.next))
					throw new Error("Recovery received a repeated history cursor.")
				visited = [...visited, page.next]
				page = await turns(chatId, page.next, signal)
				signal.throwIfAborted()
				turn = page.items.find(
					(item) => item.chatId === chatId && item.id === pending.turnId,
				)
			}
			if (
				turn?.status === "Completed" ||
				turn?.status === "Failed" ||
				turn?.status === "Interrupted"
			)
				return
			await wait(chatId, snapshot.chat.revision, signal)
			signal.throwIfAborted()
			failures = 0
			await delay(1_000, signal)
		} catch (error) {
			signal.throwIfAborted()
			if (
				error instanceof RequestFailed &&
				(error.status === 401 || error.status === 403)
			)
				throw error
			onRetry?.(error)
			await delay(Math.min(1_000 * 2 ** failures, 15_000), signal)
			failures = Math.min(failures + 1, 4)
		}
	}
}
