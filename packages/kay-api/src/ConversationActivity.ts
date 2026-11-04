import { Schema } from "effect"
import { createHash } from "node:crypto"
import {
	ActivityExecution,
	ActivityTodo,
	ConversationActivity,
} from "@kaicom/kay-contracts"
import type { NativeCall } from "@kaicom/kay-contracts/Native"

export class ConversationActivityFailure extends Error {
	readonly status: 400 | 409 | 502 | 503
	constructor(status: 400 | 409 | 502 | 503, message: string) {
		super(message)
		this.status = status
	}
}

const Id = Schema.NonEmptyString.check(Schema.isMaxLength(256))
const Model = Schema.Struct({ provider: Id, model: Id })
const Settings = Schema.Struct({ model: Schema.optionalKey(Model) })
const ActiveTool = Schema.Struct({
	executionId: Id,
	step: Schema.NonEmptyString,
	attempt: Schema.Natural,
	tool: Schema.Struct({
		chatId: Id,
		turnId: Id,
		itemId: Id,
		callId: Id,
		name: Schema.NonEmptyString,
		computerId: Schema.optionalKey(Id),
	}),
	status: Schema.Literals([
		"queued",
		"running",
		"waiting",
		"cancelling",
		"outcome_unknown",
	]),
})
const Snapshot = Schema.Struct({
	chat: Schema.Struct({ id: Id, revision: Schema.Natural, settings: Settings }),
	status: ConversationActivity.fields.status,
	executionId: Schema.optionalKey(Schema.NullOr(Id)),
	activeExecution: Schema.optionalKey(ActivityExecution),
	activeTools: Schema.optionalKey(Schema.Array(ActiveTool)),
	turn: Schema.NullOr(
		Schema.Struct({
			id: Id,
			chat: Id,
			settings: Settings,
		}),
	),
})
const Item = Schema.Struct({
	id: Id,
	seq: Schema.Natural,
	origin: Schema.optionalKey(Schema.Struct({ chat: Id, turn: Id })),
	content: Schema.Struct({ content: Schema.Array(Schema.JsonObject) }),
})
type Item = typeof Item.Type
const Page = Schema.Struct({
	items: Schema.Array(Item),
	next: Schema.NullOr(Schema.Natural),
})
const Tool = Schema.Struct({
	id: Id,
	executionId: Id,
	callId: Id,
	tool: Schema.String,
	status: ConversationActivity.fields.tools.value.fields.status,
	position: Schema.optionalKey(Schema.Struct({ chat: Id, turn: Id, item: Id })),
	chat: Schema.optionalKey(Id),
	turn: Schema.optionalKey(Id),
	startedAt: Schema.optionalKey(Schema.Finite),
	endedAt: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
})
const Delegation = Schema.Struct({
	id: Id,
	chat: Schema.NullOr(Id),
	parent: Schema.Struct({ chat: Id, turn: Schema.optionalKey(Id) }),
	task: Schema.String,
	status: ConversationActivity.fields.delegations.value.fields.status,
	executionStatus: ConversationActivity.fields.tools.value.fields.status,
	executionId: Id,
	result: Schema.NullOr(Schema.String),
})
const AppOperation = Schema.Struct({
	id: Id,
	executionId: Id,
	chat: Id,
	turn: Id,
	callId: Schema.optionalKey(Schema.String),
	toolName: Schema.String,
	source: Schema.optionalKey(
		Schema.Struct({
			name: Schema.optionalKey(Schema.String),
			appName: Schema.optionalKey(Schema.String),
		}),
	),
	status: ConversationActivity.fields.tools.value.fields.status,
})
type AppOperation = typeof AppOperation.Type
const invalid = (): never => {
	throw new ConversationActivityFailure(
		502,
		"The saved activity could not be read.",
	)
}
const validate = <A>(read: () => A): A => {
	try {
		return read()
	} catch (error) {
		if (error instanceof ConversationActivityFailure) throw error
		return invalid()
	}
}
const object = (value: unknown): Schema.JsonObject | undefined =>
	value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Schema.JsonObject)
		: undefined
const sameSnapshot = (
	first: typeof Snapshot.Type,
	last: typeof Snapshot.Type,
) =>
	first.chat.id === last.chat.id &&
	first.chat.revision === last.chat.revision &&
	first.turn?.id === last.turn?.id &&
	first.status === last.status &&
	JSON.stringify(first.activeExecution) ===
		JSON.stringify(last.activeExecution) &&
	JSON.stringify(first.activeTools) === JSON.stringify(last.activeTools)
const changed = (): never => {
	throw new ConversationActivityFailure(
		409,
		"The conversation changed. Read its activity again.",
	)
}

interface SavedPart {
	readonly item: Item
	readonly part: Schema.JsonObject
	readonly role: string
	readonly channel: unknown
	readonly order: number
	readonly messageIndex: number
	readonly partIndex: number
}
const partsOf = (items: ReadonlyArray<Item>): ReadonlyArray<SavedPart> =>
	items
		.toSorted((first, second) => first.seq - second.seq)
		.flatMap((item) =>
			item.content.content.flatMap((message, messageIndex) => {
				if (typeof message["role"] !== "string") return invalid()
				const content = message["content"]
				const parts =
					typeof content === "string"
						? [{ type: "text", text: content }]
						: Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(content)
				return parts.map((part, partIndex) => ({
					item,
					part,
					messageIndex,
					partIndex,
					role: message["role"] as string,
					channel: part["channel"] ?? message["channel"],
				}))
			}),
		)
		.map((part, order) => ({ ...part, order }))

const callsOf = (parts: ReadonlyArray<SavedPart>) =>
	parts.filter(
		({ role, part }) => role === "assistant" && part["type"] === "tool-call",
	)
/** Match one saved occurrence, never a call with the same ID in a later model step. */
const resultsOf = (
	call: SavedPart,
	parts: ReadonlyArray<SavedPart>,
): ReadonlyArray<SavedPart> => {
	const nextCall = parts.find(
		(part) =>
			part.order > call.order &&
			part.part["type"] === "tool-call" &&
			part.part["id"] === call.part["id"] &&
			part.item.origin?.turn === call.item.origin?.turn,
	)
	return parts.filter(
		(part) =>
			part.order > call.order &&
			(nextCall === undefined || part.order < nextCall.order) &&
			part.role === "tool" &&
			part.part["type"] === "tool-result" &&
			part.part["id"] === call.part["id"] &&
			part.part["name"] === call.part["name"] &&
			part.item.origin?.turn !== undefined &&
			part.item.origin.turn === call.item.origin?.turn,
	)
}
const resultOf = (
	call: SavedPart,
	parts: ReadonlyArray<SavedPart>,
): SavedPart | undefined => {
	const results = resultsOf(call, parts)
	return results.length === 1 ? results[0] : undefined
}
const successful = (result: SavedPart | undefined): result is SavedPart => {
	if (result === undefined || result.part["isFailure"] === true) return false
	const body = object(result.part["result"])
	return (
		body !== undefined &&
		body["error"] === undefined &&
		body["_tag"] !== "Failed" &&
		body["_tag"] !== "Failure"
	)
}

const appNames = (operation: AppOperation | undefined) => {
	const displayName = operation?.source?.name
	const appName = operation?.source?.appName
	return {
		...(displayName !== undefined && displayName.trim().length > 0
			? { displayName }
			: {}),
		...(appName !== undefined && appName.trim().length > 0 ? { appName } : {}),
	}
}
const toolAppNames = (
	call: SavedPart | undefined,
	parts: ReadonlyArray<SavedPart>,
	calls: ReadonlyArray<SavedPart>,
	operations: ReadonlyArray<AppOperation>,
	historyComplete: boolean,
) => {
	// A code run can contain several App calls. None names the entire program.
	if (call === undefined || call.part["name"] === "openbot_run_code") return {}
	const candidates = operations.filter(
		(operation) =>
			operation.chat === call.item.origin?.chat &&
			operation.turn === call.item.origin?.turn &&
			operation.toolName === call.part["name"],
	)
	const results = resultsOf(call, parts)
	if (results.length > 1) return {}
	const saved = results[0]
	const operationId = object(saved?.part["result"])?.["operationId"]
	if (operationId !== undefined) {
		const matches = candidates.filter(
			(operation) =>
				operation.id === operationId &&
				(operation.callId === undefined ||
					operation.callId === call.part["id"]),
		)
		return appNames(matches.length === 1 ? matches[0] : undefined)
	}
	// Unread history could contain another occurrence of this same call ID.
	if (!historyComplete) return {}
	// Before a result exists, the same call ID may still appear in another step.
	const occurrences = calls.filter(
		(other) =>
			other.item.origin?.chat === call.item.origin?.chat &&
			other.item.origin?.turn === call.item.origin?.turn &&
			other.part["id"] === call.part["id"] &&
			other.part["name"] === call.part["name"],
	)
	const matches = candidates.filter(
		(operation) => operation.callId === call.part["id"],
	)
	return appNames(
		occurrences.length === 1 && matches.length === 1 ? matches[0] : undefined,
	)
}

const foregroundStatus = (
	call: SavedPart,
	parts: ReadonlyArray<SavedPart>,
	snapshot: typeof Snapshot.Type,
): ConversationActivity["tools"][number]["status"] => {
	const result = resultOf(call, parts)
	if (result === undefined) {
		const latest = callsOf(parts).findLast(
			(entry) => entry.item.origin?.turn === snapshot.turn?.id,
		)
		return snapshot.status === "Running" &&
			snapshot.turn !== null &&
			call.item.origin?.turn === snapshot.turn.id &&
			call.item.id === latest?.item.id
			? "running"
			: "outcome_unknown"
	}
	const body = object(result.part["result"])
	if (
		result.part["isFailure"] === true ||
		body?.["isError"] === true ||
		body?.["denied"] === true ||
		body?.["error"] !== undefined ||
		body?.["_tag"] === "Failed" ||
		body?.["_tag"] === "Failure"
	)
		return "failed"
	if (
		body?.["pending"] === true ||
		body?.["_tag"] === "Pending" ||
		body?.["_tag"] === "InputRequired"
	)
		return "waiting"
	if (
		result.part["isFailure"] !== false ||
		!("result" in result.part) ||
		body?.["_tag"] === "OutcomeUnknown"
	)
		return "outcome_unknown"
	return "completed"
}
const todoList = (value: unknown) => {
	const items = Schema.decodeUnknownSync(Schema.Array(ActivityTodo))(value)
	if (
		items.some(
			(item, index) =>
				items.findIndex((other) => other.id === item.id) !== index,
		) ||
		items.filter((item) => item.status === "in_progress").length > 1
	)
		return invalid()
	return items
}
const historicalPlan = (
	parts: ReadonlyArray<SavedPart>,
): ConversationActivity["plan"] => {
	const saved = callsOf(parts)
		.toReversed()
		.find((call) => {
			const result = resultOf(call, parts)
			if (!successful(result)) return false
			const body = object(result.part["result"])!
			if (call.part["name"] === "openbot_submit_plan")
				return body["approved"] === true
			if (call.part["name"] !== "openbot_todos") return false
			// Waiting and denied tool results are saved too. Only this tool's success
			// receipt proves that its requested list became the current list.
			if (!Number.isInteger(body["open"]) || !Number.isInteger(body["done"]))
				return false
			const items = todoList(object(call.part["params"])?.["items"])
			return (
				body["done"] ===
					items.filter((item) => item.status === "done").length &&
				body["open"] === items.filter((item) => item.status !== "done").length
			)
		})
	if (saved === undefined)
		return { source: "none", items: [], sourceItemId: null, turnId: null }
	return {
		source: "history",
		items: todoList(object(saved.part["params"])?.["items"]),
		sourceItemId: saved.item.id,
		turnId: saved.item.origin?.turn ?? null,
	}
}
const computerTools = [
	"openbot_computers_acquire",
	"openbot_computers_release",
	"openbot_computers_pause",
	"openbot_computers_resume",
	"openbot_computer_exec",
	"openbot_computer_write_stdin",
	"openbot_computer_read_file",
	"openbot_computer_export_file",
	"openbot_computer_write_file",
	"openbot_computer_list_files",
	"openbot_computer_remove_file",
	"openbot_computer_open_port",
	"openbot_computer_screenshot",
	"openbot_computer_desktop",
]
const computerOf = (call: SavedPart | undefined): string | null => {
	if (call === undefined || !computerTools.includes(String(call.part["name"])))
		return null
	const computer = object(call.part["params"])?.["computer"]
	return typeof computer === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(computer)
		? computer
		: null
}
const filesOf = (
	call: SavedPart | undefined,
	parts: ReadonlyArray<SavedPart>,
): ReadonlyArray<string> => {
	if (call?.part["name"] !== "openbot_computer_export_file") return []
	const result = resultOf(call, parts)
	if (!successful(result)) return []
	const file = object(object(result.part["result"])?.["file"])
	return file?.["status"] === "ready" &&
		typeof file["id"] === "string" &&
		/^[A-Za-z0-9_-]{1,256}$/.test(file["id"])
		? [file["id"]]
		: []
}

/** The caller supplies reads with the original request's identity and permissions. */
export const readConversationActivity = async ({
	chatId,
	read,
	expectedRevision,
	expectedTurnId,
	signal,
}: {
	readonly chatId: string
	readonly read: (call: NativeCall) => Promise<unknown>
	readonly expectedRevision?: number
	readonly expectedTurnId?: string | null
	readonly signal?: AbortSignal
}): Promise<ConversationActivity> => {
	if (!Schema.is(Id)(chatId))
		throw new ConversationActivityFailure(400, "Choose a conversation.")
	const request = async (call: NativeCall) => {
		signal?.throwIfAborted()
		const value = await read(call)
		signal?.throwIfAborted()
		return value
	}
	const readChat = async () => {
		const raw = await request({ operation: "chat", id: chatId })
		const snapshot = validate(() => Schema.decodeUnknownSync(Snapshot)(raw))
		if (
			snapshot.chat.id !== chatId ||
			(snapshot.turn !== null && snapshot.turn.chat !== chatId) ||
			(snapshot.activeExecution !== undefined &&
				(snapshot.turn === null ||
					snapshot.executionId !== snapshot.activeExecution.id)) ||
			(snapshot.activeTools ?? []).some(
				(entry) =>
					entry.tool.chatId !== chatId ||
					entry.tool.turnId !== snapshot.turn?.id ||
					entry.executionId !== snapshot.activeExecution?.id ||
					entry.step !==
						`tool:${entry.tool.itemId.length}:${entry.tool.itemId}${entry.tool.callId}`,
			)
		)
			return invalid()
		return snapshot
	}
	const first = await readChat()
	if (
		(expectedRevision !== undefined &&
			first.chat.revision !== expectedRevision) ||
		(expectedTurnId !== undefined &&
			(first.turn?.id ?? null) !== expectedTurnId)
	)
		return changed()
	const feature = (id: string) =>
		request({
			operation: "feature",
			id,
			payload: { params: { chatId } },
		})
	const history = async (
		before: number | undefined = undefined,
		pageCount = 0,
		items: ReadonlyArray<Item> = [],
	): Promise<{
		items: ReadonlyArray<Item>
		complete: boolean
		nextBefore: number | null
	}> => {
		const raw = await request({
			operation: "items",
			id: chatId,
			query: {
				limit: "100",
				...(before === undefined ? {} : { before: String(before) }),
			},
		})
		const page = validate(() => Schema.decodeUnknownSync(Page)(raw))
		if (
			page.items.some(
				(item, index) =>
					(before !== undefined && item.seq >= before) ||
					(index > 0 && item.seq >= page.items[index - 1]!.seq) ||
					items.some((previous) => previous.id === item.id) ||
					page.items.findIndex((other) => other.id === item.id) !== index,
			)
		)
			return invalid()
		const last = page.items.at(-1)
		if (page.next !== null && (last === undefined || page.next !== last.seq))
			return invalid()
		const all = [...items, ...page.items]
		if (page.next === null)
			return { items: all, complete: true, nextBefore: null }
		// A saved plan is enough for this activity view. Older history remains explicitly unread.
		if (
			pageCount === 9 ||
			validate(() => historicalPlan(partsOf(all))).source !== "none"
		)
			return { items: all, complete: false, nextBefore: page.next }
		return history(page.next, pageCount + 1, all)
	}
	// Failures remain failures. A denied or missing source must not appear as an empty success.
	const [todoRaw, delegationRaw, toolRaw, appRaw, saved] = await Promise.all([
		feature("chats.chatTodos"),
		feature("chats.chatDelegations"),
		feature("toolCalls.list"),
		feature("appOperations.list"),
		history(),
	])
	const result = validate(() => {
		const current = todoList(
			Schema.decodeUnknownSync(Schema.Struct({ items: Schema.Unknown }))(
				todoRaw,
			).items,
		)
		const parts = partsOf(saved.items)
		const calls = callsOf(parts)
		const appEntries = Schema.decodeUnknownSync(Schema.Array(AppOperation))(
			appRaw,
		)
		if (appEntries.some((entry) => entry.chat !== chatId)) return invalid()
		const priorPlan = historicalPlan(parts)
		const matchesPrior = Schema.toEquivalence(Schema.Array(ActivityTodo))(
			current,
			priorPlan.items,
		)
		const plan: ConversationActivity["plan"] =
			current.length > 0
				? {
						source: "current",
						items: current,
						sourceItemId: matchesPrior ? priorPlan.sourceItemId : null,
						turnId: matchesPrior ? priorPlan.turnId : null,
					}
				: priorPlan
		const durable = Schema.decodeUnknownSync(Schema.Array(Tool))(toolRaw).map(
			(tool) => {
				if ((tool.position?.chat ?? tool.chat) !== chatId) return invalid()
				const turnId = tool.position?.turn ?? tool.turn ?? null
				const matches = calls.filter(
					(call) =>
						call.part["id"] === tool.callId &&
						call.part["name"] === tool.tool &&
						call.item.origin?.turn === turnId &&
						(tool.position === undefined ||
							call.item.id === tool.position.item),
				)
				const call = matches.length === 1 ? matches[0] : undefined
				return {
					call,
					tool: {
						id: tool.id,
						executionId: tool.executionId,
						turnId,
						itemId: tool.position?.item ?? null,
						name: tool.tool,
						...toolAppNames(call, parts, calls, appEntries, saved.complete),
						status: tool.status,
						startedAt: tool.startedAt ?? null,
						completedAt: tool.endedAt ?? null,
						computerId: computerOf(call),
						fileIds: tool.status === "completed" ? filesOf(call, parts) : [],
					},
				}
			},
		)
		const active = (first.activeTools ?? []).map((entry) => {
			const matches = calls.filter(
				(call) =>
					call.item.id === entry.tool.itemId &&
					call.item.origin?.turn === entry.tool.turnId &&
					call.part["id"] === entry.tool.callId &&
					call.part["name"] === entry.tool.name,
			)
			const call = matches.length === 1 ? matches[0] : undefined
			return {
				call,
				tool: {
					id: `active:${createHash("sha256")
						.update(
							JSON.stringify([entry.executionId, entry.step, entry.attempt]),
						)
						.digest("hex")}`,
					executionId: entry.executionId,
					turnId: entry.tool.turnId,
					itemId: entry.tool.itemId,
					name: entry.tool.name,
					...toolAppNames(call, parts, calls, appEntries, saved.complete),
					status: entry.status,
					startedAt: null,
					completedAt: null,
					computerId: entry.tool.computerId ?? null,
					fileIds: [],
				},
			}
		})
		const foreground = calls
			.filter(
				(call) =>
					!durable.some((entry) => entry.call === call) &&
					!active.some((entry) => entry.call === call),
			)
			.map((call) => {
				Schema.decodeUnknownSync(Id)(call.part["id"])
				const name = Schema.decodeUnknownSync(Schema.NonEmptyString)(
					call.part["name"],
				)
				const status = foregroundStatus(call, parts, first)
				const tool: ConversationActivity["tools"][number] = {
					id: `history:${call.item.id}:${call.messageIndex}:${call.partIndex}`,
					executionId: null,
					turnId: call.item.origin?.turn ?? null,
					itemId: call.item.id,
					name,
					...toolAppNames(call, parts, calls, appEntries, saved.complete),
					status,
					startedAt: null,
					completedAt: null,
					computerId: computerOf(call),
					fileIds: status === "completed" ? filesOf(call, parts) : [],
				}
				return { call, tool }
			})
		const tools = [
			...durable.filter(
				(entry) =>
					entry.call === undefined ||
					!active.some((current) => current.call === entry.call),
			),
			...foreground,
			...active,
		]
			.toSorted((left, right) => {
				if (left.call !== undefined && right.call !== undefined)
					return left.call.order - right.call.order
				if (left.call !== undefined) return 1
				if (right.call !== undefined) return -1
				// Unlocated native records stay distinct from the ordered history window.
				return (
					(left.tool.startedAt ?? 0) - (right.tool.startedAt ?? 0) ||
					left.tool.id.localeCompare(right.tool.id)
				)
			})
			.map(({ tool }) => tool)
		const delegations = Schema.decodeUnknownSync(Schema.Array(Delegation))(
			delegationRaw,
		).map((entry) => {
			if (entry.parent.chat !== chatId) return invalid()
			return {
				id: entry.id,
				chatId: entry.chat,
				parentChatId: entry.parent.chat,
				parentTurnId: entry.parent.turn ?? null,
				task: entry.task,
				status: entry.status,
				executionStatus: entry.executionStatus,
				executionId: entry.executionId,
				result: entry.result,
			}
		})
		const appOperations = appEntries.map((entry) => ({
			id: entry.id,
			executionId: entry.executionId,
			turnId: entry.turn,
			name: entry.toolName,
			...appNames(entry),
			status: entry.status,
		}))
		const updates = parts.flatMap((entry): ConversationActivity["updates"] => {
			// The pinned history has no generic public progress field. Unlabelled final answers
			// and reasoning parts are never copied into the activity surface.
			if (
				entry.role !== "assistant" ||
				entry.part["type"] !== "text" ||
				!["commentary", "activity", "progress"].includes(
					String(entry.channel),
				) ||
				typeof entry.part["text"] !== "string"
			)
				return []
			return [
				{
					id: `${entry.item.id}:${entry.messageIndex}:${entry.partIndex}`,
					itemId: entry.item.id,
					turnId: entry.item.origin?.turn ?? null,
					sequence: entry.item.seq,
					text: entry.part["text"],
					source: "assistant_activity",
				},
			]
		})
		return Schema.decodeSync(ConversationActivity)({
			chatId,
			revision: first.chat.revision,
			turnId: first.turn?.id ?? null,
			status: first.status,
			...(first.activeExecution === undefined
				? {}
				: { activeExecution: first.activeExecution }),
			model: first.turn?.settings.model ?? first.chat.settings.model ?? null,
			progress:
				plan.items.length === 0 ||
				(plan.turnId !== null && plan.turnId !== (first.turn?.id ?? null))
					? null
					: {
							completed: plan.items.filter((item) => item.status === "done")
								.length,
							total: plan.items.length,
						},
			plan,
			updates,
			tools,
			delegations,
			appOperations,
			history: { complete: saved.complete, nextBefore: saved.nextBefore },
		})
	})
	if (!sameSnapshot(first, await readChat())) return changed()
	return result
}
