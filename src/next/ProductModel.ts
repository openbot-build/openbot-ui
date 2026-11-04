import type * as Product from "@kaicom/kay-contracts"
import { dual } from "effect/Function"
import type { Message, Workspace } from "./Model"
import { objectOf } from "./features/SchemaValues.ts"
import { savedAttachment } from "./features/FilesData.ts"

export interface ProductPreferences {
	readonly pinned: ReadonlyArray<string>
	readonly projects: ReadonlyArray<{
		readonly id: string
		readonly name: string
		readonly sessions: ReadonlyArray<string>
	}>
	readonly colors: Readonly<Record<string, string>>
}
export const preferencesFrom = (value: unknown): ProductPreferences => {
	const workspace = objectOf(objectOf(value)["workspace"])
	const strings = (input: unknown): ReadonlyArray<string> =>
		Array.isArray(input)
			? input.filter((item): item is string => typeof item === "string")
			: []
	const companions = Array.isArray(workspace["companions"])
		? workspace["companions"]
		: []
	const projects = Array.isArray(workspace["projects"])
		? workspace["projects"]
		: []
	return {
		pinned: strings(workspace["pinnedSessions"]),
		projects: projects.flatMap((item) => {
			const row = objectOf(item)
			return typeof row["id"] === "string" && typeof row["name"] === "string"
				? [
						{
							id: row["id"],
							name: row["name"],
							sessions: strings(row["sessions"]),
						},
					]
				: []
		}),
		colors: Object.fromEntries(
			companions.flatMap((item) => {
				const row = objectOf(item)
				const color = row["color"]
				return row["id"] !== "k" &&
					typeof color === "string" &&
					/^#[0-9a-fA-F]{6}$/.test(color)
					? strings(row["sessions"]).map((id) => [id, color])
					: []
			}),
		),
	}
}

export const workspaceFrom = (bootstrap: Product.Bootstrap): Workspace => ({
	source: "live",
	account: {
		name: bootstrap.identity.displayName,
		initial: Array.from(bootstrap.identity.displayName)[0] ?? "K",
		avatarUrl: bootstrap.identity.avatarUrl,
	},
	companions: bootstrap.companions
		.filter((bot) => bot.id === bootstrap.defaultBotId && !bot.archived)
		.map((bot) => ({ ...bot, name: "Kay Bot", color: "neutral" })),
	conversations: bootstrap.conversations.flatMap((chat) =>
		chat.kind === "conversation" || chat.kind === "direct"
			? [
					{
						id: chat.id,
						botId: chat.botId,
						kind: chat.kind,
						title:
							bootstrap.metadata?.find((item) => item.chatId === chat.id)
								?.title ??
							chat.title ??
							"Conversation",
						archived:
							bootstrap.metadata?.find((item) => item.chatId === chat.id)
								?.archived ?? false,
						preview: "",
						automationIds:
							bootstrap.metadata?.find((item) => item.chatId === chat.id)
								?.automationIds ?? [],
					},
				]
			: [],
	),
	messages: {},
	tasks: [],
})

/** Keep tool and attachment data inspectable without importing an engine schema. */
export const messagesFrom = (
	page: typeof Product.MessagePage.Type,
): ReadonlyArray<Message> =>
	[...page.items]
		.sort((a, b) => a.sequence - b.sequence)
		.map((item) => ({
			id: item.id,
			role: item.role === "user" ? "user" : "assistant",
			text: item.parts
				.filter((part) => part.type === "text" && part.text !== undefined)
				.map((part) => part.text)
				.join("\n"),
			attachments: item.parts
				.flatMap((part) => {
					const file = savedAttachment(part)
					return file === null ? [] : [file]
				})
				.filter(
					(file, index, files) =>
						files.findIndex((other) => other.fileId === file.fileId) === index,
				),
			details: item.parts
				.filter(
					(part) => part.text === undefined && savedAttachment(part) === null,
				)
				.map((part) => {
					const result = objectOf(part.details?.["result"])
					const operationId = result["operationId"]
					const resource = objectOf(
						objectOf(
							objectOf(objectOf(result["source"])["definition"])["_meta"],
						)["ui"],
					)["resourceUri"]
					return {
						type: part.type,
						value: part.details ?? {},
						...(typeof operationId === "string" &&
						operationId.length > 0 &&
						typeof resource === "string" &&
						resource.startsWith("ui://")
							? { appView: { operationId, itemId: item.sourceItemId } }
							: {}),
					}
				}),
		}))

export interface StreamState {
	readonly sequence: number
	readonly messages: ReadonlyArray<Message>
	readonly chatId: string | null
}
export const emptyStream: StreamState = {
	sequence: -1,
	messages: [],
	chatId: null,
}

export const regenerationInput = ({
	turn,
	page,
}: {
	readonly turn: typeof Product.Turn.Type
	readonly page: typeof Product.MessagePage.Type
}): Product.SendMessage["input"] => {
	if (
		!turn.inputItemIds.every((id) =>
			page.items.some((item) => item.sourceItemId === id),
		)
	)
		throw new Error(
			"The original input is incomplete. Load its saved messages first.",
		)
	const parts = page.items
		.filter(
			(item) =>
				turn.inputItemIds.includes(item.sourceItemId) && item.role === "user",
		)
		.flatMap((item) =>
			item.parts.map((part): typeof Product.InputPart.Type => {
				if (part.text !== undefined && part.text !== "")
					return { type: "text", text: part.text }
				const fileId = part.details?.["file_id"]
				if (
					(part.type === "input_file" || part.type === "input_image") &&
					typeof fileId === "string"
				)
					return { type: part.type === "input_file" ? "file" : "image", fileId }
				const data = objectOf(part.details?.["data"])
				const uri = data["value"]
				if (
					(part.type === "file" || part.type === "image") &&
					data["_tag"] === "Url" &&
					typeof uri === "string" &&
					/^openbot-file:[A-Za-z0-9_-]+$/.test(uri)
				)
					return { type: part.type, fileId: uri.slice("openbot-file:".length) }
				throw new Error(
					"The original input contains an attachment that cannot be restored safely.",
				)
			}),
		)
	if (parts.length === 0)
		throw new Error("The original user input is not available.")
	return parts
}

/** Sequence is local to one response. A new connection starts from committed items. */
export const reduceStream: {
	(state: StreamState, event: Product.ChatEvent): StreamState
	(event: Product.ChatEvent): (state: StreamState) => StreamState
} = dual(2, (state: StreamState, event: Product.ChatEvent): StreamState => {
	if (event.sequence <= state.sequence) return state
	if (state.chatId !== null && event.chatId !== state.chatId)
		throw new Error("The response belongs to a different conversation.")
	const next = { ...state, sequence: event.sequence, chatId: event.chatId }
	if (
		event.itemId === undefined ||
		(event.type !== "response.output_text.delta" &&
			event.type !== "response.output_text.done")
	)
		return next
	const previous = state.messages.find((item) => item.id === event.itemId)
	const message: Message = {
		id: event.itemId,
		role: "assistant",
		text: event.text ?? (previous?.text ?? "") + (event.delta ?? ""),
		streaming: event.type !== "response.output_text.done",
		...(event.executionSequence === undefined
			? {}
			: { streamRevision: event.executionSequence }),
	}
	return {
		...next,
		messages:
			previous === undefined
				? [...state.messages, message]
				: state.messages.map((item) =>
						item.id === message.id ? message : item,
					),
	}
})

export const mergeMessages: {
	(
		committed: ReadonlyArray<Message>,
		streamed: ReadonlyArray<Message>,
	): ReadonlyArray<Message>
	(
		streamed: ReadonlyArray<Message>,
	): (committed: ReadonlyArray<Message>) => ReadonlyArray<Message>
} = dual(
	2,
	(
		committed: ReadonlyArray<Message>,
		streamed: ReadonlyArray<Message>,
	): ReadonlyArray<Message> => {
		const unique = streamed.reduce<ReadonlyArray<Message>>((items, item) => {
			const previous = items.find((entry) => entry.id === item.id)
			if (previous === undefined) return [...items, item]
			if ((previous.streamRevision ?? 0) > (item.streamRevision ?? 0))
				return items
			return items.map((entry) => (entry.id === item.id ? item : entry))
		}, [])
		return [
			...committed.map((item) => {
				const live = unique.find((entry) => entry.id === item.id)
				// Native Items are committed once complete, including tool and file parts.
				return live?.streamRevision !== undefined ? item : (live ?? item)
			}),
			...unique.filter(
				(item) => !committed.some((saved) => saved.id === item.id),
			),
		]
	},
)
