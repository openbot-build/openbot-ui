import { Match, Schema } from "effect"
import { objectOf } from "./SchemaValues.ts"

export const TaskRequest = Schema.Struct({
	id: Schema.String,
	bot: Schema.String,
	chat: Schema.String,
	reason: Schema.String,
	status: Schema.String,
	revision: Schema.Finite,
	createdAt: Schema.Finite,
	expiresAt: Schema.Finite,
	capability: Schema.Struct({
		action: Schema.String,
		target: Schema.String,
		arguments: Schema.optional(Schema.Unknown),
	}),
	app: Schema.optional(Schema.Unknown),
	code: Schema.optional(Schema.Unknown),
})
export type TaskRequest = typeof TaskRequest.Type

export const TaskChat = Schema.Struct({
	chat: Schema.Struct({
		id: Schema.String,
		bot: Schema.String,
		title: Schema.optional(Schema.String),
		parent: Schema.NullOr(
			Schema.Struct({ chat: Schema.String, delegation: Schema.String }),
		),
		createdAt: Schema.Finite,
	}),
	status: Schema.String,
	activity: Schema.String,
})
export type TaskChat = typeof TaskChat.Type

export const TaskTodo = Schema.Struct({
	id: Schema.String,
	content: Schema.String,
	status: Schema.String,
})
export type TaskTodo = typeof TaskTodo.Type

/** Both current and imported tool calls expose these native summary fields. */
export const TaskToolCall = Schema.Struct({
	id: Schema.String,
	executionId: Schema.String,
	tool: Schema.String,
	status: Schema.String,
})
export type TaskToolCall = typeof TaskToolCall.Type
export const readTaskToolCalls = (value: unknown) =>
	Schema.decodeUnknownSync(Schema.Array(TaskToolCall))(value)
export const readTaskToolResult = ({
	value,
	expected,
}: {
	readonly value: unknown
	readonly expected: TaskToolCall
}) => {
	const result = Schema.decodeUnknownSync(
		Schema.Struct({
			...TaskToolCall.fields,
			output: Schema.NullOr(Schema.Json),
		}),
	)(value)
	if (result.id !== expected.id || result.executionId !== expected.executionId)
		throw new Error("The tool result belongs to another action.")
	return result
}

export const readTaskRequests = (value: unknown) =>
	Schema.decodeUnknownSync(Schema.Array(TaskRequest))(value)
export const readTaskChats = (value: unknown) =>
	Schema.decodeUnknownSync(Schema.Array(TaskChat))(value)
export const readTaskTodos = (value: unknown) =>
	Schema.decodeUnknownSync(Schema.Struct({ items: Schema.Array(TaskTodo) }))(
		value,
	)

/** A stopped or idle Chat is not evidence that its delegated work is complete. */
export const taskLane = (
	status: string,
): "attention" | "working" | "finished" =>
	Match.value(status).pipe(
		Match.when("Completed", () => "finished" as const),
		Match.when(
			(value) => value === "Failed" || value === "Interrupted",
			() => "attention" as const,
		),
		Match.orElse(() => "working" as const),
	)

export const approvalInput = ({
	shown,
	current,
	decision,
}: {
	readonly shown: TaskRequest
	readonly current: TaskRequest
	readonly decision: "allow" | "deny"
}) => {
	if (
		current.id !== shown.id ||
		current.revision !== shown.revision ||
		current.status !== "pending"
	)
		return undefined
	return {
		params: { requestId: current.id },
		payload: {
			expected: current.revision,
			decision,
			...(decision === "allow" ? { scope: "once" } : {}),
		},
	}
}

export const taskOperationState = (value: unknown): string => {
	const status = objectOf(value)["status"]
	return typeof status === "string"
		? status
		: typeof objectOf(status)["_tag"] === "string"
			? String(objectOf(status)["_tag"])
			: ""
}

export const textOf = (value: unknown): string =>
	typeof value === "string" ? value : ""
