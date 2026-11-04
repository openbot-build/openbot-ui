import type { ConversationActivity } from "@kaicom/kay-contracts"
import * as HashSet from "effect/HashSet"
import { currentTurnActivity } from "./ActivityModel.ts"

const activeStatuses = [
	"running",
	"cancelling",
	"waiting",
	"queued",
	"outcome_unknown",
] as const

type ActiveStatus = (typeof activeStatuses)[number]
type Tool = ConversationActivity["tools"][number]
type Operation = ConversationActivity["appOperations"][number]

export type ActivityPresentationStatus =
	| ActiveStatus
	| "working"
	| "completed"
	| "failed"
	| "interrupted"
	| "idle"
	| "stale"

export interface ActivityPresentation {
	readonly status: ActivityPresentationStatus
	/** Only an observed running execution may animate; Turn activity is insufficient. */
	readonly busy: boolean
	readonly tool: Tool | null
	readonly operation: Operation | null
	readonly failed: number
	readonly unconfirmed: number
}

/** Historical failures describe attempts, not the outcome of the current Turn. */
export const activityHistoryIssues = ({
	activity,
	history,
}: {
	readonly activity: ConversationActivity
	readonly history: ConversationActivity
}) => {
	const sameChat = history.chatId === activity.chatId
	const previous = {
		...history,
		tools: history.tools.filter(
			(item) => sameChat && item.turnId !== activity.turnId,
		),
		appOperations: history.appOperations.filter(
			(item) => sameChat && item.turnId !== activity.turnId,
		),
		delegations: history.delegations.filter(
			(item) => sameChat && item.parentTurnId !== activity.turnId,
		),
	}
	const current = activityPresentation(activity)
	const earlier = activityPresentation(previous)
	return {
		currentFailed: current.failed,
		earlierFailed: earlier.failed,
		unconfirmed: current.unconfirmed + earlier.unconfirmed,
	}
}

/** Use the supplied activity scope; older background work must not be silently discarded. */
// @effect-diagnostics-next-line missingPipeableSignature:off
export const activityPresentation = (
	activity: ConversationActivity,
	stale = false,
): ActivityPresentation => {
	// Execution state wins across resource kinds; ties prefer the concrete tool.
	const current = activeStatuses
		.map((status) => {
			const tool = activity.tools.findLast((item) => item.status === status)
			if (tool !== undefined) return { status, tool, operation: null }
			const operation = activity.appOperations.findLast(
				(item) => item.status === status,
			)
			if (operation !== undefined) return { status, tool: null, operation }
			return activity.delegations.some(
				(item) => item.executionStatus === status,
			)
				? { status, tool: null, operation: null }
				: undefined
		})
		.find((item) => item !== undefined)
	const observations = [
		...activity.tools.map((item) => ({
			key:
				item.executionId === null
					? `tool:${item.id}`
					: `execution:${item.executionId}`,
			status: item.status,
		})),
		...activity.appOperations.map((item) => ({
			key: `execution:${item.executionId}`,
			status: item.status,
		})),
		...activity.delegations.map((item) => ({
			key: `execution:${item.executionId}`,
			status: item.executionStatus,
		})),
	]
	const count = (status: "failed" | "outcome_unknown") =>
		HashSet.size(
			HashSet.fromIterable(
				observations
					.filter((item) => item.status === status)
					.map((item) => item.key),
			),
		)
	const turnStatus = {
		Idle: "idle",
		Running: "working",
		Completed: "completed",
		Failed: "failed",
		Interrupted: "interrupted",
	} as const
	const status: ActivityPresentationStatus = stale
		? "stale"
		: (current?.status ?? turnStatus[activity.status])
	return {
		status,
		busy: status === "running",
		tool: current?.tool ?? null,
		operation: current?.operation ?? null,
		failed: count("failed"),
		unconfirmed: count("outcome_unknown"),
	}
}

/** The dock follows concrete work in the selected Chat, even after a page refresh. */
export const activityIsland = ({
	activity,
	chatId,
	stale,
}: {
	readonly activity: ConversationActivity | null
	readonly chatId: string | undefined
	readonly stale: boolean
}): ActivityPresentation | null => {
	if (
		stale ||
		activity === null ||
		activity.chatId !== chatId ||
		activity.turnId === null
	)
		return null
	const current = activityPresentation(currentTurnActivity(activity))
	if (
		current.status === "working" &&
		activity.activeExecution?.status === "waiting"
	)
		return { ...current, status: "waiting" }
	return activeStatuses.some((status) => status === current.status)
		? current
		: null
}
