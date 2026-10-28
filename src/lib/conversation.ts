import { ExecutionsApi, ToolCallsApi, type ChatView } from "@openbot-build/client/Api"
import type { Item } from "@openbot-build/client/Core"
import { Option, Schema } from "effect"
import type { Prompt } from "effect/ai"
import type { HttpApiEndpoint } from "effect/http-api"

const { Execution } = ExecutionsApi

export type ChatTurn = NonNullable<ChatView["turn"]>
export type ToolCall = HttpApiEndpoint.Success<
	typeof ToolCallsApi.endpoints.get
>["Type"]

/** A tool call of a Bot, with its result when it has one. */
export interface ToolStep {
	readonly kind: "tool"
	readonly id: string
	readonly name: string
	readonly params: unknown
	readonly result:
		{ readonly value: unknown; readonly failed: boolean } | undefined
	/** The tool call waits for a person to allow it. */
	readonly waiting: boolean
	/**
	 * The tool call took more time than its budget and went on in the background.
	 * Its result comes later, when the operation ends.
	 */
	readonly operation?: ToolCall
}

/**
 * A file in a message. `id` is the OpenBot file, when the message names one.
 * Then the page can load its content.
 */
export interface FileRef {
	readonly id: string | undefined
	readonly name: string
	readonly mediaType: string
}

/** One piece of an answer, in the order the Bot made it. */
export type Segment =
	| { readonly kind: "text"; readonly text: string }
	| { readonly kind: "reasoning"; readonly text: string }
	| ToolStep
	| ({ readonly kind: "file" } & FileRef)

/** One row of the chat: a message of the person, or an answer of the Bot. */
export type Row =
	| {
			readonly kind: "user"
			readonly id: string
			readonly text: string
			readonly files: ReadonlyArray<FileRef>
	  }
	| {
			readonly kind: "assistant"
			readonly id: string
			readonly turn: ChatTurn | undefined
			readonly segments: ReadonlyArray<Segment>
	  }

/** The text parts of an answer, joined, for the copy button. */
export const answerText = (segments: ReadonlyArray<Segment>) =>
	segments
		.flatMap((segment) => (segment.kind === "text" ? [segment.text] : []))
		.join("\n\n")
		.trim()

/** A Chat names an uploaded file with an address like `openbot-file:file_123`. */
const fileScheme = "openbot-file:"

const fileRef = (part: Prompt.FilePart): FileRef => {
	const address = part.data instanceof URL ? part.data.href : part.data
	return {
		id:
			typeof address === "string" && address.startsWith(fileScheme)
				? address.slice(fileScheme.length)
				: undefined,
		name: part.fileName ?? part.mediaType,
		mediaType: part.mediaType,
	}
}

const userRow = (id: string, message: Prompt.UserMessage): Row => ({
	kind: "user",
	id,
	text: message.content
		.flatMap((part) => (part.type === "text" ? [part.text] : []))
		.join("\n"),
	files: message.content.flatMap((part) =>
		part.type === "file" ? [fileRef(part)] : [],
	),
})

const assistantSegments = (
	message: Prompt.AssistantMessage,
): ReadonlyArray<Segment> =>
	message.content.flatMap((part): ReadonlyArray<Segment> => {
		switch (part.type) {
			case "text":
				return part.text.trim().length === 0
					? []
					: [{ kind: "text", text: part.text }]
			case "reasoning":
				return part.text.trim().length === 0
					? []
					: [{ kind: "reasoning", text: part.text }]
			case "tool-call":
				return [
					{
						kind: "tool",
						id: part.id,
						name: part.name,
						params: part.params,
						result: undefined,
						waiting: false,
					},
				]
			case "file":
				return [{ kind: "file", ...fileRef(part) }]
			default:
				return []
		}
	})

/** The saved output of a new tool call wraps its result and failure flag. */
const savedToolOutput = Schema.decodeUnknownOption(
	Schema.Struct({
		result: Schema.optionalKey(Schema.Unknown),
		isFailure: Schema.Boolean,
	}),
)

/** The saved result stays distinct from the status of the execution. */
const operationResult = (operation: ToolCall): ToolStep["result"] => {
	if (!Execution.isTerminal(operation.status)) return undefined
	if ("_tag" in operation) {
		if (operation.status === "completed")
			return { value: operation.output, failed: false }
	} else if (operation.output !== null) {
		const output = savedToolOutput(operation.output)
		if (Option.isSome(output))
			return { value: output.value.result, failed: output.value.isFailure }
	}
	switch (operation.status) {
		case "completed":
			return { value: operation.output, failed: false }
		case "cancelled":
			return { value: "Someone stopped this work.", failed: true }
		case "interrupted":
			return { value: "The server stopped this work.", failed: true }
		default:
			return { value: "The tool call failed.", failed: true }
	}
}

/** Gives a tool step its execution and saved result. */
const withOperation = (
	step: ToolStep,
	item: Item.Record,
	turn: ChatTurn | undefined,
	operations: ReadonlyArray<ToolCall>,
): ToolStep => {
	const operation = operations.find(
		(operation) =>
			operation.callId === step.id &&
			("position" in operation
				? operation.position.item === item.id
				: operation.turn === turn?.id),
	)
	if (operation === undefined) return step
	return {
		...step,
		operation,
		result: operationResult(operation),
		waiting: step.waiting || operation.status === "waiting",
	}
}

/**
 * Turns the history of a Chat into chat rows. Tool results and approval
 * requests join the tool call that they belong to, so one answer of the Bot
 * is one row, however many steps it took. A tool call that went on in the
 * background gets the result of its operation.
 */
export const buildRows = (
	history: ReadonlyArray<Item.Record>,
	turns: ReadonlyArray<ChatTurn>,
	operations: ReadonlyArray<ToolCall> = [],
): ReadonlyArray<Row> => {
	const turnOfItem = new Map<string, ChatTurn>(
		turns.flatMap((turn) =>
			[...turn.input, ...turn.items].map((item) => [item, turn] as const),
		),
	)
	const rows: Array<Row> = []
	const results = new Map<string, { value: unknown; failed: boolean }>()
	const waiting = new Set<string>()
	const answered = new Set<string>()

	for (const item of history) {
		for (const message of item.content.content) {
			if (message.role === "tool")
				for (const part of message.content) {
					if (part.type === "tool-result")
						results.set(part.id, { value: part.result, failed: part.isFailure })
					if (part.type === "tool-approval-response")
						answered.add(part.approvalId)
				}
			if (message.role === "assistant")
				for (const part of message.content) {
					if (part.type === "tool-result")
						results.set(part.id, { value: part.result, failed: part.isFailure })
				}
		}
	}
	for (const item of history)
		for (const message of item.content.content)
			if (message.role === "assistant")
				for (const part of message.content)
					if (
						part.type === "tool-approval-request" &&
						!answered.has(part.approvalId)
					)
						waiting.add(part.toolCallId)

	for (const item of history) {
		for (const [index, message] of item.content.content.entries()) {
			const id = `${item.id}:${index}`
			if (message.role === "user") {
				// A notice is input from OpenBot, such as the end of work that a Bot
				// gave away. The person did not write it, so it is not their message.
				if (item.origin?.notice === undefined) rows.push(userRow(id, message))
				continue
			}
			if (message.role !== "assistant") continue
			const segments = assistantSegments(message).map((segment) =>
				segment.kind === "tool"
					? withOperation(
							{
								...segment,
								result: results.get(segment.id),
								waiting: waiting.has(segment.id) && !results.has(segment.id),
							},
							item,
							turnOfItem.get(item.id),
							operations,
						)
					: segment,
			)
			const last = rows.at(-1)
			if (last?.kind === "assistant") {
				rows[rows.length - 1] = {
					...last,
					segments: [...last.segments, ...segments],
					turn: last.turn ?? turnOfItem.get(item.id),
				}
			} else {
				rows.push({
					kind: "assistant",
					id,
					turn: turnOfItem.get(item.id),
					segments,
				})
			}
		}
	}
	return rows
}

/** A short, readable name for a tool, such as `Read file` for `read_file`. */
export const toolLabel = (name: string) => {
	const words = name
		.replace(/^.*[./:]/, "")
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.replace(/[_-]+/g, " ")
		.trim()
	return words.length === 0
		? name
		: words[0]!.toUpperCase() + words.slice(1).toLowerCase()
}

/** Shows a value of a tool as text: strings as they are, other values as JSON. */
export const showValue = (value: unknown): string => {
	if (typeof value === "string") return value
	try {
		return JSON.stringify(value, null, 2) ?? String(value)
	} catch {
		return String(value)
	}
}

/** How long a Turn took, such as `12s` or `3m 4s`. */
export const turnDuration = (turn: ChatTurn | undefined) => {
	if (turn?.completedAt === undefined) return undefined
	const seconds = Math.max(
		0,
		Math.round((turn.completedAt - turn.startedAt) / 1000),
	)
	if (seconds < 60) return `${seconds}s`
	return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

/**
 * The first line of an error message. A failed Turn can carry a whole stack
 * trace, and people need only the reason.
 */
export const errorSummary = (message: string) =>
	message.split("\n", 1)[0]?.trim() || "The answer failed."
