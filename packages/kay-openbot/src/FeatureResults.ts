import * as Api from "@openbot-build/client/Api"
import type { Client, ClientError } from "@openbot-build/client"
import { Data, Effect, Schema, Stream } from "effect"
import type { HttpClientResponse } from "effect/http"
import { dispatchFeature } from "./FeatureDispatch.ts"
import { readExecutionEvents } from "./ExecutionEvents.ts"

class ReadFailed extends Data.TaggedError("FeatureResultReadFailed")<{
	readonly response: HttpClientResponse.HttpClientResponse
}> {}

/** Only native, authorized reads resolve a command. No input or credential is saved here. */
export const readFeatureResult = (input: {
	readonly api: typeof Client.Service.api
	readonly operation: string
	readonly executionId: string
}): Effect.Effect<Response, ClientError | Schema.SchemaError> =>
	Effect.gen(function* () {
		const { api, operation } = input
		const executionId = yield* Schema.decodeEffect(
			Api.ExecutionsApi.Execution.Id,
		)(input.executionId)
		const executionResponse = yield* api.executions.get({
			params: { executionId },
			responseMode: "response-only",
		})
		if (executionResponse.status !== 200)
			return new Response(Stream.toReadableStream(executionResponse.stream), {
				status: executionResponse.status,
				headers: executionResponse.headers,
			})
		const execution = yield* Schema.decodeUnknownEffect(
			Api.ExecutionsApi.Execution.Record,
		)(yield* executionResponse.json)
		const read = (id: string, params: Record<string, string>) =>
			Effect.gen(function* () {
				const response = yield* dispatchFeature({
					api,
					id,
					input: { params },
				}).pipe(
					Effect.catchTag("UnsupportedOperation", () =>
						Effect.die("Unknown feature result reader."),
					),
				)
				if (response.status < 200 || response.status >= 300)
					return yield* new ReadFailed({ response })
				return yield* response.json
			})
		const result = (value: unknown) =>
			Response.json({ pending: false, result: value, execution })
		const pending = () => Response.json({ pending: true, execution })
		const invalid = () =>
			Response.json(
				{
					code: "invalid_input",
					message: "This execution does not belong to the requested action.",
				},
				{ status: 400 },
			)
		const object = Schema.decodeUnknownEffect(Schema.JsonObject)
		const resource = execution.resource
		// Saving an approval and completing the approved tool are separate operations.
		if (operation === "requests.resolveRequest") {
			if (resource.kind !== "Request") return invalid()
			const request = yield* object(
				yield* read("requests.getRequest", { requestId: resource.id }),
			)
			const status = yield* Schema.decodeUnknownEffect(
				Api.RequestsApi.RequestStatus,
			)(request["status"])
			if (status !== "pending") return result(request)
		}
		if (
			execution.status === "outcome_unknown" ||
			execution.status === "failed" ||
			execution.status === "interrupted"
		)
			return Response.json(
				{
					code:
						execution.status === "outcome_unknown"
							? "outcome_unknown"
							: "unavailable",
					message:
						"The saved operation needs attention. Its command was not sent again.",
					executionId,
					execution,
				},
				{ status: 409 },
			)
		if (execution.status === "waiting") {
			// A saved decision wakes the workflow asynchronously. Do not ask again while
			// that answer is being consumed, nor claim the business change has completed.
			const events = yield* readExecutionEvents({
				api,
				execution,
				keep: (event) =>
					event.body._tag === "DecisionMade" ||
					event.body._tag === "DecisionNeeded",
			})
			if ("response" in events) return events.response
			const answered = events.events
				.filter((event) => event.body._tag === "DecisionMade")
				.at(-1)
			const asked = events.events
				.filter((event) => event.body._tag === "DecisionNeeded")
				.at(-1)
			if (
				answered !== undefined &&
				(asked === undefined || answered.sequence > asked.sequence)
			)
				return pending()
			return Response.json(
				{
					code: "conflict",
					message:
						"This operation is waiting for approval or input. Open its pending request to continue.",
					executionId,
					execution,
				},
				{ status: 409 },
			)
		}
		const cancelled = execution.status === "cancelled"
		if (
			cancelled &&
			![
				"developer.cancelTest",
				"delegations.cancelDelegation",
				"reminders.cancelReminder",
				"chats.interruptChat",
				"executions.cancel",
			].includes(operation)
		)
			return Response.json(
				{
					code: "unavailable",
					message: "The saved operation was cancelled.",
					executionId,
					execution,
				},
				{ status: 409 },
			)
		if (execution.status !== "completed" && !cancelled) return pending()
		const connection = () =>
			read("connections.getConnection", { connectionId: resource.id })
		if (
			[
				"connections.updateManualConnection",
				"connections.verifyConnection",
				"connections.revalidateConnection",
				"connections.updateConnection",
			].includes(operation)
		) {
			if (resource.kind !== "AppConnection") return invalid()
			const saved = yield* object(
				yield* read("connections.getConnectionExecution", {
					connectionId: resource.id,
					executionId,
				}),
			)
			if (saved["result"] === null) return pending()
			if (operation === "connections.verifyConnection") {
				const verified = yield* object(saved["result"])
				return verified["_tag"] === "Verified"
					? result({ _tag: "Verified", capabilities: verified["capabilities"] })
					: result({ _tag: "Unavailable", connection: yield* connection() })
			}
			return result(yield* connection())
		}
		if (
			[
				"appAuthorization.beginAppAuthorization",
				"appAuthorization.completeAppAuthorization",
				"appAuthorization.revokeAppAuthorization",
				"connections.refreshConnectionAuthorization",
				"connections.deleteConnection",
			].includes(operation)
		) {
			if (resource.kind !== "AppAuthorization") return invalid()
			const saved = yield* object(
				yield* read("appAuthorization.getAppAuthorizationAction", {
					executionId,
				}),
			)
			if (saved["result"] === null) return pending()
			const action = yield* object(saved["result"])
			if (operation === "connections.deleteConnection") return result(null)
			if (operation === "appAuthorization.completeAppAuthorization") {
				if (typeof action["flowId"] !== "string") return invalid()
				return result(
					yield* read("appAuthorization.getAppAuthorization", {
						flowId: action["flowId"],
					}),
				)
			}
			if (operation === "connections.refreshConnectionAuthorization") {
				if (typeof action["connectionId"] !== "string") return invalid()
				return result(
					yield* read("connections.getConnection", {
						connectionId: action["connectionId"],
					}),
				)
			}
			if (
				operation === "appAuthorization.beginAppAuthorization" &&
				typeof action["flowId"] === "string"
			) {
				const state = yield* object(
					yield* read("appAuthorization.getAppAuthorization", {
						flowId: action["flowId"],
					}),
				)
				return result({ ...action, returnTo: state["returnTo"] })
			}
			return result(action)
		}
		if (
			[
				"computers.createComputer",
				"computers.pauseComputer",
				"computers.resumeComputer",
				"computers.deleteComputer",
			].includes(operation)
		) {
			if (resource.kind !== "Computer") return invalid()
			return operation === "computers.deleteComputer"
				? result(null)
				: result(
						yield* read("computers.getComputer", { computerId: resource.id }),
					)
		}
		if (
			[
				"developer.runTest",
				"developer.cancelTest",
				"developer.cleanupTest",
				"developer.deleteTest",
				"developer.authorizeTest",
				"developer.completeTestAuthorization",
			].includes(operation)
		) {
			if (
				resource.kind !== "DeveloperTest" &&
				resource.kind !== "DeveloperTestCleanup"
			)
				return invalid()
			if (operation === "developer.deleteTest") return result(null)
			return result(yield* read("developer.test", { id: resource.id }))
		}
		if (
			operation === "developer.verifyClaim" ||
			operation === "developer.verifyProof"
		) {
			if (resource.kind !== "DeveloperProof") return invalid()
			return result(yield* read("developer.getProof", { id: resource.id }))
		}
		if (operation === "appExperience.reset") {
			if (resource.kind !== "AppReset") return invalid()
			return result(yield* read("appExperience.getReset", { executionId }))
		}
		if (operation === "appOperations.respond") {
			if (resource.kind !== "AppCall") return invalid()
			return result(yield* read("appOperations.get", { id: resource.id }))
		}
		if (operation === "reminders.cancelReminder") {
			if (resource.kind !== "Reminder") return invalid()
			return result(
				yield* read("reminders.getReminder", { reminderId: resource.id }),
			)
		}
		if (operation === "delegations.cancelDelegation") {
			if (resource.kind !== "Delegation") return invalid()
			return result(
				yield* read("delegations.getDelegation", { delegationId: resource.id }),
			)
		}
		if (
			operation === "channels.deleteChannel" &&
			resource.kind === "ChannelRemoval"
		)
			return result(null)
		if (
			(operation === "chats.deleteChat" ||
				operation === "chats.interruptChat") &&
			resource.kind === "ChatControl"
		)
			return result(null)
		if (operation === "executions.cancel" || operation === "executions.decide")
			return result(execution)
		return invalid()
	}).pipe(
		Effect.catchTags({
			FeatureResultReadFailed: ({ response }) =>
				Effect.succeed(
					new Response(Stream.toReadableStream(response.stream), {
						status: response.status,
						headers: response.headers,
					}),
				),
			SchemaError: () =>
				Effect.succeed(
					Response.json(
						{
							code: "unavailable",
							message: "The saved result could not be read.",
						},
						{ status: 503 },
					),
				),
		}),
	)
