import { Schema } from "effect"

const Id = Schema.NonEmptyString.check(Schema.isMaxLength(256))
export const ActivityProgress = Schema.NullOr(
	Schema.Struct({
		completed: Schema.Natural,
		total: Schema.Int.check(Schema.isGreaterThan(0)),
	}),
)
export const ActivityTodo = Schema.Struct({
	id: Id,
	content: Schema.String,
	status: Schema.Literals(["pending", "in_progress", "done"]),
})
export const ActivityExecutionStatus = Schema.Literals([
	"queued",
	"running",
	"waiting",
	"cancelling",
	"completed",
	"failed",
	"cancelled",
	"interrupted",
	"outcome_unknown",
])
export const ActivityExecution = Schema.Struct({
	id: Id,
	sequence: Schema.Natural,
	status: ActivityExecutionStatus,
})
export const ToolActivity = Schema.Struct({
	step: Schema.NonEmptyString,
	attempt: Schema.Natural,
	itemId: Id,
	callId: Id,
	name: Schema.NonEmptyString,
	computerId: Schema.NullOr(Id),
	/** A completed step is not proof that its external operation succeeded. */
	status: Schema.Literals(["queued", "ended"]),
})
export const ActivityPlan = Schema.Struct({
	source: Schema.Literals(["current", "history", "none"]),
	items: Schema.Array(ActivityTodo),
	sourceItemId: Schema.NullOr(Id),
	turnId: Schema.NullOr(Id),
})
export const ActivityTool = Schema.Struct({
	id: Id,
	executionId: Schema.NullOr(Id),
	turnId: Schema.NullOr(Id),
	itemId: Schema.NullOr(Id),
	name: Schema.String,
	/** Names from the saved App source; the protocol name remains unchanged. */
	displayName: Schema.optionalKey(Schema.String),
	appName: Schema.optionalKey(Schema.String),
	status: ActivityExecutionStatus,
	startedAt: Schema.NullOr(Schema.Finite),
	completedAt: Schema.NullOr(Schema.Finite),
	/** Present only when the saved call names this Computer explicitly. */
	computerId: Schema.NullOr(Id),
	/** Ready File references from saved results; never workspace paths or URLs. */
	fileIds: Schema.Array(Id),
})
export const ActivityDelegation = Schema.Struct({
	id: Id,
	chatId: Schema.NullOr(Id),
	parentChatId: Id,
	parentTurnId: Schema.NullOr(Id),
	task: Schema.String,
	status: Schema.Literals([
		"authorizing",
		"queued",
		"running",
		"paused",
		"completed",
		"failed",
		"cancelled",
	]),
	executionStatus: ActivityExecutionStatus,
	executionId: Id,
	result: Schema.NullOr(Schema.String),
})
export const ActivityAppOperation = Schema.Struct({
	id: Id,
	executionId: Id,
	turnId: Id,
	name: Schema.String,
	displayName: Schema.optionalKey(Schema.String),
	appName: Schema.optionalKey(Schema.String),
	status: ActivityExecutionStatus,
})
export const ActivityUpdate = Schema.Struct({
	id: Id,
	itemId: Id,
	turnId: Schema.NullOr(Id),
	sequence: Schema.Natural,
	text: Schema.String,
	source: Schema.Literal("assistant_activity"),
})
/** A read-only view of one coherent Chat revision. Unknown progress stays null. */
export const ConversationActivity = Schema.Struct({
	chatId: Id,
	revision: Schema.Natural,
	turnId: Schema.NullOr(Id),
	status: Schema.Literals([
		"Idle",
		"Running",
		"Completed",
		"Failed",
		"Interrupted",
	]),
	model: Schema.NullOr(Schema.Struct({ provider: Id, model: Id })),
	activeExecution: Schema.optionalKey(ActivityExecution),
	progress: ActivityProgress,
	plan: ActivityPlan,
	updates: Schema.Array(ActivityUpdate),
	tools: Schema.Array(ActivityTool),
	delegations: Schema.Array(ActivityDelegation),
	appOperations: Schema.Array(ActivityAppOperation),
	/** A bounded scan is explicit. A missing historical plan is not proof of completion. */
	history: Schema.Struct({
		complete: Schema.Boolean,
		nextBefore: Schema.NullOr(Schema.Natural),
	}),
})
export type ConversationActivity = typeof ConversationActivity.Type
