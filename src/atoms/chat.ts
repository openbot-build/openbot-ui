import {
	ExecutionsApi,
	type ChatView,
	type ChatCommandReceipt,
	type FilesApi,
	type MessageInput,
} from "@openbot-build/client/Api"
import { Chats, Executions } from "@openbot-build/client"
import type { Config, Item, Turn } from "@openbot-build/client/Core"
import { Duration, Effect, Schedule, Stream } from "effect"
import * as Atom from "effect/reactivity/Atom"
import * as Reactivity from "effect/reactivity/Reactivity"
import { Api, apiRuntime, errorMessage } from "@/lib/api"
import { chatsKey, decodeChatId, requestsKey } from "@/atoms/chats"
import type { ChatTurn, ToolCall } from "@/lib/conversation"
import { emptyAnswer, reduceAnswer } from "@/lib/execution-events"
import { waitForExecution } from "@/lib/execution"

const { Execution } = ExecutionsApi

/** A file that goes into a message. It is uploaded already. */
export type Attachment = Pick<
	FilesApi.FileObject,
	"id" | "filename" | "mediaType"
>

/** A Turn that this page started and still streams. */
export interface StreamingTurn {
	/** The text that the person sent. It shows before the history has it. */
	readonly input: string
	/** The files that the person sent with the text. */
	readonly files: ReadonlyArray<Attachment>
	/** The answer text so far. */
	readonly text: string
	readonly turn?: string
	readonly receipt?: ChatCommandReceipt
	readonly commandKey?: ExecutionsApi.Execution.CommandKey
	/** This send owns its pending state, even when two messages share a Turn. */
	readonly request: symbol
	readonly status: "starting" | "streaming" | "failed"
	readonly error?: string
}

/** What the page knows about one chat. */
export interface ChatState {
	readonly view: ChatView | undefined
	/** The Items of the Chat, oldest first. */
	readonly history: ReadonlyArray<Item.Record>
	/** The Turns of the Chat, oldest first. */
	readonly turns: ReadonlyArray<ChatTurn>
	/** The tool calls of the Chat that went on in the background, oldest first. */
	readonly operations: ReadonlyArray<ToolCall>
	readonly loading: boolean
	readonly error: string | undefined
	readonly streaming: StreamingTurn | undefined
}

const initialChat: ChatState = {
	view: undefined,
	history: [],
	turns: [],
	operations: [],
	loading: true,
	error: undefined,
	streaming: undefined,
}

/**
 * The state of each chat. It stays alive when the page changes, so a stream that
 * runs in the background still has a place to write to.
 */
export const chatAtom = Atom.family((_id: string) =>
	Atom.make<ChatState>(initialChat).pipe(Atom.keepAlive),
)

/** Whether a chat runs a Turn now. */
export const isBusy = (view: ChatView | undefined) => view?.status === "Running"

/** Whether a tool call of the chat still runs in the background. */
export const hasRunningOperations = (operations: ReadonlyArray<ToolCall>) =>
	operations.some((operation) => !Execution.isTerminal(operation.status))

/**
 * Whether more work will come to the chat by itself: input that waits for a
 * Turn, work that it gave away and that comes back as new input, or a tool call
 * that runs in the background and comes back as a notice.
 */
export const hasOpenWork = (
	view: ChatView | undefined,
	operations: ReadonlyArray<ToolCall> = [],
) =>
	view !== undefined &&
	(view.inbox > 0 ||
		view.open.delegations > 0 ||
		view.open.requests > 0 ||
		view.open.reminders > 0 ||
		hasRunningOperations(operations))

/** The most Items and Turns that a page reads at once. */
const pageSize = 200

/** Reads every Item of a Chat, oldest first. The server gives them newest first. */
const loadItems = Effect.fnUntraced(function* (
	chatId: ReturnType<typeof decodeChatId>,
) {
	const client = yield* Api
	const items: Array<Item.Record> = []
	let before: Item.Seq | undefined
	while (true) {
		const page = yield* client.api.chats.chatItems({
			params: { chatId },
			query: { limit: pageSize, ...(before !== undefined ? { before } : {}) },
		})
		items.push(...page.items)
		if (page.next === null) break
		before = page.next
	}
	return items.reverse()
})

/** Reads every Turn of a Chat, oldest first. */
const loadTurns = Effect.fnUntraced(function* (
	chatId: ReturnType<typeof decodeChatId>,
) {
	const client = yield* Api
	const turns: Array<ChatTurn> = []
	let after: Turn.Id | undefined
	while (true) {
		const page = yield* client.api.chats.chatTurns({
			params: { chatId },
			query: { limit: pageSize, ...(after !== undefined ? { after } : {}) },
		})
		turns.push(...page.items)
		if (page.next === null) break
		after = page.next
	}
	return turns
})

const loadChat = Effect.fnUntraced(function* (id: string) {
	const client = yield* Api
	const chatId = decodeChatId(id)
	const [view, history, turns, operations] = yield* Effect.all(
		[
			client.api.chats.getChat({ params: { chatId } }),
			loadItems(chatId),
			loadTurns(chatId),
			client.api.toolCalls
				.list({ params: { chatId } })
				.pipe(
					Effect.flatMap((calls) =>
						Effect.forEach(
							calls,
							(call) =>
								client.api.toolCalls.get({ params: { chatId, id: call.id } }),
							{ concurrency: 4 },
						),
					),
				),
		],
		{ concurrency: 4 },
	)
	return { view, history, turns, operations }
})

/** Loads a chat and its history. */
export const loadChatAtom = Atom.keepAlive(
	apiRuntime.fn(
		Effect.fnUntraced(function* (id: string, get) {
			const current = get.registry.get(chatAtom(id))
			get.set(chatAtom(id), { ...current, loading: true, error: undefined })
			const result = yield* loadChat(id).pipe(Effect.result)
			const latest = get.registry.get(chatAtom(id))
			if (result._tag === "Failure") {
				get.set(chatAtom(id), {
					...latest,
					loading: false,
					error: errorMessage(result.failure),
				})
				return
			}
			get.set(chatAtom(id), {
				...latest,
				...result.success,
				loading: false,
				error: undefined,
			})
		}),
		{ concurrent: true },
	),
)

/**
 * Loads changes made by a trigger, a Channel, a decision or another tab. The
 * execution API has no Chat wait route, so check while the Chat has open work.
 * During a local stream, keep its history in place and refresh its open requests.
 */
export const chatWatcherAtom = Atom.family((id: string) =>
	apiRuntime.atom((get) => {
		const state = get(chatAtom(id))
		if (state.view === undefined) return Effect.void
		const streaming =
			state.streaming !== undefined &&
			(state.streaming.status !== "failed" ||
				state.streaming.receipt !== undefined)
		if (
			!streaming &&
			!isBusy(state.view) &&
			!hasOpenWork(state.view, state.operations)
		)
			return Effect.void
		return Effect.gen(function* () {
			yield* Effect.sleep(Duration.seconds(1))
			const next = yield* loadChat(id)
			const current = get.once(chatAtom(id))
			get.set(
				chatAtom(id),
				current.streaming === undefined ||
					(current.streaming.status === "failed" &&
						current.streaming.receipt !== undefined)
					? { ...current, ...next, streaming: undefined, error: undefined }
					: { ...current, view: next.view, operations: next.operations },
			)
			yield* Reactivity.invalidate([
				chatsKey,
				requestsKey,
				"execution-decisions",
			])
		}).pipe(
			Effect.catch((cause) =>
				Effect.gen(function* () {
					yield* Effect.logWarning("The chat could not be refreshed.", cause)
					yield* Effect.sleep(Duration.seconds(3))
					get.refreshSelf()
				}),
			),
		)
	}),
)

/**
 * The input of a message. Text alone is a string. With files, it is one user
 * message with a part for each file. An image goes in as an image, so the
 * model sees it.
 */
const messageInput = (
	text: string,
	files: ReadonlyArray<Attachment>,
): typeof MessageInput.Type => {
	if (files.length === 0) return text
	const fileParts = files.map((file) =>
		file.mediaType.startsWith("image/")
			? ({ type: "input_image", file_id: file.id } as const)
			: ({ type: "input_file", file_id: file.id } as const),
	)
	const content = [
		...(text.length > 0 ? [{ type: "input_text" as const, text }] : []),
		...fileParts,
	]
	return [{ role: "user", content }]
}

/**
 * Sends one saved command, then observes the Turn execution. The command helper
 * keeps its key on network retries. A page change does not stop accepted work.
 */
export const sendMessageAtom = Atom.keepAlive(
	apiRuntime.fn(
		Effect.fnUntraced(function* (
			input: {
				readonly id: string
				readonly text: string
				readonly files?: ReadonlyArray<Attachment>
			},
			get,
		) {
			const chat = chatAtom(input.id)
			const files = input.files ?? []
			const previous: StreamingTurn | undefined =
				get.registry.get(chat).streaming
			// Retry an unknown network result with the same saved command.
			const retry =
				previous?.status === "failed" &&
				previous.input === input.text &&
				previous.files.length === files.length &&
				previous.files.every((file, index) => file.id === files[index]?.id)
					? previous
					: undefined
			const request = Symbol()
			const ownsPending = () =>
				get.registry.get(chat).streaming?.request === request
			const update = (f: (state: ChatState) => ChatState) =>
				get.set(chat, f(get.registry.get(chat)))
			const setStreaming = (f: (turn: StreamingTurn) => StreamingTurn) =>
				update((state) =>
					state.streaming?.request !== request
						? state
						: { ...state, streaming: f(state.streaming) },
				)

			update((state) => ({
				...state,
				streaming: {
					input: input.text,
					files,
					text: "",
					status: "starting",
					request,
					commandKey: retry?.commandKey,
					receipt: retry?.receipt,
				},
			}))
			const sent = yield* Effect.gen(function* () {
				if (retry?.receipt !== undefined) return retry.receipt
				const command = yield* Chats.message(decodeChatId(input.id), {
					input: messageInput(input.text, files),
					...(retry?.commandKey === undefined
						? {}
						: { commandKey: retry.commandKey }),
				})
				setStreaming((turn) => ({ ...turn, commandKey: command.commandKey }))
				return yield* command.send
			}).pipe(Effect.result)
			if (sent._tag === "Failure") {
				setStreaming((turn) => ({
					...turn,
					status: "failed",
					error: errorMessage(sent.failure),
				}))
				return
			}
			const receipt = sent.success
			if (!ownsPending()) return
			setStreaming((turn) => ({
				...turn,
				turn: receipt.turn,
				receipt,
				status: "streaming",
			}))
			let answer = emptyAnswer
			const streamed = yield* Stream.suspend(() =>
				Executions.observe(receipt.executionId, answer.sequence),
			).pipe(
				Stream.retry(
					Schedule.max([
						Schedule.exponential("250 millis"),
						Schedule.recurs(2),
					]),
				),
				Stream.takeWhile(() => ownsPending()),
				Stream.runForEach((event) =>
					Effect.sync(() => {
						answer = reduceAnswer(answer, event)
						setStreaming((turn) => ({ ...turn, text: answer.text }))
					}),
				),
				Effect.result,
			)
			if (streamed._tag === "Failure")
				setStreaming((turn) => ({
					...turn,
					status: "failed",
					error: errorMessage(streamed.failure),
				}))
			const loaded = yield* loadChat(input.id).pipe(Effect.result)
			const current = get.registry.get(chat)
			if (!ownsPending()) return
			const failed = current.streaming?.status === "failed"
			if (loaded._tag === "Success")
				update((state) => ({
					...state,
					...loaded.success,
					streaming:
						failed && loaded.success.history.length === state.history.length
							? state.streaming
							: undefined,
				}))
			else
				update((state) => ({
					...state,
					error: errorMessage(loaded.failure),
					streaming: {
						...current.streaming!,
						status: "failed",
						error: errorMessage(loaded.failure),
					},
				}))
			yield* Reactivity.invalidate([
				chatsKey,
				requestsKey,
				"execution-decisions",
			])
		}),
		{ concurrent: true },
	),
)

/** Sends the first message to the direct Chat with a Bot and returns the Chat. */
export const messageBotAtom = apiRuntime.fn(
	Effect.fnUntraced(function* (input: {
		readonly bot: string
		readonly text: string
		readonly files?: ReadonlyArray<Attachment>
	}) {
		const command = yield* Chats.botMessage(
			input.bot as ChatView["chat"]["bot"],
			{
				input: messageInput(input.text, input.files ?? []),
			},
		)
		return (yield* command.send).chat
	}),
	{ reactivityKeys: [chatsKey] },
)

/**
 * Makes a new live Chat with a Bot, for a talk with sound. Each talk is its own
 * Chat. It uses the first Live model of the organization.
 */
export const createLiveChatAtom = apiRuntime.fn(
	Effect.fnUntraced(function* (bot: string) {
		const client = yield* Api
		const view = yield* client.api.live.createLiveChat({
			params: { botId: bot as ChatView["chat"]["bot"] },
			payload: {},
		})
		return view.chat.id
	}),
	{ reactivityKeys: [chatsKey] },
)

/** Stops a tool execution after its resources have been released. */
export const cancelOperationAtom = apiRuntime.fn(
	Effect.fnUntraced(function* (
		input: {
			readonly chat: string
			readonly execution: ExecutionsApi.Execution.Id
		},
		get,
	) {
		const command = yield* Executions.cancel(input.execution)
		yield* waitForExecution(yield* command.send, {
			success: ["completed", "cancelled", "interrupted"],
		})
		const next = yield* loadChat(input.chat)
		const chat = chatAtom(input.chat)
		get.set(chat, { ...get.registry.get(chat), ...next })
	}),
)

/** Stops the current Turn. Work that the Chat gave to Bots goes on. */
export const stopTurnAtom = apiRuntime.fn(
	Effect.fnUntraced(function* (id: string, get) {
		const command = yield* Chats.interrupt(decodeChatId(id))
		yield* waitForExecution(yield* command.send, {
			success: ["completed", "cancelled", "interrupted"],
		})
		const next = yield* loadChat(id)
		get.set(chatAtom(id), { ...get.registry.get(chatAtom(id)), ...next })
	}),
)

const updateChat = Effect.fnUntraced(function* (
	id: string,
	change: { readonly mode?: Config.Mode; readonly model?: Config.Selection },
	current: ChatView | undefined,
) {
	const client = yield* Api
	const chatId = decodeChatId(id)
	const view =
		current ?? (yield* client.api.chats.getChat({ params: { chatId } }))
	return yield* client.api.chats.updateChat({
		params: { chatId },
		payload: { expected: view.chat.revision, ...change },
	})
})

/** Changes the mode of a chat: `build` does the work, `plan` writes a plan first. */
export const selectModeAtom = apiRuntime.fn(
	Effect.fnUntraced(function* (
		input: { readonly id: string; readonly mode: Config.Mode },
		get,
	) {
		const chat = chatAtom(input.id)
		const view = yield* updateChat(
			input.id,
			{ mode: input.mode },
			get.registry.get(chat).view,
		)
		get.set(chat, { ...get.registry.get(chat), view })
	}),
)

/** Changes the model of a chat. */
export const selectModelAtom = apiRuntime.fn(
	Effect.fnUntraced(function* (
		input: { readonly id: string; readonly selection: Config.Selection },
		get,
	) {
		const chat = chatAtom(input.id)
		const view = yield* updateChat(
			input.id,
			{ model: input.selection },
			get.registry.get(chat).view,
		)
		get.set(chat, { ...get.registry.get(chat), view })
	}),
)

/** The todo list of a chat. The Bot keeps it while it works. */
export const todosAtom = Atom.family((id: string) =>
	apiRuntime.atom((get) => {
		// Load the list again when the chat changes.
		get(chatAtom(id)).view?.chat.revision
		return Effect.gen(function* () {
			const client = yield* Api
			return yield* client.api.chats.chatTodos({
				params: { chatId: decodeChatId(id) },
			})
		})
	}),
)

/** The models that a chat can use, and the one it uses now. */
export const chatModelsAtom = Atom.family((id: string) =>
	apiRuntime.atom(
		Effect.gen(function* () {
			const client = yield* Api
			return yield* client.api.chats.chatModels({
				params: { chatId: decodeChatId(id) },
			})
		}),
	),
)
