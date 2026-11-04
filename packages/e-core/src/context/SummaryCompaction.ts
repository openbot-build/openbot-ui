import { Match, Effect, HashMap, Schema } from "effect"
import { LanguageModel, Prompt } from "effect/ai"
import * as ContextCompaction from "./ContextCompaction.ts"
import * as ContextWindow from "./ContextWindow.ts"
import { PromptJson } from "../store/PromptCodec.ts"

/**
 * Identifies related tool calls, results, and approval messages so compaction
 * keeps each tool interaction together. Approval requests carry both keys to
 * connect the approval exchange to its tool call.
 */
const links = (message: Prompt.Message): ReadonlyArray<string> =>
	Match.value(message).pipe(
		Match.discriminator("role")("system", () => []),
		Match.orElse((message) =>
			message.content.flatMap((part) =>
				Match.value(part).pipe(
					Match.discriminator("type")("tool-call", "tool-result", (part) => [
						`call:${part.id}`,
					]),
					Match.discriminator("type")("tool-approval-request", (part) => [
						`call:${part.toolCallId}`,
						`approval:${part.approvalId}`,
					]),
					Match.discriminator("type")("tool-approval-response", (part) => [
						`approval:${part.approvalId}`,
					]),
					Match.orElse(() => []),
				),
			),
		),
	)

/** Summarizes older context using the provided model while keeping recent messages intact. */
export const compact: ContextCompaction.NonNativeCompact = (input) =>
	Effect.gen(function* () {
		const systems = input.prompt.content.filter(
			(message) => message.role === "system",
		)
		const messages = input.prompt.content.filter(
			(message) => message.role !== "system",
		)
		// Earlier messages overwrite later positions, leaving the first occurrence of each key.
		const firstMessageByInteraction = messages.reduceRight(
			(first, message, index) =>
				links(message).reduce(
					(first, key) => HashMap.set(first, key, index),
					first,
				),
			HashMap.empty<string, number>(),
		)
		// Extend the retained suffix to include the start of every retained tool interaction.
		// Scanning backward also follows dependencies in messages added by an earlier extension.
		const boundary = messages.reduceRight(
			(boundary, message, index) =>
				index < boundary
					? boundary
					: links(message).reduce(
							(boundary, key) =>
								Math.min(
									boundary,
									HashMap.getUnsafe(firstMessageByInteraction, key),
								),
							boundary,
						),
			Math.max(0, messages.length - (input.keepRecentMessages ?? 8)),
		)
		if (boundary === 0) return ContextWindow.fromPrompt(input.prompt)
		const source = Prompt.fromMessages(messages.slice(0, boundary))
		const encoded = yield* Schema.encodeEffect(PromptJson)(source).pipe(
			Effect.mapError(
				(error) =>
					new ContextCompaction.ContextCompactionError({
						reason: "request-failed",
						message: `Failed to encode the summary input: ${error.message}`,
					}),
			),
		)
		const response = yield* LanguageModel.generateText({
			prompt: Prompt.make([
				{
					role: "system",
					content: `Summarize the earlier conversation supplied as JSON data. Preserve the user's goal, constraints, decisions, important facts, tool outcomes, and outstanding work. Incorporate any existing conversation summary. Do not continue the task or invoke tools. Return only a concise summary, leaving room for recent messages within a total context budget of ${input.targetTokens} tokens.`,
				},
				{ role: "user", content: JSON.stringify(encoded) },
			]),
			toolChoice: "none",
		}).pipe(
			Effect.mapError(
				(error) =>
					new ContextCompaction.ContextCompactionError({
						reason: "request-failed",
						message: `Failed to generate the summary: ${error.message}`,
					}),
			),
		)
		if (response.text.trim().length === 0 || response.finishReason === "length")
			return yield* new ContextCompaction.ContextCompactionError({
				reason: "request-failed",
				message:
					"The summary is empty or was truncated by the output token limit",
			})
		return ContextWindow.fromPrompt(
			Prompt.fromMessages([
				...systems,
				Prompt.userMessage({
					content: [
						Prompt.textPart({
							text: `Summary of earlier conversation:\n${response.text}`,
						}),
					],
				}),
				...messages.slice(boundary),
			]),
		)
	})
