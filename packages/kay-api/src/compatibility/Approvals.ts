import { Session } from "@kaicom/e-core"
import { SessionView } from "@kaicom/e-platform-api"
import { Schema } from "effect"
import * as Projection from "./Projection.ts"

// Requests are owned and decided by OpenBot. This only projects the existing UI contract.
const Request = Schema.Struct({
	id: Schema.NonEmptyString,
	session: Schema.String,
	turn: Schema.String,
	toolCallId: Schema.String,
	callOccurrence: Schema.Natural,
	status: Schema.Literals([
		"pending",
		"allowed",
		"denied",
		"expired",
		"cancelled",
	]),
	revision: Schema.Natural,
	app: Schema.optionalKey(Schema.JsonObject),
})
export const request = (value: unknown) =>
	Schema.decodeUnknownSync(Request)(value)
export const decision = (value: unknown) =>
	Schema.decodeUnknownSync(
		Schema.Struct({
			expected: Session.Revision,
			approved: Schema.Boolean,
			grantReads: Schema.optionalKey(Schema.Boolean),
			reason: Schema.optionalKey(Schema.String),
		}),
	)(value)
// The two inputs are different upstream resources, not a transform pipeline.
// @effect-diagnostics-next-line missingPipeableSignature:off
export const list = (
	view: Projection.Json,
	value: Projection.Json,
): Projection.Json => {
	const current = Schema.decodeUnknownSync(SessionView)(
		Projection.sessionView(view),
	)
	const turn = Session.currentTurn(current.session)
	if (turn === undefined) return []
	const pending = Session.pendingApprovals(current)
	return Schema.decodeUnknownSync(Schema.Array(Request))(value).flatMap(
		(row) => {
			if (
				row.status !== "pending" ||
				row.session !== current.session.id ||
				row.turn !== turn.id
			)
				return []
			const wait = pending.find(
				(wait) =>
					wait.toolCallId === row.toolCallId &&
					wait.occurrence === row.callOccurrence,
			)
			if (wait === undefined) return []
			return [
				{
					turn: row.turn,
					approvalId: row.id,
					toolCallId: row.toolCallId,
					toolName: wait.toolCall.name,
					arguments: Schema.decodeUnknownSync(Schema.JsonObject)(
						wait.toolCall.params,
					),
					...(row.app === undefined
						? {}
						: {
								app: Projection.response({
									path: "/v1/app-operations/approval",
									value: row.app,
								}),
							}),
				},
			]
		},
	)
}
