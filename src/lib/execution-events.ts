import type { ExecutionsApi } from "@openbot-build/client/Api"
import { HashMap, Option } from "effect"

interface StepText {
	readonly attempt: number
	readonly text: string
}

/** Saved text for one execution. A model retry replaces only its own step. */
export interface Answer {
	readonly sequence: number
	readonly steps: ReadonlyArray<string>
	readonly parts: HashMap.HashMap<string, StepText>
	readonly text: string
}

export const emptyAnswer: Answer = {
	sequence: 0,
	steps: [],
	parts: HashMap.empty(),
	text: "",
}

/** Replayed events do not repeat text, and a failed model attempt stays apart. */
export const reduceAnswer = (
	state: Answer,
	event: ExecutionsApi.Execution.Event,
): Answer => {
	if (event.sequence <= state.sequence) return state
	const body = event.body
	if (body._tag !== "Text" && body._tag !== "StepStarted")
		return { ...state, sequence: event.sequence }
	const saved = HashMap.get(state.parts, body.step)
	const previous = Option.getOrUndefined(saved)
	if (previous !== undefined && body.attempt < previous.attempt)
		return { ...state, sequence: event.sequence }
	const part = {
		attempt: body.attempt,
		text:
			(previous?.attempt === body.attempt ? previous.text : "") +
			(body._tag === "Text" ? body.text : ""),
	}
	const steps =
		previous === undefined ? [...state.steps, body.step] : state.steps
	const parts = HashMap.set(state.parts, body.step, part)
	return {
		sequence: event.sequence,
		steps,
		parts,
		text: steps
			.flatMap((step) => {
				const text = Option.getOrUndefined(HashMap.get(parts, step))?.text
				return text ? [text] : []
			})
			.join("\n\n"),
	}
}
