import { Schema } from "effect"
import type { NativeClient } from "@kaicom/kay-contracts/Native"
import { chatExecutionStream } from "./ExecutionStream.ts"

const Id = Schema.NonEmptyString.check(Schema.isMaxLength(256))
const Cursor = Schema.Struct({
	id: Id,
	sequence: Schema.Natural,
	status: Schema.Literals([
		"queued",
		"running",
		"waiting",
		"cancelling",
		"completed",
		"failed",
		"cancelled",
		"interrupted",
		"outcome_unknown",
	]),
})
const Snapshot = Schema.Struct({
	chat: Schema.Struct({ id: Id }),
	turn: Schema.NullOr(Schema.Struct({ id: Id, chat: Id })),
	executionId: Schema.optionalKey(Schema.NullOr(Id)),
	activeExecution: Schema.optionalKey(Cursor),
})
const Execution = Schema.Struct({
	id: Id,
	sequence: Schema.Natural,
	status: Cursor.fields.status,
	resource: Schema.Struct({ kind: Schema.String, id: Id }),
})

/** Observe the current authorized Turn without issuing or acknowledging a command. */
export const observeChat = async ({
	chatId,
	client,
	observe,
}: {
	readonly chatId: string
	readonly client: NativeClient
	readonly observe: (
		executionId: string,
		afterSequence: number,
		signal: AbortSignal,
	) => Promise<Response>
}): Promise<Response> => {
	const response = await client.request({ operation: "chat", id: chatId })
	if (!response.ok) return response
	try {
		const chat = Schema.decodeUnknownSync(Snapshot)(await response.json())
		if (
			chat.chat.id !== chatId ||
			(chat.turn !== null && chat.turn.chat !== chatId)
		)
			throw new Error("The conversation does not match the request.")
		const cursor = chat.activeExecution
		if (cursor === undefined) return new Response(null, { status: 204 })
		if (chat.turn === null || chat.executionId !== cursor.id)
			throw new Error("The execution does not belong to the current Turn.")
		const state = await client.request({
			operation: "execution",
			id: cursor.id,
		})
		if (!state.ok) return state
		const execution = Schema.decodeUnknownSync(Execution)(await state.json())
		if (
			execution.id !== cursor.id ||
			execution.resource.kind !== "Turn" ||
			execution.resource.id !== chat.turn.id ||
			execution.sequence < cursor.sequence
		)
			throw new Error("The current execution could not be verified.")
		if (
			["completed", "failed", "cancelled", "interrupted"].includes(
				execution.status,
			)
		)
			return new Response(null, { status: 204 })
		return chatExecutionStream({
			receipt: {
				chat: chatId,
				turn: chat.turn.id,
				executionId: cursor.id,
				sequence: cursor.sequence,
			},
			acknowledge: false,
			afterSequence: cursor.sequence,
			observe: (signal) => observe(cursor.id, cursor.sequence, signal),
		})
	} catch {
		return Response.json(
			{
				code: "unavailable",
				message: "The current conversation activity could not be verified.",
			},
			{ status: 502 },
		)
	}
}
