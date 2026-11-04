import type * as Product from "@kaicom/kay-contracts"

export interface TranscriptToolPart {
	readonly id: string
	readonly messageId: string
	readonly sourceItemId: string
	readonly partIndex: number
	readonly type: "tool-call" | "tool-result"
	readonly value: NonNullable<typeof Product.MessagePart.Type.details>
}

export interface TranscriptToolRecord {
	readonly id: string
	readonly toolId: string
	readonly name: string
	readonly parts: ReadonlyArray<TranscriptToolPart>
}

interface SavedPart {
	readonly message: typeof Product.Message.Type
	readonly part: typeof Product.MessagePart.Type
	readonly partIndex: number
	readonly order: number
}

const object = (value: unknown): Readonly<Record<string, unknown>> | null =>
	value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Readonly<Record<string, unknown>>)
		: null

/** Keep structured content and links in the transcript's existing renderers. */
const hasVisibleContent = (value: unknown): boolean => {
	if (typeof value === "string")
		return /(?:https?:\/\/|openbot-file:|ui:\/\/|data:image\/)/i.test(value)
	if (Array.isArray(value)) return value.some(hasVisibleContent)
	const body = object(value)
	if (body === null) return false
	return (
		typeof body["type"] === "string" ||
		body["object"] === "file" ||
		["status", "state"].some(
			(key) =>
				key in body &&
				!["completed", "succeeded", "success", "ok"].includes(
					String(body[key]),
				),
		) ||
		"approvalId" in body ||
		"approval" in body ||
		(body["requiresApproval"] !== undefined &&
			body["requiresApproval"] !== false) ||
		Object.values(body).some(hasVisibleContent)
	)
}

const successfulResult = (entry: SavedPart): boolean => {
	const details = entry.part.details
	if (
		entry.part.text !== undefined ||
		details?.["type"] !== "tool-result" ||
		details["isFailure"] !== false ||
		!("result" in details)
	)
		return false
	const body = object(details["result"])
	return (
		body?.["isError"] !== true &&
		body?.["denied"] !== true &&
		body?.["error"] === undefined &&
		body?.["pending"] !== true &&
		![
			"Failed",
			"Failure",
			"Pending",
			"InputRequired",
			"OutcomeUnknown",
		].includes(String(body?.["_tag"])) &&
		!hasVisibleContent(details["result"])
	)
}

const failedResult = (entry: SavedPart): boolean => {
	const details = entry.part.details
	if (details?.["type"] !== "tool-result") return false
	const body = object(details["result"])
	return (
		details["isFailure"] === true ||
		body?.["isError"] === true ||
		body?.["denied"] === true ||
		body?.["error"] !== undefined ||
		body?.["_tag"] === "Failed" ||
		body?.["_tag"] === "Failure"
	)
}

const recordPart = ({
	entry,
	type,
}: {
	readonly entry: SavedPart
	readonly type: TranscriptToolPart["type"]
}): TranscriptToolPart => ({
	id: JSON.stringify([entry.message.id, entry.partIndex]),
	messageId: entry.message.id,
	sourceItemId: entry.message.sourceItemId,
	partIndex: entry.partIndex,
	type,
	value: entry.part.details ?? {},
})

/** Copy failed pairs for inspection; relocate only complete current-Turn successes. */
export const transcriptActivity = ({
	page,
	activity,
}: {
	readonly page: typeof Product.MessagePage.Type
	/** Pass null while activity is unavailable or stale to retain the transcript. */
	readonly activity: Product.ConversationActivity | null
}): {
	readonly page: typeof Product.MessagePage.Type
	readonly records: ReadonlyArray<TranscriptToolRecord>
} => {
	if (activity === null) return { page, records: [] }
	const parts: ReadonlyArray<SavedPart> = page.items
		.toSorted((first, second) => first.sequence - second.sequence)
		.flatMap((message) =>
			message.parts.map((part, partIndex) => ({ message, part, partIndex })),
		)
		.map((entry, order) => ({ ...entry, order }))
	const records = activity.tools.flatMap(
		(tool): ReadonlyArray<TranscriptToolRecord> => {
			if (
				tool.turnId === null ||
				tool.itemId === null ||
				(tool.status !== "failed" &&
					(tool.status !== "completed" || tool.turnId !== activity.turnId)) ||
				activity.tools.filter(
					(other) =>
						other.turnId === tool.turnId &&
						other.itemId === tool.itemId &&
						other.name === tool.name,
				).length !== 1
			)
				return []
			const calls = parts.filter(
				(entry) =>
					entry.message.sourceItemId === tool.itemId &&
					entry.message.turnId === tool.turnId &&
					entry.message.role === "assistant" &&
					entry.part.type === "tool-call" &&
					entry.part.details?.["name"] === tool.name,
			)
			const call = calls.length === 1 ? calls[0] : undefined
			const callId = call?.part.details?.["id"]
			if (
				call === undefined ||
				call.part.text !== undefined ||
				call.part.details?.["type"] !== "tool-call" ||
				typeof callId !== "string" ||
				callId.length === 0
			)
				return []
			const nextCall = parts.find(
				(entry) =>
					entry.order > call.order &&
					entry.message.turnId === tool.turnId &&
					entry.part.type === "tool-call" &&
					entry.part.details?.["id"] === callId,
			)
			const results = parts.filter(
				(entry) =>
					entry.order > call.order &&
					(nextCall === undefined || entry.order < nextCall.order) &&
					entry.message.turnId === tool.turnId &&
					entry.message.role === "tool" &&
					entry.part.type === "tool-result" &&
					entry.part.details?.["id"] === callId &&
					entry.part.details["name"] === tool.name,
			)
			const result = results.length === 1 ? results[0] : undefined
			if (
				result === undefined ||
				!(tool.status === "failed"
					? failedResult(result)
					: successfulResult(result))
			)
				return []
			return [
				{
					id: JSON.stringify([
						activity.chatId,
						tool.turnId,
						call.message.sourceItemId,
						call.message.id,
						call.partIndex,
					]),
					toolId: tool.id,
					name: tool.name,
					parts: [
						recordPart({ entry: call, type: "tool-call" }),
						recordPart({ entry: result, type: "tool-result" }),
					],
				},
			]
		},
	)
	const relocated = records.filter((record) =>
		activity.tools.some(
			(tool) =>
				tool.id === record.toolId &&
				tool.status === "completed" &&
				tool.turnId === activity.turnId,
		),
	)
	if (relocated.length === 0) return { page, records }
	return {
		page: {
			...page,
			items: page.items.flatMap((message) => {
				const remaining = message.parts.filter(
					(_, partIndex) =>
						!relocated.some((record) =>
							record.parts.some(
								(part) =>
									part.messageId === message.id && part.partIndex === partIndex,
							),
						),
				)
				if (remaining.length === message.parts.length) return [message]
				return remaining.length === 0 ? [] : [{ ...message, parts: remaining }]
			}),
		},
		records,
	}
}
