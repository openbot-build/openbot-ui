import type { ChatEvent, ConversationActivity } from "@kaicom/kay-contracts"

/** The endpoint includes Chat history; a running bubble belongs to just one Turn. */
export const currentTurnActivity = (
	activity: ConversationActivity,
): ConversationActivity => ({
	...activity,
	updates: activity.updates.filter(
		(update) => activity.turnId !== null && update.turnId === activity.turnId,
	),
	tools: activity.tools.filter(
		(tool) => activity.turnId !== null && tool.turnId === activity.turnId,
	),
	delegations: activity.delegations.filter(
		(delegation) =>
			activity.turnId !== null &&
			delegation.parentChatId === activity.chatId &&
			delegation.parentTurnId === activity.turnId,
	),
	appOperations: activity.appOperations.filter(
		(operation) =>
			activity.turnId !== null && operation.turnId === activity.turnId,
	),
})

/** Only the plan belonging to the observed Turn contributes to its progress. */
export const activityPlan = (activity: ConversationActivity) => {
	const items =
		activity.turnId !== null &&
		activity.plan.turnId === activity.turnId &&
		activity.plan.source !== "none"
			? activity.plan.items
			: []
	return {
		items,
		progress:
			items.length === 0
				? null
				: {
						completed: items.filter((item) => item.status === "done").length,
						total: items.length,
					},
	}
}

export const executionActive = (status: string) =>
	["queued", "running", "waiting", "cancelling", "outcome_unknown"].includes(
		status,
	)

export const activityNeedsObservation = (activity: ConversationActivity) =>
	activity.status === "Running" ||
	activity.tools.some((tool) => executionActive(tool.status)) ||
	activity.delegations.some((delegation) =>
		executionActive(delegation.executionStatus),
	) ||
	activity.appOperations.some((operation) => executionActive(operation.status))

/** A plain completed reply already has its result in the transcript. */
export const hasTaskActivity = (activity: ConversationActivity) =>
	activity.status === "Running" ||
	activityPlan(activity).items.length > 0 ||
	activity.tools.length > 0 ||
	activity.updates.length > 0 ||
	activity.delegations.length > 0 ||
	activity.appOperations.length > 0

export const earlierActivityPending = (activity: ConversationActivity) =>
	activity.tools.some(
		(tool) => tool.turnId !== activity.turnId && executionActive(tool.status),
	) ||
	activity.delegations.some(
		(delegation) =>
			delegation.parentTurnId !== activity.turnId &&
			executionActive(delegation.executionStatus),
	) ||
	activity.appOperations.some(
		(operation) =>
			operation.turnId !== activity.turnId && executionActive(operation.status),
	)

/** A newer response cannot be overwritten by a delayed read of the same Chat. */
export const acceptActivity = ({
	previous,
	next,
}: {
	readonly previous: ConversationActivity | null
	readonly next: ConversationActivity
}) =>
	previous !== null &&
	previous.chatId === next.chatId &&
	(previous.revision > next.revision ||
		(previous.turnId === next.turnId &&
			previous.activeExecution !== undefined &&
			next.activeExecution?.id === previous.activeExecution.id &&
			previous.activeExecution.sequence > next.activeExecution.sequence))
		? previous
		: next

/** Events invalidate a saved snapshot; they never manufacture a successful tool result. */
export const activityEventNeedsRead = ({
	event,
	chatId,
}: {
	readonly event: ChatEvent
	readonly chatId: string
}) =>
	event.chatId === chatId &&
	(event.toolActivity !== undefined ||
		[
			"response.checkpoint",
			"response.output_text.done",
			"response.completed",
			"response.failed",
			"response.cancelled",
			"response.execution_moved",
		].includes(event.type))
