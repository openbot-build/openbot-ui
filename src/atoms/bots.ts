import type { BotsApi } from "@openbot-build/client/Api"
import { Effect } from "effect"
import * as Atom from "effect/reactivity/Atom"
import { Api, apiRuntime } from "@/lib/api"

const botsKey = "bots"

export type Bot = BotsApi.Bot

/**
 * The Bots that the person can use: their own Bots and the shared ones. Their
 * default Bot comes first, because clients talk to it first.
 */
export const botsAtom = apiRuntime
	.atom(
		Effect.gen(function* () {
			const client = yield* Api
			const [items, settings] = yield* Effect.all(
				[
					client.api.bots.listBots({ query: { archived: false } }),
					client.api.memberSettings.getMemberSettings(),
				],
				{ concurrency: 2 },
			)
			// Bots that another Bot owns are helpers. They work only for that Bot.
			const bots = items
				.filter((bot) => bot.owner._tag !== "Bot")
				.toSorted(
					(a, b) =>
						Number(b.id === settings.defaultBot) -
							Number(a.id === settings.defaultBot) ||
						a.name.localeCompare(b.name),
				)
			return { bots, defaultBot: settings.defaultBot }
		}),
	)
	.pipe(Atom.withReactivity([botsKey]))

/**
 * Makes a new Bot. OpenBot makes no Bot for a new member, so the first Bot that
 * a person makes becomes their default Bot: the one that the start page talks to.
 */
export const createBotAtom = apiRuntime.fn(
	Effect.fnUntraced(function* (input: {
		readonly name: string
		readonly role: string
		readonly instructions: string
		readonly shared: boolean
	}) {
		const client = yield* Api
		const bot = yield* client.api.bots.createBot({
			payload: {
				name: input.name,
				role: input.role,
				instructions: input.instructions,
				...(input.shared ? { shared: true } : {}),
			},
		})
		const settings = yield* client.api.memberSettings.getMemberSettings()
		if (settings.defaultBot === null)
			yield* client.api.memberSettings.updateMemberSettings({
				payload: { expectedVersion: settings.version, defaultBot: bot.id },
			})
		return bot
	}),
	{ reactivityKeys: [botsKey] },
)

/** Makes a Bot the default Bot of the person. */
export const setDefaultBotAtom = apiRuntime.fn(
	Effect.fnUntraced(function* (bot: Bot) {
		const client = yield* Api
		const settings = yield* client.api.memberSettings.getMemberSettings()
		yield* client.api.memberSettings.updateMemberSettings({
			payload: { expectedVersion: settings.version, defaultBot: bot.id },
		})
	}),
	{ reactivityKeys: [botsKey] },
)

/** Changes a Bot. */
export const updateBotAtom = apiRuntime.fn(
	Effect.fnUntraced(function* (input: {
		readonly bot: Bot
		readonly name?: string
		readonly role?: string
		readonly instructions?: string
		readonly archived?: boolean
	}) {
		const client = yield* Api
		return yield* client.api.bots.updateBot({
			params: { botId: input.bot.id },
			payload: {
				expected: input.bot.revision,
				...(input.name !== undefined ? { name: input.name } : {}),
				...(input.role !== undefined ? { role: input.role } : {}),
				...(input.instructions !== undefined
					? { instructions: input.instructions }
					: {}),
				...(input.archived !== undefined ? { archived: input.archived } : {}),
			},
		})
	}),
	{ reactivityKeys: [botsKey] },
)
