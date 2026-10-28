import type { ExecutionsApi } from "@openbot-build/client/Api"
import { Executions } from "@openbot-build/client"
import { Effect, HashMap } from "effect"
import * as Atom from "effect/reactivity/Atom"
import { chatsKey, requestsKey } from "@/atoms/chats"
import { Api, apiRuntime } from "@/lib/api"
import { emptyDecisions, reduceDecisions } from "@/lib/execution-decisions"

export type { ExecutionDecision } from "@/lib/execution-decisions"

export const executionDecisionsKey = "execution-decisions"

/** Read every saved choice, including changes to choices after cancellation. */
export const executionDecisionsAtom = Atom.family(
	(executionId: ExecutionsApi.Execution.Id) =>
		apiRuntime
			.atom(
				Effect.gen(function* () {
					const client = yield* Api
					let afterSequence = 0
					let decisions = emptyDecisions
					while (true) {
						const page = yield* client.api.executions.events({
							params: { executionId },
							query: { afterSequence },
						})
						decisions = page.events.reduce(reduceDecisions, decisions)
						if (page.terminal) return []
						if (page.afterSequence === afterSequence) break
						afterSequence = page.afterSequence
					}
					return Array.from(HashMap.values(decisions.pending))
				}),
			)
			.pipe(Atom.withReactivity([executionDecisionsKey])),
)

/** Save the answer. The work may keep running after the answer is saved. */
export const decideExecutionAtom = apiRuntime.fn(
	Effect.fnUntraced(function* (input: {
		readonly executionId: ExecutionsApi.Execution.Id
		readonly decisionId: string
		readonly answer: ExecutionsApi.Execution.Answer
	}) {
		const command = yield* Executions.decide(input.executionId, {
			decisionId: input.decisionId,
			answer: input.answer,
		})
		return yield* command.send
	}),
	{
		concurrent: true,
		reactivityKeys: [executionDecisionsKey, requestsKey, chatsKey],
	},
)
