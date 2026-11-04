// Generated from the pinned native API by scripts/generate-features.mjs.
import * as Api from "@openbot-build/client/Api"
import { commandPayload } from "./Commands.ts"
import type { Client, ClientError } from "@openbot-build/client"
import { Effect, Schema, SchemaAST } from "effect"
import type { HttpApiEndpoint } from "effect/http-api"
import type { HttpClientResponse } from "effect/http"

const decodeSlot = <
	E extends HttpApiEndpoint.ConstraintRequest &
		Pick<HttpApiEndpoint.Top, "params" | "query" | "payload">,
	S extends "params" | "query",
>(
	endpoint: E,
	slot: S,
	input: unknown,
) =>
	Schema.decodeUnknownEffect(
		Schema.toType(
			Schema.make<E[S extends "params" ? "~Params" : "~Query"]>(
				endpoint[slot]!.ast,
			),
		),
	)(input, { onExcessProperty: "error" })
const decodePayload = <
	E extends HttpApiEndpoint.ConstraintRequest &
		Pick<HttpApiEndpoint.Top, "params" | "query" | "payload">,
>(
	endpoint: E,
	input: unknown,
) => {
	const payload = endpoint.payload.get("application/json")
	if (payload === undefined || payload.encoding._tag === "Stream")
		throw new Error("Expected a JSON payload schema.")
	return Schema.decodeUnknownEffect(
		Schema.make<E["~Payload"]>(
			payload.schemas.length === 1
				? payload.schemas[0].ast
				: new SchemaAST.Union(payload.schemas.map((schema) => schema.ast)),
		),
	)(input, { onExcessProperty: "error" })
}
const formData = (input: unknown) =>
	Schema.decodeUnknownEffect(Schema.instanceOf(FormData))(input)

class UnsupportedOperation extends Schema.TaggedError<UnsupportedOperation>()(
	"UnsupportedOperation",
	{ id: Schema.String },
) {}
export const dispatchFeature = ({
	api,
	id,
	input,
}: {
	readonly api: typeof Client.Service.api
	readonly id: string
	readonly input: {
		readonly params?: unknown
		readonly query?: unknown
		readonly payload?: unknown
	}
}): Effect.Effect<
	HttpClientResponse.HttpClientResponse,
	ClientError | UnsupportedOperation
> =>
	Effect.gen(function* () {
		switch (id) {
			case "developer.personalReports":
				return yield* api.developer.personalReports({
					responseMode: "response-only",
					query: yield* decodeSlot(
						Api.OpenBotApi.groups.developer.endpoints.personalReports,
						"query",
						input.query ?? {},
					),
				})
			case "developer.notifications":
				return yield* api.developer.notifications({
					responseMode: "response-only",
					query: yield* decodeSlot(
						Api.OpenBotApi.groups.developer.endpoints.notifications,
						"query",
						input.query ?? {},
					),
				})
			case "developer.readNotification":
				return yield* api.developer.readNotification({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.developer.endpoints.readNotification,
						"params",
						input.params ?? {},
					),
				})
			case "developer.subscriptions":
				return yield* api.developer.subscriptions({
					responseMode: "response-only",
				})
			case "developer.subscribe":
				return yield* api.developer.subscribe({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.developer.endpoints.subscribe,
						input.payload,
					),
				})
			case "developer.requestIndexing":
				return yield* api.developer.requestIndexing({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.developer.endpoints.requestIndexing,
						commandPayload(input.payload),
					),
				})
			case "developer.indexingRequests":
				return yield* api.developer.indexingRequests({
					responseMode: "response-only",
					query: yield* decodeSlot(
						Api.OpenBotApi.groups.developer.endpoints.indexingRequests,
						"query",
						input.query ?? {},
					),
				})
			case "developer.indexingRequest":
				return yield* api.developer.indexingRequest({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.developer.endpoints.indexingRequest,
						"params",
						input.params ?? {},
					),
				})
			case "developer.createTest":
				return yield* api.developer.createTest({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.developer.endpoints.createTest,
						input.payload,
					),
				})
			case "developer.tests":
				return yield* api.developer.tests({ responseMode: "response-only" })
			case "developer.test":
				return yield* api.developer.test({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.developer.endpoints.test,
						"params",
						input.params ?? {},
					),
				})
			case "developer.configureTest":
				return yield* api.developer.configureTest({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.developer.endpoints.configureTest,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.developer.endpoints.configureTest,
						input.payload,
					),
				})
			case "developer.runTest":
				return yield* api.developer.runTest({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.developer.endpoints.runTest,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.developer.endpoints.runTest,
						commandPayload(input.payload),
					),
				})
			case "developer.cancelTest":
				return yield* api.developer.cancelTest({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.developer.endpoints.cancelTest,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.developer.endpoints.cancelTest,
						commandPayload(input.payload),
					),
				})
			case "developer.cleanupTest":
				return yield* api.developer.cleanupTest({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.developer.endpoints.cleanupTest,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.developer.endpoints.cleanupTest,
						commandPayload(input.payload),
					),
				})
			case "developer.deleteTest":
				return yield* api.developer.deleteTest({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.developer.endpoints.deleteTest,
						"params",
						input.params ?? {},
					),
					query: yield* decodeSlot(
						Api.OpenBotApi.groups.developer.endpoints.deleteTest,
						"query",
						commandPayload(input.query),
					),
				})
			case "developer.authorizeTest":
				return yield* api.developer.authorizeTest({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.developer.endpoints.authorizeTest,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.developer.endpoints.authorizeTest,
						commandPayload(input.payload),
					),
				})
			case "developer.completeTestAuthorization":
				return yield* api.developer.completeTestAuthorization({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.developer.endpoints.completeTestAuthorization,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.developer.endpoints.completeTestAuthorization,
						commandPayload(input.payload),
					),
				})
			case "developer.overview":
				return yield* api.developer.overview({ responseMode: "response-only" })
			case "developer.startClaim":
				return yield* api.developer.startClaim({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.developer.endpoints.startClaim,
						input.payload,
					),
				})
			case "developer.getClaim":
				return yield* api.developer.getClaim({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.developer.endpoints.getClaim,
						"params",
						input.params ?? {},
					),
				})
			case "developer.verifyClaim":
				return yield* api.developer.verifyClaim({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.developer.endpoints.verifyClaim,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.developer.endpoints.verifyClaim,
						commandPayload(input.payload),
					),
				})
			case "developer.revokeClaim":
				return yield* api.developer.revokeClaim({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.developer.endpoints.revokeClaim,
						"params",
						input.params ?? {},
					),
				})
			case "developer.getProof":
				return yield* api.developer.getProof({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.developer.endpoints.getProof,
						"params",
						input.params ?? {},
					),
				})
			case "developer.verifyProof":
				return yield* api.developer.verifyProof({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.developer.endpoints.verifyProof,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.developer.endpoints.verifyProof,
						commandPayload(input.payload),
					),
				})
			case "developer.relinquish":
				return yield* api.developer.relinquish({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.developer.endpoints.relinquish,
						"params",
						input.params ?? {},
					),
				})
			case "developer.members":
				return yield* api.developer.members({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.developer.endpoints.members,
						"params",
						input.params ?? {},
					),
				})
			case "developer.invite":
				return yield* api.developer.invite({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.developer.endpoints.invite,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.developer.endpoints.invite,
						input.payload,
					),
				})
			case "developer.invitation":
				return yield* api.developer.invitation({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.developer.endpoints.invitation,
						"params",
						input.params ?? {},
					),
				})
			case "developer.acceptInvitation":
				return yield* api.developer.acceptInvitation({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.developer.endpoints.acceptInvitation,
						"params",
						input.params ?? {},
					),
				})
			case "developer.revokeInvitation":
				return yield* api.developer.revokeInvitation({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.developer.endpoints.revokeInvitation,
						"params",
						input.params ?? {},
					),
				})
			case "developer.changeMember":
				return yield* api.developer.changeMember({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.developer.endpoints.changeMember,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.developer.endpoints.changeMember,
						input.payload,
					),
				})
			case "developer.removeMember":
				return yield* api.developer.removeMember({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.developer.endpoints.removeMember,
						"params",
						input.params ?? {},
					),
				})
			case "developer.saveInspection":
				return yield* api.developer.saveInspection({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.developer.endpoints.saveInspection,
						input.payload,
					),
				})
			case "developer.reports":
				return yield* api.developer.reports({
					responseMode: "response-only",
					query: yield* decodeSlot(
						Api.OpenBotApi.groups.developer.endpoints.reports,
						"query",
						input.query ?? {},
					),
				})
			case "developer.report":
				return yield* api.developer.report({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.developer.endpoints.report,
						"params",
						input.params ?? {},
					),
				})
			case "developer.compare":
				return yield* api.developer.compare({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.developer.endpoints.compare,
						"params",
						input.params ?? {},
					),
					query: yield* decodeSlot(
						Api.OpenBotApi.groups.developer.endpoints.compare,
						"query",
						input.query ?? {},
					),
				})
			case "developer.deleteReport":
				return yield* api.developer.deleteReport({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.developer.endpoints.deleteReport,
						"params",
						input.params ?? {},
					),
				})
			case "appIndex.listSources":
				return yield* api.appIndex.listSources({
					responseMode: "response-only",
				})
			case "appIndex.searchApps":
				return yield* api.appIndex.searchApps({
					responseMode: "response-only",
					query: yield* decodeSlot(
						Api.OpenBotApi.groups.appIndex.endpoints.searchApps,
						"query",
						input.query ?? {},
					),
				})
			case "appIndex.getApp":
				return yield* api.appIndex.getApp({
					responseMode: "response-only",
					query: yield* decodeSlot(
						Api.OpenBotApi.groups.appIndex.endpoints.getApp,
						"query",
						input.query ?? {},
					),
				})
			case "appAuthorization.getAppAuthorizationAction":
				return yield* api.appAuthorization.getAppAuthorizationAction({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.appAuthorization.endpoints
							.getAppAuthorizationAction,
						"params",
						input.params ?? {},
					),
				})
			case "appAuthorization.beginAppAuthorization":
				return yield* api.appAuthorization.beginAppAuthorization({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.appAuthorization.endpoints
							.beginAppAuthorization,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.appAuthorization.endpoints
							.beginAppAuthorization,
						commandPayload(input.payload),
					),
				})
			case "appAuthorization.getAppAuthorization":
				return yield* api.appAuthorization.getAppAuthorization({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.appAuthorization.endpoints
							.getAppAuthorization,
						"params",
						input.params ?? {},
					),
				})
			case "appAuthorization.completeAppAuthorization":
				return yield* api.appAuthorization.completeAppAuthorization({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.appAuthorization.endpoints
							.completeAppAuthorization,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.appAuthorization.endpoints
							.completeAppAuthorization,
						commandPayload(input.payload),
					),
				})
			case "appAuthorization.revokeAppAuthorization":
				return yield* api.appAuthorization.revokeAppAuthorization({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.appAuthorization.endpoints
							.revokeAppAuthorization,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.appAuthorization.endpoints
							.revokeAppAuthorization,
						commandPayload(input.payload),
					),
				})
			case "apps.discoverApp":
				return yield* api.apps.discoverApp({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.apps.endpoints.discoverApp,
						input.payload,
					),
				})
			case "chats.createConversation":
				return yield* api.chats.createConversation({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.chats.endpoints.createConversation,
						input.payload,
					),
				})
			case "chats.attachFile":
				return yield* api.chats.attachFile({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.chats.endpoints.attachFile,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.chats.endpoints.attachFile,
						input.payload,
					),
				})
			case "chats.forkChat":
				return yield* api.chats.forkChat({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.chats.endpoints.forkChat,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.chats.endpoints.forkChat,
						input.payload,
					),
				})
			case "chats.chatBranches":
				return yield* api.chats.chatBranches({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.chats.endpoints.chatBranches,
						"params",
						input.params ?? {},
					),
				})
			case "chats.sendBotMessage":
				return yield* api.chats.sendBotMessage({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.chats.endpoints.sendBotMessage,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.chats.endpoints.sendBotMessage,
						commandPayload(input.payload),
					),
				})
			case "chats.sendMessage":
				return yield* api.chats.sendMessage({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.chats.endpoints.sendMessage,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.chats.endpoints.sendMessage,
						commandPayload(input.payload),
					),
				})
			case "chats.listChats":
				return yield* api.chats.listChats({
					responseMode: "response-only",
					query: yield* decodeSlot(
						Api.OpenBotApi.groups.chats.endpoints.listChats,
						"query",
						input.query ?? {},
					),
				})
			case "chats.getChat":
				return yield* api.chats.getChat({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.chats.endpoints.getChat,
						"params",
						input.params ?? {},
					),
				})
			case "chats.updateChat":
				return yield* api.chats.updateChat({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.chats.endpoints.updateChat,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.chats.endpoints.updateChat,
						input.payload,
					),
				})
			case "chats.deleteChat":
				return yield* api.chats.deleteChat({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.chats.endpoints.deleteChat,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.chats.endpoints.deleteChat,
						commandPayload(input.payload),
					),
				})
			case "chats.chatModels":
				return yield* api.chats.chatModels({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.chats.endpoints.chatModels,
						"params",
						input.params ?? {},
					),
				})
			case "chats.chatItems":
				return yield* api.chats.chatItems({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.chats.endpoints.chatItems,
						"params",
						input.params ?? {},
					),
					query: yield* decodeSlot(
						Api.OpenBotApi.groups.chats.endpoints.chatItems,
						"query",
						input.query ?? {},
					),
				})
			case "chats.chatTurns":
				return yield* api.chats.chatTurns({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.chats.endpoints.chatTurns,
						"params",
						input.params ?? {},
					),
					query: yield* decodeSlot(
						Api.OpenBotApi.groups.chats.endpoints.chatTurns,
						"query",
						input.query ?? {},
					),
				})
			case "chats.getTurn":
				return yield* api.chats.getTurn({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.chats.endpoints.getTurn,
						"params",
						input.params ?? {},
					),
				})
			case "chats.turnItems":
				return yield* api.chats.turnItems({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.chats.endpoints.turnItems,
						"params",
						input.params ?? {},
					),
					query: yield* decodeSlot(
						Api.OpenBotApi.groups.chats.endpoints.turnItems,
						"query",
						input.query ?? {},
					),
				})
			case "chats.interruptChat":
				return yield* api.chats.interruptChat({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.chats.endpoints.interruptChat,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.chats.endpoints.interruptChat,
						commandPayload(input.payload),
					),
				})
			case "chats.chatTodos":
				return yield* api.chats.chatTodos({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.chats.endpoints.chatTodos,
						"params",
						input.params ?? {},
					),
				})
			case "chats.updateChatTodos":
				return yield* api.chats.updateChatTodos({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.chats.endpoints.updateChatTodos,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.chats.endpoints.updateChatTodos,
						input.payload,
					),
				})
			case "chats.chatDelegations":
				return yield* api.chats.chatDelegations({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.chats.endpoints.chatDelegations,
						"params",
						input.params ?? {},
					),
				})
			case "chats.chatConfessions":
				return yield* api.chats.chatConfessions({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.chats.endpoints.chatConfessions,
						"params",
						input.params ?? {},
					),
				})
			case "chats.chatEnrichments":
				return yield* api.chats.chatEnrichments({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.chats.endpoints.chatEnrichments,
						"params",
						input.params ?? {},
					),
				})
			case "toolCalls.list":
				return yield* api.toolCalls.list({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.toolCalls.endpoints.list,
						"params",
						input.params ?? {},
					),
				})
			case "toolCalls.get":
				return yield* api.toolCalls.get({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.toolCalls.endpoints.get,
						"params",
						input.params ?? {},
					),
				})
			case "executions.receipt":
				return yield* api.executions.receipt({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.executions.endpoints.receipt,
						"params",
						input.params ?? {},
					),
				})
			case "executions.get":
				return yield* api.executions.get({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.executions.endpoints.get,
						"params",
						input.params ?? {},
					),
				})
			case "executions.events":
				return yield* api.executions.events({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.executions.endpoints.events,
						"params",
						input.params ?? {},
					),
					query: yield* decodeSlot(
						Api.OpenBotApi.groups.executions.endpoints.events,
						"query",
						input.query ?? {},
					),
				})
			case "executions.observe":
				return yield* api.executions.observe({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.executions.endpoints.observe,
						"params",
						input.params ?? {},
					),
					query: yield* decodeSlot(
						Api.OpenBotApi.groups.executions.endpoints.observe,
						"query",
						input.query ?? {},
					),
				})
			case "executions.cancel":
				return yield* api.executions.cancel({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.executions.endpoints.cancel,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.executions.endpoints.cancel,
						commandPayload(input.payload),
					),
				})
			case "executions.decide":
				return yield* api.executions.decide({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.executions.endpoints.decide,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.executions.endpoints.decide,
						commandPayload(input.payload),
					),
				})
			case "live.createLiveChat":
				return yield* api.live.createLiveChat({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.live.endpoints.createLiveChat,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.live.endpoints.createLiveChat,
						input.payload,
					),
				})
			case "files.uploadFile":
				return yield* api.files.uploadFile({
					responseMode: "response-only",
					payload: yield* formData(input.payload),
				})
			case "files.createUpload":
				return yield* api.files.createUpload({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.files.endpoints.createUpload,
						input.payload,
					),
				})
			case "files.completeUpload":
				return yield* api.files.completeUpload({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.files.endpoints.completeUpload,
						"params",
						input.params ?? {},
					),
				})
			case "files.listFiles":
				return yield* api.files.listFiles({
					responseMode: "response-only",
					query: yield* decodeSlot(
						Api.OpenBotApi.groups.files.endpoints.listFiles,
						"query",
						input.query ?? {},
					),
				})
			case "files.getFile":
				return yield* api.files.getFile({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.files.endpoints.getFile,
						"params",
						input.params ?? {},
					),
				})
			case "files.getFileContent":
				return yield* api.files.getFileContent({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.files.endpoints.getFileContent,
						"params",
						input.params ?? {},
					),
				})
			case "files.deleteFile":
				return yield* api.files.deleteFile({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.files.endpoints.deleteFile,
						"params",
						input.params ?? {},
					),
				})
			case "delegations.getDelegation":
				return yield* api.delegations.getDelegation({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.delegations.endpoints.getDelegation,
						"params",
						input.params ?? {},
					),
				})
			case "delegations.cancelDelegation":
				return yield* api.delegations.cancelDelegation({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.delegations.endpoints.cancelDelegation,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.delegations.endpoints.cancelDelegation,
						commandPayload(input.payload),
					),
				})
			case "bots.listBots":
				return yield* api.bots.listBots({
					responseMode: "response-only",
					query: yield* decodeSlot(
						Api.OpenBotApi.groups.bots.endpoints.listBots,
						"query",
						input.query ?? {},
					),
				})
			case "bots.createBot":
				return yield* api.bots.createBot({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.bots.endpoints.createBot,
						input.payload,
					),
				})
			case "bots.getBot":
				return yield* api.bots.getBot({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.bots.endpoints.getBot,
						"params",
						input.params ?? {},
					),
				})
			case "bots.updateBot":
				return yield* api.bots.updateBot({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.bots.endpoints.updateBot,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.bots.endpoints.updateBot,
						input.payload,
					),
				})
			case "bots.botMemory":
				return yield* api.bots.botMemory({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.bots.endpoints.botMemory,
						"params",
						input.params ?? {},
					),
					query: yield* decodeSlot(
						Api.OpenBotApi.groups.bots.endpoints.botMemory,
						"query",
						input.query ?? {},
					),
				})
			case "bots.updateBotMemory":
				return yield* api.bots.updateBotMemory({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.bots.endpoints.updateBotMemory,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.bots.endpoints.updateBotMemory,
						input.payload,
					),
				})
			case "bots.botMemoryLog":
				return yield* api.bots.botMemoryLog({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.bots.endpoints.botMemoryLog,
						"params",
						input.params ?? {},
					),
				})
			case "bots.purgeBotMemory":
				return yield* api.bots.purgeBotMemory({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.bots.endpoints.purgeBotMemory,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.bots.endpoints.purgeBotMemory,
						input.payload,
					),
				})
			case "bots.memoryBot":
				return yield* api.bots.memoryBot({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.bots.endpoints.memoryBot,
						"params",
						input.params ?? {},
					),
				})
			case "bots.updateMemoryBot":
				return yield* api.bots.updateMemoryBot({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.bots.endpoints.updateMemoryBot,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.bots.endpoints.updateMemoryBot,
						input.payload,
					),
				})
			case "bots.listRules":
				return yield* api.bots.listRules({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.bots.endpoints.listRules,
						"params",
						input.params ?? {},
					),
				})
			case "bots.createRule":
				return yield* api.bots.createRule({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.bots.endpoints.createRule,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.bots.endpoints.createRule,
						input.payload,
					),
				})
			case "bots.updateRule":
				return yield* api.bots.updateRule({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.bots.endpoints.updateRule,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.bots.endpoints.updateRule,
						input.payload,
					),
				})
			case "bots.listGrants":
				return yield* api.bots.listGrants({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.bots.endpoints.listGrants,
						"params",
						input.params ?? {},
					),
					query: yield* decodeSlot(
						Api.OpenBotApi.groups.bots.endpoints.listGrants,
						"query",
						input.query ?? {},
					),
				})
			case "bots.createGrant":
				return yield* api.bots.createGrant({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.bots.endpoints.createGrant,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.bots.endpoints.createGrant,
						input.payload,
					),
				})
			case "bots.revokeGrant":
				return yield* api.bots.revokeGrant({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.bots.endpoints.revokeGrant,
						"params",
						input.params ?? {},
					),
				})
			case "bots.listBotMembers":
				return yield* api.bots.listBotMembers({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.bots.endpoints.listBotMembers,
						"params",
						input.params ?? {},
					),
				})
			case "bots.removeBotMember":
				return yield* api.bots.removeBotMember({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.bots.endpoints.removeBotMember,
						"params",
						input.params ?? {},
					),
				})
			case "bots.createBotInvitation":
				return yield* api.bots.createBotInvitation({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.bots.endpoints.createBotInvitation,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.bots.endpoints.createBotInvitation,
						input.payload,
					),
				})
			case "bots.listBotInvitations":
				return yield* api.bots.listBotInvitations({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.bots.endpoints.listBotInvitations,
						"params",
						input.params ?? {},
					),
					query: yield* decodeSlot(
						Api.OpenBotApi.groups.bots.endpoints.listBotInvitations,
						"query",
						input.query ?? {},
					),
				})
			case "bots.botInvitationSecret":
				return yield* api.bots.botInvitationSecret({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.bots.endpoints.botInvitationSecret,
						"params",
						input.params ?? {},
					),
				})
			case "bots.revokeBotInvitation":
				return yield* api.bots.revokeBotInvitation({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.bots.endpoints.revokeBotInvitation,
						"params",
						input.params ?? {},
					),
				})
			case "botInvitations.acceptBotInvitation":
				return yield* api.botInvitations.acceptBotInvitation({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.botInvitations.endpoints.acceptBotInvitation,
						input.payload,
					),
				})
			case "requests.listRequests":
				return yield* api.requests.listRequests({
					responseMode: "response-only",
					query: yield* decodeSlot(
						Api.OpenBotApi.groups.requests.endpoints.listRequests,
						"query",
						input.query ?? {},
					),
				})
			case "requests.getRequest":
				return yield* api.requests.getRequest({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.requests.endpoints.getRequest,
						"params",
						input.params ?? {},
					),
				})
			case "requests.resolveRequest":
				return yield* api.requests.resolveRequest({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.requests.endpoints.resolveRequest,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.requests.endpoints.resolveRequest,
						commandPayload(input.payload),
					),
				})
			case "memberSettings.getMemberSettings":
				return yield* api.memberSettings.getMemberSettings({
					responseMode: "response-only",
				})
			case "memberSettings.updateMemberSettings":
				return yield* api.memberSettings.updateMemberSettings({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.memberSettings.endpoints.updateMemberSettings,
						input.payload,
					),
				})
			case "reminders.listReminders":
				return yield* api.reminders.listReminders({
					responseMode: "response-only",
					query: yield* decodeSlot(
						Api.OpenBotApi.groups.reminders.endpoints.listReminders,
						"query",
						input.query ?? {},
					),
				})
			case "reminders.getReminder":
				return yield* api.reminders.getReminder({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.reminders.endpoints.getReminder,
						"params",
						input.params ?? {},
					),
				})
			case "reminders.cancelReminder":
				return yield* api.reminders.cancelReminder({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.reminders.endpoints.cancelReminder,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.reminders.endpoints.cancelReminder,
						commandPayload(input.payload),
					),
				})
			case "triggers.listTriggers":
				return yield* api.triggers.listTriggers({
					responseMode: "response-only",
				})
			case "triggers.createTrigger":
				return yield* api.triggers.createTrigger({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.triggers.endpoints.createTrigger,
						input.payload,
					),
				})
			case "triggers.getTrigger":
				return yield* api.triggers.getTrigger({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.triggers.endpoints.getTrigger,
						"params",
						input.params ?? {},
					),
				})
			case "triggers.updateTrigger":
				return yield* api.triggers.updateTrigger({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.triggers.endpoints.updateTrigger,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.triggers.endpoints.updateTrigger,
						input.payload,
					),
				})
			case "triggers.deleteTrigger":
				return yield* api.triggers.deleteTrigger({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.triggers.endpoints.deleteTrigger,
						"params",
						input.params ?? {},
					),
				})
			case "triggers.setTriggerWebhook":
				return yield* api.triggers.setTriggerWebhook({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.triggers.endpoints.setTriggerWebhook,
						"params",
						input.params ?? {},
					),
				})
			case "triggers.removeTriggerWebhook":
				return yield* api.triggers.removeTriggerWebhook({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.triggers.endpoints.removeTriggerWebhook,
						"params",
						input.params ?? {},
					),
				})
			case "channels.listChannels":
				return yield* api.channels.listChannels({
					responseMode: "response-only",
				})
			case "channels.createChannel":
				return yield* api.channels.createChannel({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.channels.endpoints.createChannel,
						commandPayload(input.payload),
					),
				})
			case "channels.getChannel":
				return yield* api.channels.getChannel({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.channels.endpoints.getChannel,
						"params",
						input.params ?? {},
					),
				})
			case "channels.updateChannel":
				return yield* api.channels.updateChannel({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.channels.endpoints.updateChannel,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.channels.endpoints.updateChannel,
						commandPayload(input.payload),
					),
				})
			case "channels.deleteChannel":
				return yield* api.channels.deleteChannel({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.channels.endpoints.deleteChannel,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.channels.endpoints.deleteChannel,
						commandPayload(input.payload),
					),
				})
			case "channels.setChannelSecret":
				return yield* api.channels.setChannelSecret({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.channels.endpoints.setChannelSecret,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.channels.endpoints.setChannelSecret,
						commandPayload(input.payload),
					),
				})
			case "channels.listChannelIdentities":
				return yield* api.channels.listChannelIdentities({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.channels.endpoints.listChannelIdentities,
						"params",
						input.params ?? {},
					),
				})
			case "channels.deleteChannelIdentity":
				return yield* api.channels.deleteChannelIdentity({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.channels.endpoints.deleteChannelIdentity,
						"params",
						input.params ?? {},
					),
				})
			case "channelLinks.getChannelLink":
				return yield* api.channelLinks.getChannelLink({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.channelLinks.endpoints.getChannelLink,
						"params",
						input.params ?? {},
					),
				})
			case "channelLinks.acceptChannelLink":
				return yield* api.channelLinks.acceptChannelLink({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.channelLinks.endpoints.acceptChannelLink,
						"params",
						input.params ?? {},
					),
				})
			case "channelLinks.listMyChannelIdentities":
				return yield* api.channelLinks.listMyChannelIdentities({
					responseMode: "response-only",
				})
			case "channelLinks.deleteMyChannelIdentity":
				return yield* api.channelLinks.deleteMyChannelIdentity({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.channelLinks.endpoints
							.deleteMyChannelIdentity,
						"params",
						input.params ?? {},
					),
				})
			case "computerProviders.listComputerProviders":
				return yield* api.computerProviders.listComputerProviders({
					responseMode: "response-only",
				})
			case "computerProviders.createComputerProvider":
				return yield* api.computerProviders.createComputerProvider({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.computerProviders.endpoints
							.createComputerProvider,
						input.payload,
					),
				})
			case "computerProviders.getComputerProvider":
				return yield* api.computerProviders.getComputerProvider({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.computerProviders.endpoints
							.getComputerProvider,
						"params",
						input.params ?? {},
					),
				})
			case "computerProviders.updateComputerProvider":
				return yield* api.computerProviders.updateComputerProvider({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.computerProviders.endpoints
							.updateComputerProvider,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.computerProviders.endpoints
							.updateComputerProvider,
						input.payload,
					),
				})
			case "computerProviders.deleteComputerProvider":
				return yield* api.computerProviders.deleteComputerProvider({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.computerProviders.endpoints
							.deleteComputerProvider,
						"params",
						input.params ?? {},
					),
				})
			case "computers.listComputers":
				return yield* api.computers.listComputers({
					responseMode: "response-only",
					query: yield* decodeSlot(
						Api.OpenBotApi.groups.computers.endpoints.listComputers,
						"query",
						input.query ?? {},
					),
				})
			case "computers.createComputer":
				return yield* api.computers.createComputer({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.computers.endpoints.createComputer,
						commandPayload(input.payload),
					),
				})
			case "computers.getComputer":
				return yield* api.computers.getComputer({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.computers.endpoints.getComputer,
						"params",
						input.params ?? {},
					),
				})
			case "computers.updateComputer":
				return yield* api.computers.updateComputer({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.computers.endpoints.updateComputer,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.computers.endpoints.updateComputer,
						input.payload,
					),
				})
			case "computers.deleteComputer":
				return yield* api.computers.deleteComputer({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.computers.endpoints.deleteComputer,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.computers.endpoints.deleteComputer,
						commandPayload(input.payload),
					),
				})
			case "computers.listComputerBots":
				return yield* api.computers.listComputerBots({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.computers.endpoints.listComputerBots,
						"params",
						input.params ?? {},
					),
				})
			case "computers.grantComputer":
				return yield* api.computers.grantComputer({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.computers.endpoints.grantComputer,
						"params",
						input.params ?? {},
					),
				})
			case "computers.revokeComputer":
				return yield* api.computers.revokeComputer({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.computers.endpoints.revokeComputer,
						"params",
						input.params ?? {},
					),
				})
			case "computers.listComputerUsage":
				return yield* api.computers.listComputerUsage({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.computers.endpoints.listComputerUsage,
						"params",
						input.params ?? {},
					),
				})
			case "computers.pauseComputer":
				return yield* api.computers.pauseComputer({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.computers.endpoints.pauseComputer,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.computers.endpoints.pauseComputer,
						commandPayload(input.payload),
					),
				})
			case "computers.resumeComputer":
				return yield* api.computers.resumeComputer({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.computers.endpoints.resumeComputer,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.computers.endpoints.resumeComputer,
						commandPayload(input.payload),
					),
				})
			case "computers.setConnectorToken":
				return yield* api.computers.setConnectorToken({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.computers.endpoints.setConnectorToken,
						"params",
						input.params ?? {},
					),
				})
			case "computers.exec":
				return yield* api.computers.exec({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.computers.endpoints.exec,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.computers.endpoints.exec,
						input.payload,
					),
				})
			case "computers.writeStdin":
				return yield* api.computers.writeStdin({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.computers.endpoints.writeStdin,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.computers.endpoints.writeStdin,
						input.payload,
					),
				})
			case "computers.resizeSession":
				return yield* api.computers.resizeSession({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.computers.endpoints.resizeSession,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.computers.endpoints.resizeSession,
						input.payload,
					),
				})
			case "computers.closeSession":
				return yield* api.computers.closeSession({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.computers.endpoints.closeSession,
						"params",
						input.params ?? {},
					),
				})
			case "computers.readFile":
				return yield* api.computers.readFile({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.computers.endpoints.readFile,
						"params",
						input.params ?? {},
					),
					query: yield* decodeSlot(
						Api.OpenBotApi.groups.computers.endpoints.readFile,
						"query",
						input.query ?? {},
					),
				})
			case "computers.writeFile":
				return yield* api.computers.writeFile({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.computers.endpoints.writeFile,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.computers.endpoints.writeFile,
						input.payload,
					),
				})
			case "computers.removeFile":
				return yield* api.computers.removeFile({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.computers.endpoints.removeFile,
						"params",
						input.params ?? {},
					),
					query: yield* decodeSlot(
						Api.OpenBotApi.groups.computers.endpoints.removeFile,
						"query",
						input.query ?? {},
					),
				})
			case "computers.listFiles":
				return yield* api.computers.listFiles({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.computers.endpoints.listFiles,
						"params",
						input.params ?? {},
					),
					query: yield* decodeSlot(
						Api.OpenBotApi.groups.computers.endpoints.listFiles,
						"query",
						input.query ?? {},
					),
				})
			case "computers.openPort":
				return yield* api.computers.openPort({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.computers.endpoints.openPort,
						"params",
						input.params ?? {},
					),
				})
			case "computers.takeScreenshot":
				return yield* api.computers.takeScreenshot({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.computers.endpoints.takeScreenshot,
						"params",
						input.params ?? {},
					),
				})
			case "computers.useDesktop":
				return yield* api.computers.useDesktop({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.computers.endpoints.useDesktop,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.computers.endpoints.useDesktop,
						input.payload,
					),
				})
			case "computers.streamDesktop":
				return yield* api.computers.streamDesktop({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.computers.endpoints.streamDesktop,
						"params",
						input.params ?? {},
					),
				})
			case "computers.getComputerPairing":
				return yield* api.computers.getComputerPairing({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.computers.endpoints.getComputerPairing,
						"params",
						input.params ?? {},
					),
				})
			case "computers.approveComputerPairing":
				return yield* api.computers.approveComputerPairing({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.computers.endpoints.approveComputerPairing,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.computers.endpoints.approveComputerPairing,
						input.payload,
					),
				})
			case "computers.denyComputerPairing":
				return yield* api.computers.denyComputerPairing({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.computers.endpoints.denyComputerPairing,
						"params",
						input.params ?? {},
					),
				})
			case "secretProviders.listSecretProviders":
				return yield* api.secretProviders.listSecretProviders({
					responseMode: "response-only",
				})
			case "secretProviders.createSecretProvider":
				return yield* api.secretProviders.createSecretProvider({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.secretProviders.endpoints
							.createSecretProvider,
						input.payload,
					),
				})
			case "secretProviders.getSecretProvider":
				return yield* api.secretProviders.getSecretProvider({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.secretProviders.endpoints.getSecretProvider,
						"params",
						input.params ?? {},
					),
				})
			case "secretProviders.updateSecretProvider":
				return yield* api.secretProviders.updateSecretProvider({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.secretProviders.endpoints
							.updateSecretProvider,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.secretProviders.endpoints
							.updateSecretProvider,
						input.payload,
					),
				})
			case "secretProviders.deleteSecretProvider":
				return yield* api.secretProviders.deleteSecretProvider({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.secretProviders.endpoints
							.deleteSecretProvider,
						"params",
						input.params ?? {},
					),
				})
			case "vaults.listVaults":
				return yield* api.vaults.listVaults({ responseMode: "response-only" })
			case "vaults.createVault":
				return yield* api.vaults.createVault({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.vaults.endpoints.createVault,
						input.payload,
					),
				})
			case "vaults.getVault":
				return yield* api.vaults.getVault({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.vaults.endpoints.getVault,
						"params",
						input.params ?? {},
					),
				})
			case "vaults.updateVault":
				return yield* api.vaults.updateVault({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.vaults.endpoints.updateVault,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.vaults.endpoints.updateVault,
						input.payload,
					),
				})
			case "vaults.deleteVault":
				return yield* api.vaults.deleteVault({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.vaults.endpoints.deleteVault,
						"params",
						input.params ?? {},
					),
				})
			case "vaults.listVaultItems":
				return yield* api.vaults.listVaultItems({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.vaults.endpoints.listVaultItems,
						"params",
						input.params ?? {},
					),
				})
			case "vaults.createVaultItem":
				return yield* api.vaults.createVaultItem({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.vaults.endpoints.createVaultItem,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.vaults.endpoints.createVaultItem,
						input.payload,
					),
				})
			case "vaults.getVaultItem":
				return yield* api.vaults.getVaultItem({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.vaults.endpoints.getVaultItem,
						"params",
						input.params ?? {},
					),
				})
			case "vaults.updateVaultItem":
				return yield* api.vaults.updateVaultItem({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.vaults.endpoints.updateVaultItem,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.vaults.endpoints.updateVaultItem,
						input.payload,
					),
				})
			case "vaults.deleteVaultItem":
				return yield* api.vaults.deleteVaultItem({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.vaults.endpoints.deleteVaultItem,
						"params",
						input.params ?? {},
					),
				})
			case "vaults.listVaultBots":
				return yield* api.vaults.listVaultBots({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.vaults.endpoints.listVaultBots,
						"params",
						input.params ?? {},
					),
				})
			case "vaults.grantVault":
				return yield* api.vaults.grantVault({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.vaults.endpoints.grantVault,
						"params",
						input.params ?? {},
					),
				})
			case "vaults.revokeVault":
				return yield* api.vaults.revokeVault({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.vaults.endpoints.revokeVault,
						"params",
						input.params ?? {},
					),
				})
			case "usage.getUsage":
				return yield* api.usage.getUsage({
					responseMode: "response-only",
					query: yield* decodeSlot(
						Api.OpenBotApi.groups.usage.endpoints.getUsage,
						"query",
						input.query ?? {},
					),
				})
			case "usage.listUsageEvents":
				return yield* api.usage.listUsageEvents({
					responseMode: "response-only",
					query: yield* decodeSlot(
						Api.OpenBotApi.groups.usage.endpoints.listUsageEvents,
						"query",
						input.query ?? {},
					),
				})
			case "usage.getCredits":
				return yield* api.usage.getCredits({ responseMode: "response-only" })
			case "budgets.listBudgets":
				return yield* api.budgets.listBudgets({ responseMode: "response-only" })
			case "budgets.createBudget":
				return yield* api.budgets.createBudget({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.budgets.endpoints.createBudget,
						input.payload,
					),
				})
			case "budgets.getBudget":
				return yield* api.budgets.getBudget({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.budgets.endpoints.getBudget,
						"params",
						input.params ?? {},
					),
				})
			case "budgets.updateBudget":
				return yield* api.budgets.updateBudget({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.budgets.endpoints.updateBudget,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.budgets.endpoints.updateBudget,
						input.payload,
					),
				})
			case "budgets.deleteBudget":
				return yield* api.budgets.deleteBudget({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.budgets.endpoints.deleteBudget,
						"params",
						input.params ?? {},
					),
				})
			case "appOperations.get":
				return yield* api.appOperations.get({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.appOperations.endpoints.get,
						"params",
						input.params ?? {},
					),
				})
			case "appOperations.list":
				return yield* api.appOperations.list({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.appOperations.endpoints.list,
						"params",
						input.params ?? {},
					),
				})
			case "appOperations.respond":
				return yield* api.appOperations.respond({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.appOperations.endpoints.respond,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.appOperations.endpoints.respond,
						commandPayload(input.payload),
					),
				})
			case "codeRuns.get":
				return yield* api.codeRuns.get({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.codeRuns.endpoints.get,
						"params",
						input.params ?? {},
					),
				})
			case "codeRuns.list":
				return yield* api.codeRuns.list({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.codeRuns.endpoints.list,
						"params",
						input.params ?? {},
					),
				})
			case "appViews.open":
				return yield* api.appViews.open({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.appViews.endpoints.open,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.appViews.endpoints.open,
						input.payload,
					),
				})
			case "appViews.get":
				return yield* api.appViews.get({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.appViews.endpoints.get,
						"params",
						input.params ?? {},
					),
				})
			case "appViews.close":
				return yield* api.appViews.close({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.appViews.endpoints.close,
						"params",
						input.params ?? {},
					),
				})
			case "appViews.read":
				return yield* api.appViews.read({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.appViews.endpoints.read,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.appViews.endpoints.read,
						input.payload,
					),
				})
			case "appViews.act":
				return yield* api.appViews.act({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.appViews.endpoints.act,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.appViews.endpoints.act,
						commandPayload(input.payload),
					),
				})
			case "appViews.confirmContext":
				return yield* api.appViews.confirmContext({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.appViews.endpoints.confirmContext,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.appViews.endpoints.confirmContext,
						input.payload,
					),
				})
			case "appViews.interaction":
				return yield* api.appViews.interaction({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.appViews.endpoints.interaction,
						"params",
						input.params ?? {},
					),
					query: yield* decodeSlot(
						Api.OpenBotApi.groups.appViews.endpoints.interaction,
						"query",
						input.query ?? {},
					),
				})
			case "appViews.message":
				return yield* api.appViews.message({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.appViews.endpoints.message,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.appViews.endpoints.message,
						commandPayload(input.payload),
					),
				})
			case "appExperience.export":
				return yield* api.appExperience.export({
					responseMode: "response-only",
				})
			case "appExperience.import":
				return yield* api.appExperience.import({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.appExperience.endpoints.import,
						input.payload,
					),
				})
			case "appExperience.reset":
				return yield* api.appExperience.reset({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.appExperience.endpoints.reset,
						commandPayload(input.payload),
					),
				})
			case "appExperience.getReset":
				return yield* api.appExperience.getReset({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.appExperience.endpoints.getReset,
						"params",
						input.params ?? {},
					),
				})
			case "connections.getConnectionExecution":
				return yield* api.connections.getConnectionExecution({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.connections.endpoints.getConnectionExecution,
						"params",
						input.params ?? {},
					),
				})
			case "connections.createManualConnection":
				return yield* api.connections.createManualConnection({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.connections.endpoints.createManualConnection,
						input.payload,
					),
				})
			case "connections.updateManualConnection":
				return yield* api.connections.updateManualConnection({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.connections.endpoints.updateManualConnection,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.connections.endpoints.updateManualConnection,
						commandPayload(input.payload),
					),
				})
			case "connections.verifyConnection":
				return yield* api.connections.verifyConnection({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.connections.endpoints.verifyConnection,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.connections.endpoints.verifyConnection,
						commandPayload(input.payload),
					),
				})
			case "connections.refreshConnectionAuthorization":
				return yield* api.connections.refreshConnectionAuthorization({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.connections.endpoints
							.refreshConnectionAuthorization,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.connections.endpoints
							.refreshConnectionAuthorization,
						commandPayload(input.payload),
					),
				})
			case "connections.revalidateConnection":
				return yield* api.connections.revalidateConnection({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.connections.endpoints.revalidateConnection,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.connections.endpoints.revalidateConnection,
						commandPayload(input.payload),
					),
				})
			case "connections.listConnections":
				return yield* api.connections.listConnections({
					responseMode: "response-only",
				})
			case "connections.prepareConnection":
				return yield* api.connections.prepareConnection({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.connections.endpoints.prepareConnection,
						input.payload,
					),
				})
			case "connections.getConnectionDraft":
				return yield* api.connections.getConnectionDraft({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.connections.endpoints.getConnectionDraft,
						"params",
						input.params ?? {},
					),
				})
			case "connections.createConnection":
				return yield* api.connections.createConnection({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.connections.endpoints.createConnection,
						input.payload,
					),
				})
			case "connections.getConnection":
				return yield* api.connections.getConnection({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.connections.endpoints.getConnection,
						"params",
						input.params ?? {},
					),
				})
			case "connections.updateConnection":
				return yield* api.connections.updateConnection({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.connections.endpoints.updateConnection,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.connections.endpoints.updateConnection,
						commandPayload(input.payload),
					),
				})
			case "connections.deleteConnection":
				return yield* api.connections.deleteConnection({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.connections.endpoints.deleteConnection,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.connections.endpoints.deleteConnection,
						commandPayload(input.payload),
					),
				})
			case "organizations.listOrganizations":
				return yield* api.organizations.listOrganizations({
					responseMode: "response-only",
				})
			case "organizations.createOrganization":
				return yield* api.organizations.createOrganization({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.organizations.endpoints.createOrganization,
						input.payload,
					),
				})
			case "organizations.leaveOrganization":
				return yield* api.organizations.leaveOrganization({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.organizations.endpoints.leaveOrganization,
						"params",
						input.params ?? {},
					),
				})
			case "organizations.listMyInvitations":
				return yield* api.organizations.listMyInvitations({
					responseMode: "response-only",
				})
			case "organizations.acceptInvitation":
				return yield* api.organizations.acceptInvitation({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.organizations.endpoints.acceptInvitation,
						"params",
						input.params ?? {},
					),
				})
			case "organizations.declineInvitation":
				return yield* api.organizations.declineInvitation({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.organizations.endpoints.declineInvitation,
						"params",
						input.params ?? {},
					),
				})
			case "platform.getPlatformSettings":
				return yield* api.platform.getPlatformSettings({
					responseMode: "response-only",
				})
			case "platform.updatePlatformSettings":
				return yield* api.platform.updatePlatformSettings({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.platform.endpoints.updatePlatformSettings,
						input.payload,
					),
				})
			case "platform.listPlatformOrganizations":
				return yield* api.platform.listPlatformOrganizations({
					responseMode: "response-only",
					query: yield* decodeSlot(
						Api.OpenBotApi.groups.platform.endpoints.listPlatformOrganizations,
						"query",
						input.query ?? {},
					),
				})
			case "platform.updatePlatformOrganization":
				return yield* api.platform.updatePlatformOrganization({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.platform.endpoints.updatePlatformOrganization,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.platform.endpoints.updatePlatformOrganization,
						input.payload,
					),
				})
			case "platform.listPlatformAdmins":
				return yield* api.platform.listPlatformAdmins({
					responseMode: "response-only",
				})
			case "platform.addPlatformAdmin":
				return yield* api.platform.addPlatformAdmin({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.platform.endpoints.addPlatformAdmin,
						input.payload,
					),
				})
			case "platform.removePlatformAdmin":
				return yield* api.platform.removePlatformAdmin({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.platform.endpoints.removePlatformAdmin,
						"params",
						input.params ?? {},
					),
				})
			case "platform.listPlatformModels":
				return yield* api.platform.listPlatformModels({
					responseMode: "response-only",
				})
			case "platform.getPlatformModel":
				return yield* api.platform.getPlatformModel({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.platform.endpoints.getPlatformModel,
						"params",
						input.params ?? {},
					),
				})
			case "platform.createPlatformModel":
				return yield* api.platform.createPlatformModel({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.platform.endpoints.createPlatformModel,
						input.payload,
					),
				})
			case "platform.updatePlatformModel":
				return yield* api.platform.updatePlatformModel({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.platform.endpoints.updatePlatformModel,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.platform.endpoints.updatePlatformModel,
						input.payload,
					),
				})
			case "platform.deletePlatformModel":
				return yield* api.platform.deletePlatformModel({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.platform.endpoints.deletePlatformModel,
						"params",
						input.params ?? {},
					),
				})
			case "platform.listPlatformModelProviders":
				return yield* api.platform.listPlatformModelProviders({
					responseMode: "response-only",
				})
			case "platform.getPlatformModelProvider":
				return yield* api.platform.getPlatformModelProvider({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.platform.endpoints.getPlatformModelProvider,
						"params",
						input.params ?? {},
					),
				})
			case "platform.createPlatformModelProvider":
				return yield* api.platform.createPlatformModelProvider({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.platform.endpoints
							.createPlatformModelProvider,
						input.payload,
					),
				})
			case "platform.updatePlatformModelProvider":
				return yield* api.platform.updatePlatformModelProvider({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.platform.endpoints
							.updatePlatformModelProvider,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.platform.endpoints
							.updatePlatformModelProvider,
						input.payload,
					),
				})
			case "platform.listPlatformModelPrices":
				return yield* api.platform.listPlatformModelPrices({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.platform.endpoints.listPlatformModelPrices,
						"params",
						input.params ?? {},
					),
				})
			case "platform.setPlatformModelPrice":
				return yield* api.platform.setPlatformModelPrice({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.platform.endpoints.setPlatformModelPrice,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.platform.endpoints.setPlatformModelPrice,
						input.payload,
					),
				})
			case "platform.getPlatformOrganizationCredits":
				return yield* api.platform.getPlatformOrganizationCredits({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.platform.endpoints
							.getPlatformOrganizationCredits,
						"params",
						input.params ?? {},
					),
				})
			case "platform.deletePlatformModelProvider":
				return yield* api.platform.deletePlatformModelProvider({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.platform.endpoints
							.deletePlatformModelProvider,
						"params",
						input.params ?? {},
					),
				})
			case "userTokens.listTokens":
				return yield* api.userTokens.listTokens({
					responseMode: "response-only",
				})
			case "userTokens.createToken":
				return yield* api.userTokens.createToken({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.userTokens.endpoints.createToken,
						input.payload,
					),
				})
			case "userTokens.revokeToken":
				return yield* api.userTokens.revokeToken({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.userTokens.endpoints.revokeToken,
						"params",
						input.params ?? {},
					),
				})
			case "userTokens.verifyToken":
				return yield* api.userTokens.verifyToken({
					responseMode: "response-only",
				})
			case "organization.getCapabilities":
				return yield* api.organization.getCapabilities({
					responseMode: "response-only",
				})
			case "organization.getOrganization":
				return yield* api.organization.getOrganization({
					responseMode: "response-only",
				})
			case "organization.updateOrganization":
				return yield* api.organization.updateOrganization({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.organization.endpoints.updateOrganization,
						input.payload,
					),
				})
			case "organization.listMembers":
				return yield* api.organization.listMembers({
					responseMode: "response-only",
					query: yield* decodeSlot(
						Api.OpenBotApi.groups.organization.endpoints.listMembers,
						"query",
						input.query ?? {},
					),
				})
			case "organization.getMember":
				return yield* api.organization.getMember({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.organization.endpoints.getMember,
						"params",
						input.params ?? {},
					),
				})
			case "organization.updateMember":
				return yield* api.organization.updateMember({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.organization.endpoints.updateMember,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.organization.endpoints.updateMember,
						input.payload,
					),
				})
			case "organization.removeMember":
				return yield* api.organization.removeMember({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.organization.endpoints.removeMember,
						"params",
						input.params ?? {},
					),
				})
			case "organization.listInvitations":
				return yield* api.organization.listInvitations({
					responseMode: "response-only",
					query: yield* decodeSlot(
						Api.OpenBotApi.groups.organization.endpoints.listInvitations,
						"query",
						input.query ?? {},
					),
				})
			case "organization.createInvitation":
				return yield* api.organization.createInvitation({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.organization.endpoints.createInvitation,
						input.payload,
					),
				})
			case "organization.revokeInvitation":
				return yield* api.organization.revokeInvitation({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.organization.endpoints.revokeInvitation,
						"params",
						input.params ?? {},
					),
				})
			case "organization.listResources":
				return yield* api.organization.listResources({
					responseMode: "response-only",
				})
			case "organization.getSettings":
				return yield* api.organization.getSettings({
					responseMode: "response-only",
				})
			case "organization.updateSettings":
				return yield* api.organization.updateSettings({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.organization.endpoints.updateSettings,
						input.payload,
					),
				})
			case "organization.listRoles":
				return yield* api.organization.listRoles({
					responseMode: "response-only",
				})
			case "organization.getRole":
				return yield* api.organization.getRole({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.organization.endpoints.getRole,
						"params",
						input.params ?? {},
					),
				})
			case "organization.createRole":
				return yield* api.organization.createRole({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.organization.endpoints.createRole,
						input.payload,
					),
				})
			case "organization.updateRole":
				return yield* api.organization.updateRole({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.organization.endpoints.updateRole,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.organization.endpoints.updateRole,
						input.payload,
					),
				})
			case "organization.deleteRole":
				return yield* api.organization.deleteRole({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.organization.endpoints.deleteRole,
						"params",
						input.params ?? {},
					),
				})
			case "organization.listAuditLogs":
				return yield* api.organization.listAuditLogs({
					responseMode: "response-only",
					query: yield* decodeSlot(
						Api.OpenBotApi.groups.organization.endpoints.listAuditLogs,
						"query",
						input.query ?? {},
					),
				})
			case "modelProviders.getModelCatalog":
				return yield* api.modelProviders.getModelCatalog({
					responseMode: "response-only",
				})
			case "modelProviders.listModels":
				return yield* api.modelProviders.listModels({
					responseMode: "response-only",
				})
			case "modelProviders.getModel":
				return yield* api.modelProviders.getModel({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.modelProviders.endpoints.getModel,
						"params",
						input.params ?? {},
					),
				})
			case "modelProviders.createModel":
				return yield* api.modelProviders.createModel({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.modelProviders.endpoints.createModel,
						input.payload,
					),
				})
			case "modelProviders.updateModel":
				return yield* api.modelProviders.updateModel({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.modelProviders.endpoints.updateModel,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.modelProviders.endpoints.updateModel,
						input.payload,
					),
				})
			case "modelProviders.deleteModel":
				return yield* api.modelProviders.deleteModel({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.modelProviders.endpoints.deleteModel,
						"params",
						input.params ?? {},
					),
				})
			case "modelProviders.listModelProviders":
				return yield* api.modelProviders.listModelProviders({
					responseMode: "response-only",
				})
			case "modelProviders.getModelProvider":
				return yield* api.modelProviders.getModelProvider({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.modelProviders.endpoints.getModelProvider,
						"params",
						input.params ?? {},
					),
				})
			case "modelProviders.createModelProvider":
				return yield* api.modelProviders.createModelProvider({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.modelProviders.endpoints.createModelProvider,
						input.payload,
					),
				})
			case "modelProviders.updateModelProvider":
				return yield* api.modelProviders.updateModelProvider({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.modelProviders.endpoints.updateModelProvider,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.modelProviders.endpoints.updateModelProvider,
						input.payload,
					),
				})
			case "modelProviders.deleteModelProvider":
				return yield* api.modelProviders.deleteModelProvider({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.modelProviders.endpoints.deleteModelProvider,
						"params",
						input.params ?? {},
					),
				})
			case "modelProviders.listModelPrices":
				return yield* api.modelProviders.listModelPrices({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.modelProviders.endpoints.listModelPrices,
						"params",
						input.params ?? {},
					),
				})
			case "modelProviders.setModelPrice":
				return yield* api.modelProviders.setModelPrice({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.modelProviders.endpoints.setModelPrice,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.modelProviders.endpoints.setModelPrice,
						input.payload,
					),
				})
			case "sso.listDomains":
				return yield* api.sso.listDomains({ responseMode: "response-only" })
			case "sso.addDomain":
				return yield* api.sso.addDomain({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.sso.endpoints.addDomain,
						input.payload,
					),
				})
			case "sso.verifyDomain":
				return yield* api.sso.verifyDomain({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.sso.endpoints.verifyDomain,
						"params",
						input.params ?? {},
					),
				})
			case "sso.removeDomain":
				return yield* api.sso.removeDomain({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.sso.endpoints.removeDomain,
						"params",
						input.params ?? {},
					),
				})
			case "sso.listSsoConnections":
				return yield* api.sso.listSsoConnections({
					responseMode: "response-only",
				})
			case "sso.getSsoConnection":
				return yield* api.sso.getSsoConnection({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.sso.endpoints.getSsoConnection,
						"params",
						input.params ?? {},
					),
				})
			case "sso.createSsoConnection":
				return yield* api.sso.createSsoConnection({
					responseMode: "response-only",
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.sso.endpoints.createSsoConnection,
						input.payload,
					),
				})
			case "sso.updateSsoConnection":
				return yield* api.sso.updateSsoConnection({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.sso.endpoints.updateSsoConnection,
						"params",
						input.params ?? {},
					),
					payload: yield* decodePayload(
						Api.OpenBotApi.groups.sso.endpoints.updateSsoConnection,
						input.payload,
					),
				})
			case "sso.deleteSsoConnection":
				return yield* api.sso.deleteSsoConnection({
					responseMode: "response-only",
					params: yield* decodeSlot(
						Api.OpenBotApi.groups.sso.endpoints.deleteSsoConnection,
						"params",
						input.params ?? {},
					),
				})
			default:
				return yield* UnsupportedOperation.make({ id })
		}
	})
