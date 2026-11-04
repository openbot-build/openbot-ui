import { createHash, randomUUID } from "node:crypto"
import { Schema } from "effect"
import * as Product from "@kaicom/kay-contracts"
import type { NativeClient } from "@kaicom/kay-contracts/Native"
import type { DatabaseRuntime } from "./Database.ts"
import { makeOperations, type Operation } from "./Operations.ts"
import { BusinessFailure } from "./ProductBusiness.ts"

const settingsSchema = Schema.Struct({
	version: Schema.Natural,
	defaultBot: Schema.NullOr(Product.Id),
})
const botSchema = Schema.Struct({
	id: Product.Id,
	owner: Schema.JsonObject,
	name: Schema.String,
	role: Schema.String,
	instructions: Schema.String,
	archived: Schema.Boolean,
	revision: Schema.Natural,
	model: Schema.optionalKey(Schema.JsonObject),
})
const catalogSchema = Schema.Struct({
	models: Schema.Array(
		Schema.Struct({
			provider: Schema.String,
			id: Schema.String,
			type: Schema.Literals(["language", "decision", "live"]),
		}),
	),
})
const definition = {
	name: "Kay Bot",
	role: "Your personal assistant",
	instructions: "Help the person with their conversations and tasks.",
}

/** One recorded attempt owns creation. Only an explicit retry after confirmed refusal may claim again. */
export const makeDefaultBot = (input: {
	readonly db: DatabaseRuntime
	readonly client: NativeClient
	readonly identity: typeof Product.Identity.Type
	readonly epoch: number
}) => {
	const operations = makeOperations(input.db)
	const owner = {
		id:
			"default-bot:" +
			createHash("sha256")
				.update(
					JSON.stringify([
						input.identity.organizationId,
						input.identity.userId,
					]),
				)
				.digest("hex"),
		accountId: input.identity.userId,
	}
	const invoke = async (id: string, payload?: unknown) =>
		input.client.request({
			operation: "feature",
			id,
			payload: payload === undefined ? {} : { payload },
		})
	const readSettings = async () => {
		const response = await invoke("memberSettings.getMemberSettings")
		if (!response.ok)
			throw BusinessFailure.make({
				status: response.status,
				message: "The workspace settings could not be read.",
			})
		return Schema.decodeUnknownSync(settingsSchema)(await response.json())
	}
	const readBots = async () => {
		const response = await input.client.request({ operation: "bots" })
		if (!response.ok)
			throw BusinessFailure.make({
				status: response.status,
				message: "The workspace assistant could not be read.",
			})
		return Schema.decodeUnknownSync(Schema.Array(botSchema))(
			await response.json(),
		)
	}
	const languageModel = async () => {
		const shared = await invoke("organization.getSettings")
		if (!shared.ok)
			throw BusinessFailure.make({
				status: shared.status,
				message: "The organization's default model could not be read.",
			})
		const settings = Schema.decodeUnknownSync(
			Schema.Struct({
				chatModel: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)),
			}),
		)(await shared.json())
		// Keep inheritance live. Saving this selection on the Bot would freeze it.
		if (settings.chatModel != null) return undefined
		const response = await invoke("modelProviders.getModelCatalog")
		if (!response.ok)
			throw BusinessFailure.make({
				status: response.status,
				message: "Available models could not be read.",
			})
		const catalog = Schema.decodeUnknownSync(catalogSchema)(
			await response.json(),
		)
		const model = catalog.models.find((entry) => entry.type === "language")
		if (model === undefined)
			throw BusinessFailure.make({
				status: 503,
				message:
					"No language model is available. Ask an administrator to configure one.",
			})
		return {
			_tag: "Config.Selection",
			provider: model.provider,
			model: model.id,
		}
	}
	const owned = (bot: typeof botSchema.Type) =>
		!bot.archived &&
		bot.owner["_tag"] === "Member" &&
		bot.owner["userId"] === input.identity.userId
	const ready = (botId: string): Product.DefaultBotStatus => ({
		phase: "ready",
		botId,
	})
	const uncertain = (
		botId: string | null = null,
	): Product.DefaultBotStatus => ({ phase: "outcome_unknown", botId })
	const get = async (): Promise<Product.DefaultBotStatus> => {
		const settings = await readSettings()
		if (settings.defaultBot !== null) return ready(settings.defaultBot)
		const operation = await operations.get(owner)
		if (operation === null) return { phase: "uninitialized", botId: null }
		const known =
			operation.result?.["botId"] ?? operation.request["existingBotId"]
		// Reading status never creates a Bot or changes the member's settings.
		const bots = await readBots()
		const previous = Schema.decodeUnknownSync(Schema.Array(Product.Id))(
			operation.request["previousBotIds"],
		)
		const candidates = bots.filter(
			(bot) =>
				owned(bot) &&
				(typeof known === "string"
					? bot.id === known
					: !previous.includes(bot.id) &&
						bot.name === definition.name &&
						bot.role === definition.role &&
						bot.instructions === definition.instructions),
		)
		return uncertain(candidates.length === 1 ? candidates[0]!.id : null)
	}
	const ensure = async (): Promise<Product.DefaultBotStatus> => {
		const settings = await readSettings()
		if (settings.defaultBot !== null) return ready(settings.defaultBot)
		const bots = await readBots()
		// Resolve before recording a write, so a missing provider can be configured and retried safely.
		const model = await languageModel()
		const existing = bots.filter(
			(bot) => owned(bot) && bot.name === definition.name,
		)
		if (existing.length > 1) return uncertain()
		const attemptId = randomUUID()
		const attempt: Operation = {
			...owner,
			kind: "default-bot",
			backend: "openbot",
			epoch: input.epoch,
			request: {
				attemptId,
				organizationId: input.identity.organizationId,
				previousBotIds: bots.map((bot) => bot.id),
				existingBotId: existing.length === 1 ? existing[0]!.id : null,
			},
		}
		const claimed = await operations.claim(attempt)
		let botId: string
		if (!claimed) {
			const status = await get()
			if (status.phase === "ready" || status.botId === null) return status
			botId = status.botId
		} else {
			// Reuse an existing personal Kay Bot when the member has not selected one.
			if (existing.length === 1) botId = existing[0]!.id
			else {
				await operations.mark({ ...owner, attemptId, phase: "Sending" })
				try {
					const response = await invoke("bots.createBot", {
						...definition,
						...(model === undefined ? {} : { model }),
					})
					if (!response.ok) {
						await response.body?.cancel().catch(() => undefined)
						if ([400, 401, 403, 404, 409, 422].includes(response.status)) {
							await operations.releaseRejected({
								...attempt,
								status: response.status,
							})
							throw BusinessFailure.make({
								status: response.status,
								message: "The assistant could not be created.",
							})
						}
						throw new Error(
							"The assistant creation result could not be confirmed.",
						)
					}
					const created = Schema.decodeUnknownSync(botSchema)(
						await response.json(),
					)
					if (!owned(created))
						throw new Error(
							"The assistant owner does not match the current member.",
						)
					botId = created.id
				} catch (error) {
					if (error instanceof BusinessFailure) throw error
					await operations.mark({
						...owner,
						attemptId,
						phase: "OutcomeUnknown",
					})
					return uncertain()
				}
			}
		}
		await operations.mark({ ...owner, phase: "Applied", result: { botId } })
		const recorded = (await readBots()).find(
			(bot) => bot.id === botId && owned(bot),
		)
		if (recorded === undefined) return uncertain(botId)
		if (recorded.model === undefined && model !== undefined) {
			// A previous interrupted setup may have created a Bot before model selection was added.
			try {
				const response = await input.client.request({
					operation: "feature",
					id: "bots.updateBot",
					payload: {
						params: { botId },
						payload: { expected: recorded.revision, model },
					},
				})
				if (!response.ok) {
					await response.body?.cancel()
					return uncertain(botId)
				}
				await response.body?.cancel()
			} catch {
				return uncertain(botId)
			}
		}
		// This CAS cannot replace another tab's explicit selection. It is safe to resume with the same recorded Bot.
		const current = await readSettings()
		if (current.defaultBot !== null) return ready(current.defaultBot)
		try {
			const response = await invoke("memberSettings.updateMemberSettings", {
				expectedVersion: current.version,
				defaultBot: botId,
			})
			if (!response.ok) {
				await response.body?.cancel()
				const latest = await readSettings()
				return latest.defaultBot === null
					? uncertain(botId)
					: ready(latest.defaultBot)
			}
			const saved = Schema.decodeUnknownSync(settingsSchema)(
				await response.json(),
			)
			if (saved.defaultBot === null) return uncertain(botId)
			await operations.mark({
				...owner,
				phase: "Completed",
				result: { botId: saved.defaultBot },
			})
			return ready(saved.defaultBot)
		} catch {
			try {
				const latest = await readSettings()
				if (latest.defaultBot !== null) {
					await operations.mark({
						...owner,
						phase: "Completed",
						result: { botId: latest.defaultBot },
					})
					return ready(latest.defaultBot)
				}
			} catch {
				/* Keep the recorded Bot for a later read or explicit reconciliation. */
			}
			return uncertain(botId)
		}
	}
	return { get, ensure }
}
