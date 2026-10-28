import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import type { ExecutionsApi } from "@openbot-build/client/Api"
import { useState } from "react"
import { toast } from "sonner"
import {
	decideExecutionAtom,
	executionDecisionsAtom,
	type ExecutionDecision,
} from "@/atoms/executions"
import { Button } from "@/components/ui/button"
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemFooter,
	ItemTitle,
} from "@/components/ui/item"
import { errorMessage } from "@/lib/api"
import { toolLabel, type ToolCall } from "@/lib/conversation"
import { resultValue } from "@/lib/utils"

const answerLabel: Record<ExecutionsApi.Execution.Answer, string> = {
	retry: "Try again",
	stop: "Stop this work",
	allow: "Allow",
	deny: "Deny",
}

/** Choices come from the execution, including a tool that stays in its Turn. */
export function ExecutionDecisions({
	operations,
}: {
	readonly operations: ReadonlyArray<ToolCall>
}) {
	return operations
		.filter(
			(operation) =>
				operation.status === "outcome_unknown" ||
				operation.status === "waiting",
		)
		.map((operation) => (
			<ToolDecisions key={operation.executionId} operation={operation} />
		))
}

function ToolDecisions({ operation }: { readonly operation: ToolCall }) {
	const atom = executionDecisionsAtom(operation.executionId)
	const result = useAtomValue(atom)
	const refresh = useAtomRefresh(atom)
	if (result._tag === "Failure")
		return (
			<Item className="min-h-(--corner-room) gap-y-5 rounded-screen bg-card p-(--corner-inset)">
				<ItemContent role="alert">
					<ItemTitle>The choices did not load</ItemTitle>
					<ItemDescription className="line-clamp-none">
						{errorMessage(result.cause)}
					</ItemDescription>
				</ItemContent>
				<ItemFooter className="justify-end">
					<Button variant="outline" className="h-9" onClick={refresh}>
						Try again
					</Button>
				</ItemFooter>
			</Item>
		)
	return (resultValue(result) ?? []).map((decision) => (
		<DecisionCard key={decision.id} operation={operation} decision={decision} />
	))
}

function DecisionCard({
	operation,
	decision,
}: {
	readonly operation: ToolCall
	readonly decision: ExecutionDecision
}) {
	const decide = useAtomSet(decideExecutionAtom, { mode: "promise" })
	const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle")
	const answer = (choice: ExecutionsApi.Execution.Answer) => {
		setStatus("saving")
		void decide({
			executionId: operation.executionId,
			decisionId: decision.id,
			answer: choice,
		}).then(
			() => setStatus("saved"),
			(cause: unknown) => {
				toast.error(errorMessage(cause))
				setStatus("idle")
			},
		)
	}
	if (status === "saved") return null
	return (
		<Item className="min-h-(--corner-room) gap-y-5 rounded-screen bg-card p-(--corner-inset)">
			<ItemContent>
				<ItemTitle>{toolLabel(operation.tool)} needs your answer</ItemTitle>
				<ItemDescription className="line-clamp-none">
					{operation.status === "outcome_unknown"
						? "The result is unknown. Trying again can run the action twice."
						: "Choose whether this work can go on."}
				</ItemDescription>
			</ItemContent>
			<ItemFooter className="justify-end">
				<ItemActions className="flex-wrap justify-end">
					{decision.choices.map((choice) => (
						<Button
							key={choice}
							variant={
								choice === "stop" || choice === "deny" ? "outline" : "default"
							}
							className="h-9 px-4"
							disabled={status === "saving"}
							onClick={() => answer(choice)}
						>
							{answerLabel[choice]}
						</Button>
					))}
				</ItemActions>
			</ItemFooter>
		</Item>
	)
}
