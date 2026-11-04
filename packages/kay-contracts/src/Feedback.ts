import { Schema } from "effect"

const text = (max: number) =>
	Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max))
export const FeedbackStatus = Schema.Literals(["open", "triaged", "resolved"])
export const FeedbackInput = Schema.Struct({
	reportId: Schema.String.check(Schema.isUUID()),
	title: text(160),
	summary: text(2000),
	expected: text(2000),
	actual: text(2000),
	steps: Schema.optionalKey(
		Schema.Array(text(400)).check(Schema.isMaxLength(10)),
	),
	severity: Schema.Literals(["minor", "major", "blocking"]),
	errorId: Schema.optionalKey(text(128)),
})
export type FeedbackInput = typeof FeedbackInput.Type
export const FeedbackReport = Schema.Struct({
	id: Schema.String,
	reportId: Schema.String,
	accountId: Schema.String,
	organizationId: Schema.String,
	botId: Schema.String,
	source: Schema.Literal("conversation_unknown"),
	content: FeedbackInput,
	status: FeedbackStatus,
	revision: Schema.Natural,
	createdAt: Schema.Finite,
	updatedAt: Schema.Finite,
	updatedBy: Schema.NullOr(Schema.String),
})
export type FeedbackReport = typeof FeedbackReport.Type
export const FeedbackPage = Schema.Struct({
	items: Schema.Array(FeedbackReport),
	next: Schema.NullOr(Schema.String),
})
export type FeedbackPage = typeof FeedbackPage.Type
export const FeedbackUpdate = Schema.Struct({
	expected: Schema.Natural,
	status: FeedbackStatus,
})
export type FeedbackUpdate = typeof FeedbackUpdate.Type
export const FeedbackReceipt = Schema.Struct({
	id: Schema.String,
	status: FeedbackStatus,
})
export type FeedbackReceipt = typeof FeedbackReceipt.Type
