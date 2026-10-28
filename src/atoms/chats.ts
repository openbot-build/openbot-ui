import {
	type ChatInfo,
	type ChatSummary,
	RequestsApi,
} from "@openbot-build/client/Api"
import { Chats, Requests } from "@openbot-build/client"
import { Chat, Config } from "@openbot-build/client/Core"
import { Effect, Schema } from "effect"
import * as Atom from "effect/reactivity/Atom"
import * as Reactivity from "effect/reactivity/Reactivity"
import type { Bot } from "@/atoms/bots"
import { Api, apiRuntime } from "@/lib/api"
import { waitForExecution } from "@/lib/execution"

export const decodeChatId = Schema.decodeUnknownSync(Chat.Id)

/** The reactivity key of the chat list. Changes to a chat invalidate it. */
export const chatsKey = "chats"
/** The reactivity key of the requests that wait for a decision. */
export const requestsKey = "requests"

/** The time of the latest work in a Chat, for sorting. */
export const lastActivity = (summary: ChatSummary): number =>
	// `created_at` follows the Responses format, so it is in seconds.
	summary.response ? summary.response.created_at * 1000 : summary.chat.createdAt

/**
 * The name to show for a Chat. A direct Chat is the one Chat of the person with
 * a Bot, so it has the name of the Bot. A channel Chat has the name that it has
 * on the platform of its Channel. A live Chat is one talk with sound.
 */
export const chatName = (
	chat: Pick<ChatInfo, "kind" | "bot" | "title">,
	bots: ReadonlyArray<Pick<Bot, "id" | "name">>,
) => {
	if (chat.title !== undefined && chat.title.trim().length > 0)
		return chat.title
	const bot = bots.find((item) => item.id === chat.bot)
	if (chat.kind === "channel")
		return bot ? `${bot.name} in a Channel` : "Channel chat"
	if (chat.kind === "live")
		return bot ? `Live talk with ${bot.name}` : "Live talk"
	return bot?.name ?? "Chat"
}

/** The direct, channel and live Chats of the person, newest first. */
export const chatsAtom = apiRuntime
	.atom(
		Effect.gen(function* () {
			const client = yield* Api
			const items = yield* client.api.chats.listChats({ query: {} })
			return items.toSorted((a, b) => lastActivity(b) - lastActivity(a))
		}),
	)
	.pipe(Atom.withReactivity([chatsKey]))

/** Groups chats by day, like the history list of a chat app. */
export const groupByDay = (
	items: ReadonlyArray<ChatSummary>,
	now: number,
): ReadonlyArray<{
	readonly label: string
	readonly items: ReadonlyArray<ChatSummary>
}> => {
	const today = new Date(now)
	today.setHours(0, 0, 0, 0)
	const day = 24 * 60 * 60 * 1000
	const start = today.getTime()
	const label = (time: number) => {
		if (time >= start) return "Today"
		if (time >= start - day) return "Yesterday"
		if (time >= start - 7 * day) return "Previous 7 days"
		if (time >= start - 30 * day) return "Previous 30 days"
		if (time === 0) return "Older"
		return new Date(time).toLocaleDateString(undefined, {
			month: "long",
			year: "numeric",
		})
	}
	return items.reduce<
		Array<{ readonly label: string; readonly items: Array<ChatSummary> }>
	>((groups, item) => {
		const name = label(lastActivity(item))
		const last = groups.at(-1)
		if (last !== undefined && last.label === name) last.items.push(item)
		else groups.push({ label: name, items: [item] })
		return groups
	}, [])
}

/**
 * Deletes the history of a Chat. The Chat stays: the next message starts it
 * again with no history.
 */
export const clearChatAtom = apiRuntime.fn(
	Effect.fnUntraced(function* (id: string) {
		const command = yield* Chats.remove(decodeChatId(id))
		yield* waitForExecution(yield* command.send)
	}),
	{ reactivityKeys: [chatsKey] },
)

/**
 * The models that the person can use now, of one type. A `language` model
 * writes text in a chat. A `live` model talks with sound in a live chat.
 */
export const modelCatalogAtom = Atom.family(
	(type: "language" | "live" = "language") =>
		apiRuntime.atom(
			Effect.gen(function* () {
				const client = yield* Api
				const catalog = yield* client.api.modelProviders.getModelCatalog()
				const providers = new Map(
					catalog.providers.map((provider) => [provider.id, provider.name]),
				)
				return catalog.models
					.filter((model) => model.type === type)
					.map((model) => ({
						...model,
						providerName: providers.get(model.provider) ?? model.provider,
					}))
			}),
		),
)
export type CatalogModel = Atom.Success<
	ReturnType<typeof modelCatalogAtom>
>[number]

/** Makes the selection for a model of the catalog. */
export const selectionOf = (
	model: Pick<CatalogModel, "provider" | "id">,
	reasoningEffort?: string,
) =>
	new Config.Selection({
		provider: model.provider as Config.Selection["provider"],
		model: model.id as Config.Selection["model"],
		...(reasoningEffort ? { reasoningEffort } : {}),
	})

/** The requests of Bots that wait for a decision of the person. */
export const pendingRequestsAtom = apiRuntime
	.atom(
		Effect.gen(function* () {
			const client = yield* Api
			return yield* client.api.requests.listRequests({
				query: { status: "pending" },
			})
		}),
	)
	.pipe(Atom.withReactivity([requestsKey]))

/** All requests of Bots that the person can decide or decided. */
export const allRequestsAtom = apiRuntime
	.atom(
		Effect.gen(function* () {
			const client = yield* Api
			const items = yield* client.api.requests.listRequests({ query: {} })
			return items.toSorted((a, b) => b.createdAt - a.createdAt)
		}),
	)
	.pipe(Atom.withReactivity([requestsKey]))

/** Allows or denies one request of a Bot. */
export const resolveRequestAtom = apiRuntime.fn(
	Effect.fnUntraced(function* (input: {
		readonly id: string
		readonly revision: number
		readonly decision: "allow" | "deny"
		readonly scope?: "once" | "chat" | "lifetime"
		readonly reason?: string
	}) {
		const requestId = yield* Schema.decodeUnknownEffect(
			RequestsApi.CapabilityRequestId,
		)(input.id)
		const command = yield* Requests.decide(requestId, {
			expected: input.revision,
			decision: input.decision,
			...(input.scope ? { scope: input.scope } : {}),
			...(input.reason ? { reason: input.reason } : {}),
		})
		return yield* waitForExecution(yield* command.send)
	}),
	{ reactivityKeys: [requestsKey, chatsKey] },
)

/** Tells other atoms that the chat list changed. */
export const invalidateChats = Reactivity.invalidate([chatsKey])
