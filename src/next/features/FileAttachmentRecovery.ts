import * as Product from "@kaicom/kay-contracts"
import { type Client } from "@kaicom/kay-contracts/Client"
import { Schema } from "effect"
import { messageWasRejected } from "../MessageRecovery.ts"
import { attachSavedFile, savedAttachment } from "./FilesData.ts"

type ReceiptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">
type Scope = {
	readonly storage: ReceiptStorage
	readonly identity: Pick<
		typeof Product.Identity.Type,
		"userId" | "organizationId"
	>
	readonly chatId: string
	readonly fileId: string
}
const Receipt = Schema.Struct({
	requestId: Product.RequestId,
	expected: Product.Revision,
})
const receiptKey = (input: Omit<Scope, "storage">) =>
	"kay:file-attachment:" +
	JSON.stringify([
		input.identity.organizationId,
		input.identity.userId,
		input.chatId,
		input.fileId,
	])
const readReceipt = (input: Scope) => {
	const raw = input.storage.getItem(receiptKey(input))
	return raw === null
		? null
		: Schema.decodeUnknownSync(Receipt)(JSON.parse(raw), {
				onExcessProperty: "error",
			})
}
export const hasPendingFileAttachment = (input: Scope): boolean => {
	try {
		return input.storage.getItem(receiptKey(input)) !== null
	} catch {
		return false
	}
}

/** This receipt stays pending across refresh; a later attempt may only read it. */
export class FileAttachmentUnconfirmed extends Error {}

export const saveFileAttachment = async (
	input: Scope & {
		readonly client: Pick<Client, "conversation" | "attachFile" | "messages">
		readonly requestId: string
		readonly signal: AbortSignal
	},
) => {
	input.signal.throwIfAborted()
	const controller = new AbortController()
	const abort = () => controller.abort(input.signal.reason)
	input.signal.addEventListener("abort", abort, { once: true })
	const timeout = setTimeout(
		() =>
			controller.abort(
				new Error("The saved attachment could not be checked in time."),
			),
		8000,
	)
	const signal = controller.signal
	const key = receiptKey(input)
	let receipt: typeof Receipt.Type | null = null
	try {
		receipt = readReceipt(input)
		if (receipt === null) {
			try {
				const result = await attachSavedFile({
					...input,
					signal,
					client: {
						conversation: input.client.conversation,
						attachFile: (id, payload, requestSignal) => {
							const pending = {
								requestId: payload.requestId,
								expected: payload.expected,
							}
							// Persist before dispatch so a lost response or closed view cannot cause another write.
							input.storage.setItem(key, JSON.stringify(pending))
							receipt = pending
							return input.client.attachFile(id, payload, requestSignal)
						},
					},
				})
				input.storage.removeItem(key)
				return result
			} catch (error) {
				if (receipt === null) throw error
				if (messageWasRejected(error)) {
					input.storage.removeItem(key)
					throw error
				}
			}
		}
		if (receipt === null) throw new Error("The attachment receipt is missing.")
		const itemId = Product.attachmentItemId(receipt.requestId)
		for (let attempt = 0; attempt < 3; attempt++) {
			signal.throwIfAborted()
			let before: number | undefined
			for (let pageNumber = 0; pageNumber < 4; pageNumber++) {
				const page = await input.client.messages(input.chatId, before, signal)
				signal.throwIfAborted()
				const saved = page.items.find((item) => item.sourceItemId === itemId)
				if (saved !== undefined) {
					if (
						!saved.parts.some(
							(part) => savedAttachment(part)?.fileId === input.fileId,
						)
					)
						throw new Error("The saved attachment does not match this file.")
					const chat = await input.client.conversation(input.chatId, signal)
					signal.throwIfAborted()
					if (chat.id !== input.chatId)
						throw new Error("The conversation could not be verified.")
					input.storage.removeItem(key)
					return chat
				}
				if (page.next === null || page.next === before) break
				before = page.next
			}
			if (attempt < 2)
				await new Promise<void>((resolve, reject) => {
					const stopped = () => {
						clearTimeout(timer)
						reject(signal.reason)
					}
					const timer = setTimeout(() => {
						signal.removeEventListener("abort", stopped)
						resolve()
					}, 500)
					signal.addEventListener("abort", stopped, { once: true })
				})
		}
		throw new Error(
			"The attachment is not confirmed yet. Check its saved state again; it will not be sent twice.",
		)
	} catch (error) {
		if (input.signal.aborted) throw error
		if (receipt !== null && input.storage.getItem(key) !== null)
			throw new FileAttachmentUnconfirmed(
				error instanceof Error
					? error.message
					: "The saved attachment could not be checked.",
			)
		throw error
	} finally {
		clearTimeout(timeout)
		input.signal.removeEventListener("abort", abort)
	}
}
