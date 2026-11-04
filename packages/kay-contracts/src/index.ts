export * from "./Feedback.ts"
export * from "./Activity.ts"
export * from "./Devices.ts"
import { Schema } from "effect"
import { ToolActivity } from "./Activity.ts"

/** Product contracts contain no execution engine types. */
export const Id = Schema.NonEmptyString.check(Schema.isMaxLength(256))
export const Revision = Schema.Natural
export const ChatKind = Schema.Literals([
	"direct",
	"conversation",
	"task",
	"review",
	"channel",
	"live",
])
export const ChatStatus = Schema.Literals([
	"Idle",
	"Running",
	"Completed",
	"Failed",
	"Interrupted",
])
export const Activity = Schema.Literals(["active", "inactive", "historical"])
export const Memory = Schema.Struct({
	read: Schema.Boolean,
	write: Schema.Boolean,
})
export const Companion = Schema.Struct({
	id: Id,
	name: Schema.String,
	description: Schema.String,
	isDefault: Schema.Boolean,
	archived: Schema.Boolean,
})
export type Companion = typeof Companion.Type
export const Branch = Schema.Struct({
	sourceChatId: Id,
	sourceRevision: Revision,
	throughSequence: Schema.Natural,
	rootChatId: Id,
	reason: Schema.Literals(["fork", "regenerate"]),
})
export const ConversationSummary = Schema.Struct({
	id: Id,
	botId: Id,
	kind: ChatKind,
	revision: Revision,
	title: Schema.NullOr(Schema.String),
	status: ChatStatus,
	activity: Activity,
	createdAt: Schema.Finite,
	branch: Schema.NullOr(Branch),
	memory: Memory,
})
export type ConversationSummary = typeof ConversationSummary.Type
export const Conversation = Schema.Struct({
	...ConversationSummary.fields,
	queuedInputs: Schema.Natural,
	activeTurnId: Schema.NullOr(Id),
	openWork: Schema.Struct({
		tasks: Schema.Natural,
		approvals: Schema.Natural,
		reminders: Schema.Natural,
	}),
})
export type Conversation = typeof Conversation.Type
export const Identity = Schema.Struct({
	userId: Id,
	organizationId: Id,
	displayName: Schema.String,
	avatarUrl: Schema.optional(Schema.NullOr(Schema.String)),
})
export const Access = Schema.Struct({ adminConsole: Schema.Boolean })
export type Access = typeof Access.Type
export {
	isAdministrationOperation,
	administrationGroups,
} from "./FeatureAudience.ts"
export const Features = Schema.Struct({
	dualConversations: Schema.Boolean,
	tasks: Schema.Boolean,
	files: Schema.Boolean,
	automations: Schema.Boolean,
	live: Schema.Boolean,
	computers: Schema.Boolean,
})
export const AutomationIds = Schema.Array(Id).check(
	Schema.isMaxLength(100),
	Schema.makeFilter(
		(ids) =>
			new Set(ids).size === ids.length ||
			"Each automation can be linked only once.",
	),
)
export const ChatMetadata = Schema.Struct({
	chatId: Id,
	revision: Revision,
	title: Schema.NullOr(Schema.String),
	archived: Schema.Boolean,
	automationIds: Schema.optionalKey(AutomationIds),
})
export type ChatMetadata = typeof ChatMetadata.Type
export const ChatMetadataPatch = Schema.Struct({
	expected: Revision,
	title: Schema.optionalKey(
		Schema.NullOr(Schema.String.check(Schema.isMaxLength(200))),
	),
	archived: Schema.optionalKey(Schema.Boolean),
})
export const AutomationLinkPatch = Schema.Struct({
	chatId: Schema.NullOr(Id),
	expectedChatId: Schema.NullOr(Id),
})
export type AutomationLinkPatch = typeof AutomationLinkPatch.Type
export const AutomationLink = Schema.Struct({
	triggerId: Id,
	chatId: Schema.NullOr(Id),
	metadata: Schema.Array(ChatMetadata),
})
export type AutomationLink = typeof AutomationLink.Type
export const Bootstrap = Schema.Struct({
	identity: Identity,
	access: Schema.optionalKey(Access),
	defaultBotId: Schema.NullOr(Id),
	features: Features,
	companions: Schema.Array(Companion),
	conversations: Schema.Array(ConversationSummary),
	metadata: Schema.optionalKey(Schema.Array(ChatMetadata)),
})
export type Bootstrap = typeof Bootstrap.Type
export const DefaultBotStatus = Schema.Struct({
	phase: Schema.Literals(["uninitialized", "ready", "outcome_unknown"]),
	botId: Schema.NullOr(Id),
})
export type DefaultBotStatus = typeof DefaultBotStatus.Type
export const RequestId = Schema.String.check(
	Schema.isPattern(/^[A-Za-z0-9_-]{1,96}$/),
)
export const MembershipPlanId = Schema.Literals(["precious", "flawless"])
export type MembershipPlanId = typeof MembershipPlanId.Type
export const MembershipPlan = Schema.Struct({
	id: MembershipPlanId,
	name: Schema.String,
	monthlyPriceCents: Schema.Natural,
	currency: Schema.Literal("USD"),
	purchasable: Schema.Literal(false),
})
export type MembershipPlan = typeof MembershipPlan.Type
export const Subscription = Schema.Struct({
	planId: MembershipPlanId,
	status: Schema.Literals(["active", "expired"]),
	startsAt: Schema.Finite,
	expiresAt: Schema.Finite,
	revision: Revision,
})
export type Subscription = typeof Subscription.Type
export const ContainerEntitlement = Schema.Struct({
	allowed: Schema.Boolean,
	reason: Schema.NullOr(
		Schema.Literals(["subscription_required", "subscription_expired"]),
	),
})
export const Membership = Schema.Struct({
	plans: Schema.Array(MembershipPlan),
	canManageCodes: Schema.Boolean,
	purchaseAvailable: Schema.Literal(false),
	subscription: Schema.NullOr(Subscription),
	container: ContainerEntitlement,
})
export type Membership = typeof Membership.Type
export const MembershipMonths = Schema.Int.check(
	Schema.isBetween({ minimum: 1, maximum: 12 }),
)
export const CreateMembershipCode = Schema.Struct({
	requestId: RequestId,
	planId: MembershipPlanId,
	months: Schema.optionalKey(MembershipMonths),
})
export type CreateMembershipCode = typeof CreateMembershipCode.Type
export const RedeemMembership = Schema.Struct({
	requestId: RequestId,
	code: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
})
export type RedeemMembership = typeof RedeemMembership.Type
/** Code metadata never contains its secret or a reusable credential. */
export const MembershipCode = Schema.Struct({
	id: Id,
	requestId: RequestId,
	planId: MembershipPlanId,
	months: MembershipMonths,
	accountId: Schema.NullOr(Id),
	redeemedBy: Schema.NullOr(Schema.Struct({ displayName: Schema.String })),
	createdAt: Schema.Finite,
	createdBy: Id,
	status: Schema.Literals(["available", "redeemed", "revoked"]),
	redeemedAt: Schema.NullOr(Schema.Finite),
	revokedAt: Schema.NullOr(Schema.Finite),
})
export type MembershipCode = typeof MembershipCode.Type
export const MembershipCodePage = Schema.Struct({
	items: Schema.Array(MembershipCode),
	next: Schema.NullOr(Schema.String),
})
export type MembershipCodePage = typeof MembershipCodePage.Type
export const CreatedMembershipCode = Schema.Struct({
	code: Schema.NullOr(Schema.String),
	record: MembershipCode,
})
export type CreatedMembershipCode = typeof CreatedMembershipCode.Type
export const MembershipRedemption = Schema.Struct({
	requestId: RequestId,
	codeId: Id,
	planId: MembershipPlanId,
	startsAt: Schema.Finite,
	expiresAt: Schema.Finite,
	redeemedAt: Schema.Finite,
	membership: Membership,
})
export type MembershipRedemption = typeof MembershipRedemption.Type

export const BasicComputeCommand = Schema.Struct({ requestId: RequestId })
export type BasicComputeCommand = typeof BasicComputeCommand.Type
export const BasicComputeOperation = Schema.Struct({
	requestId: RequestId,
	action: Schema.Literals(["provision", "repair", "release"]),
	phase: Schema.Literals([
		"pending",
		"creating",
		"granting",
		"issuing_token",
		"ready",
		"needs_repair",
		"failed",
	]),
	computerId: Schema.NullOr(Id),
	message: Schema.NullOr(Schema.String),
})
export type BasicComputeOperation = typeof BasicComputeOperation.Type
export const BasicCompute = Schema.Struct({
	enabled: Schema.Boolean,
	automatic: Schema.optionalKey(Schema.Boolean),
	idleSeconds: Schema.optionalKey(Schema.Natural),
	entitled: Schema.Boolean,
	reason: Schema.NullOr(
		Schema.Literals(["subscription_required", "subscription_expired"]),
	),
	computerId: Schema.NullOr(Id),
	state: Schema.Literals([
		"disabled",
		"not_provisioned",
		"provisioning",
		"needs_repair",
		"connecting",
		"ready",
	]),
	lease: Schema.Struct({
		state: Schema.Literals(["idle", "active", "busy"]),
		activity: Schema.optionalKey(
			Schema.Literals(["working", "idle", "unknown"]),
		),
		expiresAt: Schema.NullOr(Schema.Int),
	}),
	operation: Schema.NullOr(BasicComputeOperation),
	limits: Schema.Struct({
		cpu: Schema.Literal(0.5),
		memoryMiB: Schema.Literal(512),
		workspaceMiB: Schema.Literal(64),
		commandSeconds: Schema.Natural,
		outputKiB: Schema.Literal(64),
		network: Schema.Boolean,
		tty: Schema.Literal(false),
		desktop: Schema.Literal(false),
		ports: Schema.Literal(false),
	}),
})
export type BasicCompute = typeof BasicCompute.Type
export const Reminder = Schema.Struct({
	id: Id,
	chatId: Id,
	turnId: Id,
	executionId: Schema.NullOr(Id),
	note: Schema.String,
	dueAt: Schema.Finite,
	status: Schema.Literals(["waiting", "done", "cancelled"]),
})
export type Reminder = typeof Reminder.Type
export const ReminderPage = Schema.Struct({
	items: Schema.Array(Reminder),
	next: Schema.NullOr(Id),
})
export type ReminderPage = typeof ReminderPage.Type
export const CreateConversation = Schema.Struct({
	botId: Id,
	requestId: RequestId,
	memory: Schema.optionalKey(Memory),
})
export const AttachFile = Schema.Struct({
	fileId: Id,
	requestId: RequestId,
	expected: Revision,
})
export type AttachFile = typeof AttachFile.Type
/** Stable saved-item receipt for the native attachment command. */
export const attachmentItemId = (requestId: string): string =>
	"attachment_" + Schema.decodeSync(RequestId)(requestId)
export const ForkConversation = Schema.Struct({
	expected: Revision,
	requestId: RequestId,
	through: Schema.optionalKey(
		Schema.Struct({ turnId: Id, edge: Schema.Literals(["before", "after"]) }),
	),
	reason: Schema.Literals(["fork", "regenerate"]),
})
export const UpdateConversation = Schema.Struct({
	expected: Revision,
	memory: Schema.optionalKey(Memory),
	mode: Schema.optionalKey(Schema.Literals(["build", "plan"])),
})
export const InputPart = Schema.Union([
	Schema.Struct({ type: Schema.Literal("text"), text: Schema.NonEmptyString }),
	Schema.Struct({ type: Schema.Literals(["image", "file"]), fileId: Id }),
])
export const SendMessage = Schema.Struct({
	commandKey: Schema.optionalKey(RequestId),
	input: Schema.Union([
		Schema.NonEmptyString,
		Schema.Array(InputPart).check(Schema.isMinLength(1)),
	]),
	stream: Schema.optionalKey(Schema.Boolean),
	memory: Schema.optionalKey(Memory),
})
export type SendMessage = typeof SendMessage.Type
export const MessageReceipt = Schema.Struct({
	delivery: Schema.Literals(["started", "steered", "queued", "accepted"]),
	chatId: Id,
	itemId: Schema.NullOr(Id),
	turnId: Schema.NullOr(Id),
	executionId: Schema.optionalKey(Id),
	commandKey: Schema.optionalKey(RequestId),
	inputItems: Schema.optionalKey(Schema.Array(Id)),
})
export type MessageReceipt = typeof MessageReceipt.Type
/** Non-text parts remain inspectable without making the Web decode a provider schema. */
export const MessagePart = Schema.Struct({
	type: Schema.String,
	text: Schema.optionalKey(Schema.String),
	details: Schema.optionalKey(Schema.JsonObject),
})
export const Message = Schema.Struct({
	id: Id,
	sourceItemId: Id,
	sequence: Schema.Natural,
	turnId: Schema.NullOr(Id),
	role: Schema.String,
	parts: Schema.Array(MessagePart),
})
export const MessagePage = Schema.Struct({
	items: Schema.Array(Message),
	next: Schema.NullOr(Schema.Natural),
})
export const Turn = Schema.Struct({
	id: Id,
	chatId: Id,
	status: ChatStatus,
	startedAt: Schema.Finite,
	completedAt: Schema.NullOr(Schema.Finite),
	inputItemIds: Schema.Array(Id),
	itemIds: Schema.Array(Id),
})
export const TurnPage = Schema.Struct({
	items: Schema.Array(Turn),
	next: Schema.NullOr(Id),
})
export const ErrorCode = Schema.Literals([
	"membership_invalid_code",
	"membership_code_used",
	"membership_code_revoked",
	"membership_plan_conflict",
	"membership_required",
	"membership_expired",
	"basic_compute_unavailable",
	"basic_compute_busy",
	"basic_compute_repair_required",
	"unauthorized",
	"forbidden",
	"not_found",
	"invalid_input",
	"conflict",
	"unavailable",
	"outcome_unknown",
])
export const ProductError = Schema.Struct({
	code: ErrorCode,
	message: Schema.String,
	requestId: Schema.optionalKey(Schema.String),
})
export type ProductError = typeof ProductError.Type

/** A durable command can be read independently of its HTTP connection. */
export const Execution = Schema.Struct({
	id: Id,
	forwardedTo: Schema.optionalKey(Id),
	resource: Schema.Struct({ kind: Schema.String, id: Id }),
	status: Schema.Literals([
		"queued",
		"running",
		"waiting",
		"cancelling",
		"completed",
		"failed",
		"cancelled",
		"interrupted",
		"outcome_unknown",
	]),
	sequence: Schema.Natural,
	createdAt: Schema.Finite,
	updatedAt: Schema.Finite,
	failure: Schema.NullOr(
		Schema.Struct({ errorId: Id, category: Schema.String }),
	),
})
export type Execution = typeof Execution.Type
export const ExecutionReceipt = Schema.Struct({
	executionId: Id,
	commandKey: RequestId,
	sequence: Schema.Natural,
	inputItems: Schema.optionalKey(Schema.Array(Id)),
})
export type ExecutionReceipt = typeof ExecutionReceipt.Type
export const FeatureResult = Schema.Struct({
	pending: Schema.Boolean,
	result: Schema.optionalKey(Schema.Json),
	execution: Execution,
})

/** Execution identifiers allow observation of the same durable command after reconnect. */
export const ChatEvent = Schema.Struct({
	type: Schema.String,
	chatId: Id,
	turnId: Schema.NullOr(Id),
	executionId: Schema.optionalKey(Id),
	commandKey: Schema.optionalKey(RequestId),
	inputItems: Schema.optionalKey(Schema.Array(Id)),
	executionSequence: Schema.optionalKey(Schema.Natural),
	sequence: Schema.Natural,
	itemId: Schema.optionalKey(Id),
	delta: Schema.optionalKey(Schema.String),
	text: Schema.optionalKey(Schema.String),
	status: Schema.optionalKey(Schema.String),
	toolActivity: Schema.optionalKey(ToolActivity),
})
export type ChatEvent = typeof ChatEvent.Type

/** Versioned descriptions of admitted product operations; schemas are self-contained. */
export const FeatureOperation = Schema.Struct({
	id: Id,
	group: Id,
	title: Schema.String,
	description: Schema.String,
	method: Schema.Literals(["GET", "POST", "PUT", "PATCH", "DELETE"]),
	params: Schema.NullOr(Schema.JsonObject),
	query: Schema.NullOr(Schema.JsonObject),
	payload: Schema.NullOr(Schema.JsonObject),
	response: Schema.NullOr(Schema.JsonObject),
	resultMode: Schema.optionalKey(Schema.Literal("execution")),
	transport: Schema.Literals([
		"json",
		"binary",
		"sse",
		"websocket",
		"multipart",
	]),
})
export type FeatureOperation = typeof FeatureOperation.Type
export const FeatureInput = Schema.Struct({
	params: Schema.optionalKey(Schema.JsonObject),
	query: Schema.optionalKey(Schema.JsonObject),
	payload: Schema.optionalKey(Schema.Json),
})
export type FeatureInput = typeof FeatureInput.Type

export const ConversationOperation = Schema.Struct({
	requestId: RequestId,
	phase: Schema.Literals([
		"Prepared",
		"Sending",
		"Applied",
		"Completed",
		"OutcomeUnknown",
	]),
	chatId: Schema.NullOr(Id),
})

/** A navigation target on this origin; authentication and API routes are not pages. */
export const ReturnTo = Schema.String.check(
	Schema.isMaxLength(4096),
	Schema.makeFilter((value) => {
		if (
			!value.startsWith("/") ||
			value.startsWith("//") ||
			/[\\\r\n]/.test(value)
		)
			return false
		try {
			const url = new URL(value, "https://return.invalid")
			return (
				url.origin === "https://return.invalid" &&
				!/^\/(?:auth|api|v1|internal|development)(?:\/|$)/.test(url.pathname)
			)
		} catch {
			return false
		}
	}),
)
