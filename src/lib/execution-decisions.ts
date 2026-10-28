import { ExecutionsApi } from "@openbot-build/client/Api"
import { HashMap } from "effect"

const { Execution } = ExecutionsApi

export type ExecutionDecision = Pick<
	ExecutionsApi.Execution.Decision,
	"id" | "choices"
>

export interface Decisions {
	readonly sequence: number
	readonly pending: HashMap.HashMap<string, ExecutionDecision>
}

export const emptyDecisions: Decisions = {
	sequence: 0,
	pending: HashMap.empty(),
}

/** Keep only choices that a person can still make. */
export const reduceDecisions = (
	state: Decisions,
	event: ExecutionsApi.Execution.Event,
): Decisions => {
	if (event.sequence <= state.sequence) return state
	const body = event.body
	let pending = state.pending
	switch (body._tag) {
		case "DecisionNeeded":
			pending = HashMap.set(pending, body.decisionId, {
				id: body.decisionId,
				choices: body.choices,
			})
			break
		case "DecisionMade":
			pending = HashMap.remove(pending, body.decisionId)
			break
		case "CallRecorded":
			pending = HashMap.filter(
				pending,
				(_, id) => !Execution.isCallDecision(id, body.callId),
			)
			break
		case "State":
			// A cancel closes old choices. The new cancel phase has its own IDs.
			if (body.status === "cancelling" || Execution.isTerminal(body.status))
				pending = HashMap.empty()
			break
	}
	return { sequence: event.sequence, pending }
}
