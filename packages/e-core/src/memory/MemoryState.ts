import { HashMap, HashSet, Match, Option, Schema } from "effect"
import { Prompt } from "effect/ai"
import type * as Memory from "./Memory.ts"
import type * as Item from "./Item.ts"
import * as ContextWindow from "../context/ContextWindow.ts"

export const initial = <P>(plugins: P): Memory.Value<P> => ({
	...plugins,
	memory: {
		history: [],
		context: ContextWindow.fromPrompt(Prompt.empty),
		closed: true,
	},
})
export const fullHistory = <P>(value: Memory.Value<P>): Prompt.Prompt =>
	value.memory.history.reduce(
		(prompt, entry) => Prompt.concat(prompt, entry.content),
		Prompt.empty,
	)

/** Coherent history never leaves a client tool invocation waiting for a result. */
export const coherent = <P>(value: Memory.Value<P>): boolean => {
	if (!value.memory.closed) return false
	let pending = HashSet.empty<string>()
	for (const entry of value.memory.history)
		for (const message of entry.content.content)
			Match.value(message).pipe(
				Match.when({ role: "assistant" }, (message) => {
					for (const part of message.content)
						Match.value(part).pipe(
							Match.when({ type: "tool-call" }, (part) => {
								if (!part.providerExecuted)
									pending = HashSet.add(pending, part.id)
							}),
							Match.orElse(() => {}),
						)
				}),
				Match.when({ role: "tool" }, (message) => {
					for (const part of message.content)
						Match.value(part).pipe(
							Match.when({ type: "tool-result" }, (part) => {
								pending = HashSet.remove(pending, part.id)
							}),
							Match.orElse(() => {}),
						)
				}),
				Match.orElse(() => {}),
			)
	return HashSet.size(pending) === 0
}

interface ToolOccurrence {
	readonly call: Prompt.ToolCallPart
	readonly result?: Prompt.ToolResultPart
}
interface ToolState {
	readonly calls: HashMap.HashMap<string, Prompt.ToolCallPart>
	readonly occurrences: HashMap.HashMap<string, ReadonlyArray<ToolOccurrence>>
	readonly pending: HashSet.HashSet<string>
}
const toolState = (prompt: Prompt.Prompt): ToolState => {
	let calls = HashMap.empty<string, Prompt.ToolCallPart>()
	let occurrences = HashMap.empty<string, ReadonlyArray<ToolOccurrence>>()
	let pending = HashSet.empty<string>()
	for (const message of prompt.content)
		Match.value(message).pipe(
			Match.when({ role: "assistant" }, (message) => {
				for (const part of message.content)
					Match.value(part).pipe(
						Match.when({ type: "tool-call" }, (part) => {
							if (part.providerExecuted !== true) {
								calls = HashMap.set(calls, part.id, part)
								occurrences = HashMap.set(occurrences, part.id, [
									...Option.getOrElse(
										HashMap.get(occurrences, part.id),
										() => [],
									),
									{ call: part },
								])
								pending = HashSet.add(pending, part.id)
							}
						}),
						Match.orElse(() => {}),
					)
			}),
			Match.when({ role: "tool" }, (message) => {
				for (const part of message.content)
					Match.value(part).pipe(
						Match.when({ type: "tool-result" }, (part) => {
							pending = HashSet.remove(pending, part.id)
							const entries = Option.getOrElse(
								HashMap.get(occurrences, part.id),
								() => [],
							)
							const latest = entries.at(-1)
							if (latest !== undefined)
								occurrences = HashMap.set(occurrences, part.id, [
									...entries.slice(0, -1),
									{ ...latest, result: part },
								])
						}),
						Match.orElse(() => {}),
					)
			}),
			Match.orElse(() => {}),
		)
	return { calls, occurrences, pending }
}
const unavailable = (call: Prompt.ToolCallPart) =>
	Prompt.toolResultPart({
		id: call.id,
		name: call.name,
		isFailure: true,
		providerExecuted: false,
		result:
			"The tool result is unavailable because its execution context ended. Observe the original operation before taking another action; do not resubmit it.",
	})
const sameCall = Schema.toEquivalence(Prompt.ToolCallPart)
const matchingOccurrences = (
	call: Prompt.ToolCallPart,
	state: ToolState,
): ReadonlyArray<ToolOccurrence> =>
	Option.getOrElse(HashMap.get(state.occurrences, call.id), () => []).filter(
		(candidate) => sameCall(candidate.call, call),
	)
const originalResult = (
	call: Prompt.ToolCallPart,
	source: ToolState,
	target: ToolState,
) => {
	const matches = matchingOccurrences(call, source)
	const result = matches.length === 1 ? matches[0]?.result : undefined
	// Context has no Item provenance: both sides must identify exactly one occurrence.
	return result !== undefined && matchingOccurrences(call, target).length === 1
		? result
		: unavailable(call)
}
const resultPrompt = (
	parts: ReadonlyArray<Prompt.ToolResultPart>,
): Prompt.Prompt =>
	Prompt.make(parts.length === 0 ? [] : [{ role: "tool", content: parts }])
/** Close retained client calls as observations only, without invoking their handlers. */
export const finishToolCalls =
	(options: { readonly item: Item.Id; readonly origin?: Item.Origin }) =>
	<P>(value: Memory.Value<P>): Memory.Value<P> => {
		const history = toolState(fullHistory(value))
		const context = toolState(value.memory.context.prompt)
		if (
			HashSet.size(history.pending) === 0 &&
			HashSet.size(context.pending) === 0
		)
			return value
		const historyResult = resultPrompt(
			Array.from(history.pending, (id) =>
				originalResult(HashMap.getUnsafe(history.calls, id), context, history),
			),
		)
		const contextResult = resultPrompt(
			Array.from(context.pending, (id) =>
				originalResult(HashMap.getUnsafe(context.calls, id), history, context),
			),
		)
		return {
			...value,
			memory: {
				...value.memory,
				history:
					historyResult.content.length === 0
						? value.memory.history
						: [
								...value.memory.history,
								{
									id: options.item,
									content: historyResult,
									...(options.origin === undefined
										? {}
										: { origin: options.origin }),
								},
							],
				context: ContextWindow.append(value.memory.context, contextResult),
			},
		}
	}
