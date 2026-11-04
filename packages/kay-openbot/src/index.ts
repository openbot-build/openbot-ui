import catalog from "./FeatureCatalog.json" with { type: "json" }
export { openNativeComputerSocket } from "./ComputerConnector.ts"
import { visibleCatalog } from "./FeaturePermissions.ts"
import { dispatchFeature } from "./FeatureDispatch.ts"
import { commandPayload } from "./Commands.ts"
import { chatExecutionStream } from "./ExecutionStream.ts"
import { observeChat } from "./ObserveChat.ts"
import { readFeatureResult } from "./FeatureResults.ts"
import { readExecutionEvents } from "./ExecutionEvents.ts"
import { make as makeClient } from "@openbot-build/client"
import * as Api from "@openbot-build/client/Api"
import { Item, Turn } from "@openbot-build/client/Core"
import { Data, Effect, Layer, Schema, Stream } from "effect"
import {
	FetchHttpClient,
	HttpClientRequest,
	type HttpClientResponse,
} from "effect/http"
import { HttpApiMiddleware } from "effect/http-api"
import type {
	NativeCall,
	NativeClientFactory,
} from "@kaicom/kay-contracts/Native"

const forwarded = [
	"cookie",
	"authorization",
	"origin",
	"openbot-organization",
	"x-request-id",
	"x-kay-epoch",
	"x-kay-backend",
	"x-forwarded-host",
	"x-forwarded-proto",
] as const
class CoreReceiptInvalid extends Data.TaggedError("CoreReceiptInvalid")<{}> {}

const webResponse = (response: HttpClientResponse.HttpClientResponse) =>
	new Response(
		[204, 205, 304].includes(response.status)
			? null
			: Stream.toReadableStream(response.stream),
		{ status: response.status, headers: response.headers },
	)

/** Use the pinned native SDK. Export only promises and web streams to Kay. */
export const createNativeClient = (options: {
	readonly origin: string
}): NativeClientFactory => {
	const origin = new URL(options.origin)
	if (
		!["http:", "https:"].includes(origin.protocol) ||
		origin.username !== "" ||
		origin.password !== "" ||
		origin.pathname !== "/" ||
		origin.search !== "" ||
		origin.hash !== ""
	)
		throw new Error("Use a plain HTTP origin for the core.")
	return ({ headers, signal }) => {
		const selected: Record<string, string> = {}
		for (const name of forwarded) {
			const value = headers.get(name)
			if (value !== null) selected[name] = value
		}
		const middleware = Layer.mergeAll(
			HttpApiMiddleware.layerClient(Api.BotAuth, ({ request, next }) =>
				next(HttpClientRequest.setHeaders(request, selected)),
			),
			HttpApiMiddleware.layerClient(Api.AccountAuth, ({ request, next }) =>
				next(HttpClientRequest.setHeaders(request, selected)),
			),
			HttpApiMiddleware.layerClient(Api.SessionAuth, ({ request, next }) =>
				next(HttpClientRequest.setHeaders(request, selected)),
			),
			FetchHttpClient.layer.pipe(
				Layer.provide(
					Layer.succeed(FetchHttpClient.RequestInit, {
						signal,
						redirect: "manual",
					}),
				),
			),
		)
		return {
			request: (call: NativeCall) =>
				Effect.runPromise(
					Effect.gen(function* () {
						if (call.operation === "observeChat")
							return yield* Effect.promise(() =>
								observeChat({
									chatId: call.id ?? "",
									client: createNativeClient(options)({ headers, signal }),
									observe: (executionId, afterSequence, observationSignal) =>
										createNativeClient(options)({
											headers,
											signal: AbortSignal.any([signal, observationSignal]),
										}).request({
											operation: "observeExecution",
											id: executionId,
											query: { afterSequence: String(afterSequence) },
										}),
								}),
							)
						const { api } = yield* makeClient({ baseUrl: origin.origin })
						const responseMode = "response-only" as const
						const chatId = () =>
							Schema.decodeUnknownEffect(Api.ChatInfo.fields.id)(call.id)
						const optionalNumber = (key: string) =>
							call.query?.[key] === undefined
								? {}
								: { [key]: Number(call.query[key]) }
						if (call.operation === "featureDefinition") {
							const definition = catalog.find((entry) => entry.id === call.id)
							return definition === undefined
								? Response.json({}, { status: 404 })
								: Response.json(definition)
						}
						if (call.operation === "featureCatalog")
							return Response.json(catalog)
						if (call.operation === "featureResult")
							return yield* readFeatureResult({
								api,
								operation: call.query?.["operation"] ?? "",
								executionId: call.id ?? "",
							})
						if (call.operation === "execution") {
							const executionId = yield* Schema.decodeUnknownEffect(
								Api.ExecutionsApi.Execution.Id,
							)(call.id)
							const response = yield* api.executions.get({
								params: { executionId },
								responseMode,
							})
							if (response.status !== 200) return webResponse(response)
							const execution = yield* Schema.decodeUnknownEffect(
								Api.ExecutionsApi.Execution.Record,
							)(yield* response.json)
							if (
								execution.status === "completed" ||
								execution.status === "interrupted" ||
								execution.status === "failed" ||
								execution.status === "cancelled"
							) {
								let inputItems: ReadonlyArray<string> | undefined
								if (call.query?.["commandKey"] !== undefined) {
									const receiptResponse = yield* dispatchFeature({
										api,
										id: "executions.receipt",
										input: {
											params: { commandKey: call.query["commandKey"] },
										},
									})
									if (receiptResponse.status !== 200)
										return webResponse(receiptResponse)
									const receipt = yield* Schema.decodeUnknownEffect(
										Schema.NullOr(Api.ExecutionsApi.Execution.Receipt),
									)(yield* receiptResponse.json)
									inputItems = receipt?.inputItems
								}
								if (
									inputItems === undefined &&
									execution.resource.kind !== "Chat"
								)
									return Response.json(execution)
								const events = yield* readExecutionEvents({
									api,
									execution,
									keep: (event) => event.body._tag === "InputMoved",
								})
								if ("response" in events) return events.response
								const ownedItems = inputItems
								const moved = events.events.findLast(
									(event) =>
										event.executionId === executionId &&
										event.body._tag === "InputMoved" &&
										(ownedItems === undefined ||
											event.body.items.some((item) =>
												ownedItems.includes(item),
											)),
								)?.body
								if (moved?._tag === "InputMoved")
									return Response.json({
										...execution,
										forwardedTo: moved.executionId,
									})
							}
							return Response.json(execution)
						}
						if (call.operation === "wait") {
							const after = yield* Schema.decodeEffect(
								Api.ChatInfo.fields.revision,
							)(Number(call.query?.["after"]))
							for (let attempt = 0; ; attempt++) {
								const response = yield* api.chats.getChat({
									params: { chatId: yield* chatId() },
									responseMode,
								})
								if (response.status !== 200) return webResponse(response)
								const view = yield* Schema.decodeUnknownEffect(Api.ChatView)(
									yield* response.json,
								)
								if (view.chat.revision !== after || attempt >= 19)
									return Response.json(view)
								yield* Effect.sleep("500 millis")
							}
						}
						if (call.operation === "access") {
							const response = yield* api.account.session({ responseMode })
							if (response.status !== 200) return webResponse(response)
							const session = yield* Schema.decodeUnknownEffect(
								Api.AuthApi.SessionInfo,
							)(yield* response.json)
							return Response.json({ adminConsole: session.platformAdmin })
						}
						if (call.operation === "visibleFeatureCatalog")
							return yield* Effect.gen(function* () {
								const sessionResponse = yield* api.account.session({
									responseMode,
								})
								if (sessionResponse.status !== 200)
									return webResponse(sessionResponse)
								const session = yield* Schema.decodeUnknownEffect(
									Api.AuthApi.SessionInfo,
								)(yield* sessionResponse.json)
								const permissionsResponse =
									yield* api.organization.getCapabilities({ responseMode })
								if (permissionsResponse.status !== 200)
									return webResponse(permissionsResponse)
								const capabilities = yield* Schema.decodeUnknownEffect(
									Api.OrganizationApi.OrganizationCapabilities,
								)(yield* permissionsResponse.json)
								return Response.json(
									visibleCatalog({
										catalog,
										platformAdmin: session.platformAdmin,
										resources: capabilities.resources,
									}),
								)
							}).pipe(
								Effect.catchTag("SchemaError", () =>
									Effect.succeed(
										Response.json(
											{
												code: "unavailable",
												message: "The core permissions could not be read.",
											},
											{ status: 503 },
										),
									),
								),
							)
						const operationName = call.operation
						const messagePayload = () =>
							Effect.gen(function* () {
								const input = yield* Schema.decodeUnknownEffect(
									Schema.JsonObject,
								)(call.payload)
								const { stream: _stream, ...command } = input
								return yield* Schema.decodeUnknownEffect(
									Api.ChatCommandRequest,
								)(commandPayload(command), { onExcessProperty: "error" })
							})
						const operation = Effect.gen(function* () {
							switch (operationName) {
								case "attachFile":
									return yield* dispatchFeature({
										api,
										id: "chats.attachFile",
										input: {
											params: { chatId: call.id },
											payload: call.payload,
										},
									})
								case "reminders":
									return yield* dispatchFeature({
										api,
										id: "reminders.listReminders",
										input: { query: call.query ?? {} },
									})
								case "reminder":
									return yield* dispatchFeature({
										api,
										id: "reminders.getReminder",
										input: { params: { reminderId: call.id } },
									})
								case "cancelReminder":
									return yield* dispatchFeature({
										api,
										id: "reminders.cancelReminder",
										input: {
											params: { reminderId: call.id },
											payload: commandPayload(call.payload),
										},
									})
								case "commandReceipt":
									return yield* dispatchFeature({
										api,
										id: "executions.receipt",
										input: { params: { commandKey: call.id } },
									})
								case "observeExecution":
									return yield* api.executions.observe({
										params: {
											executionId: yield* Schema.decodeUnknownEffect(
												Api.ExecutionsApi.Execution.Id,
											)(call.id),
										},
										query: {
											afterSequence: yield* Schema.decodeEffect(Schema.Natural)(
												Number(call.query?.["afterSequence"] ?? 0),
											),
										},
										responseMode,
									})
								case "feature": {
									const input = yield* Schema.decodeUnknownEffect(
										Schema.Struct({
											params: Schema.optionalKey(Schema.JsonObject),
											query: Schema.optionalKey(Schema.JsonObject),
											payload: Schema.optionalKey(Schema.Unknown),
										}),
									)(call.payload)
									return yield* dispatchFeature({
										api,
										id: call.id ?? "",
										input,
									})
								}
								case "memberSettings":
									return yield* api.memberSettings.getMemberSettings({
										responseMode,
									})
								case "bots":
									return yield* api.bots.listBots({
										query: {},
										responseMode,
									})
								case "chats":
									return yield* api.chats.listChats({
										query: {},
										responseMode,
									})
								case "chat":
									return yield* api.chats.getChat({
										params: { chatId: yield* chatId() },
										responseMode,
									})
								case "create":
									return yield* api.chats.createConversation({
										payload: yield* Schema.decodeUnknownEffect(
											Api.CreateConversationRequest,
										)(call.payload),
										responseMode,
									})
								case "fork":
									return yield* api.chats.forkChat({
										params: { chatId: yield* chatId() },
										payload: yield* Schema.decodeUnknownEffect(
											Api.ForkChatRequest,
										)(call.payload),
										responseMode,
									})
								case "branches":
									return yield* api.chats.chatBranches({
										params: { chatId: yield* chatId() },
										responseMode,
									})
								case "update":
									return yield* api.chats.updateChat({
										params: { chatId: yield* chatId() },
										payload: yield* Schema.decodeUnknownEffect(
											Api.UpdateChatRequest,
										)(call.payload),
										responseMode,
									})
								case "items":
									return yield* api.chats.chatItems({
										params: { chatId: yield* chatId() },
										query: {
											...optionalNumber("limit"),
											...(call.query?.["before"] === undefined
												? {}
												: {
														before: yield* Schema.decodeEffect(Item.Seq)(
															Number(call.query["before"]),
														),
													}),
										},
										responseMode,
									})
								case "turns":
									return yield* api.chats.chatTurns({
										params: { chatId: yield* chatId() },
										query: {
											...optionalNumber("limit"),
											...(call.query?.["after"] === undefined
												? {}
												: {
														after: yield* Schema.decodeEffect(Turn.Id)(
															call.query["after"],
														),
													}),
										},
										responseMode,
									})
								case "interrupt":
									return yield* api.chats.interruptChat({
										params: { chatId: yield* chatId() },
										payload: yield* Schema.decodeUnknownEffect(
											Api.InterruptChatRequest,
										)(commandPayload(call.payload)),
										responseMode,
									})
								case "send":
									return yield* api.chats.sendMessage({
										params: { chatId: yield* chatId() },
										payload: yield* messagePayload(),
										responseMode,
									})
								case "sendToBot":
									return yield* api.chats.sendBotMessage({
										params: {
											botId: yield* Schema.decodeUnknownEffect(
												Api.BotsApi.BotId,
											)(call.id),
										},
										payload: yield* messagePayload(),
										responseMode,
									})
							}
						})
						const response = yield* operation
						if (
							response.status === 202 &&
							(call.operation === "send" || call.operation === "sendToBot")
						) {
							const receipt = yield* Schema.decodeUnknownEffect(
								Api.ChatCommandReceipt,
							)(yield* response.json).pipe(
								Effect.catchTag("SchemaError", () => new CoreReceiptInvalid()),
							)
							const input = yield* Schema.decodeUnknownEffect(
								Schema.JsonObject,
							)(call.payload)
							if (input["stream"] === true)
								return chatExecutionStream({
									receipt,
									observe: (observationSignal) =>
										createNativeClient(options)({
											headers,
											signal: AbortSignal.any([signal, observationSignal]),
										}).request({
											operation: "observeExecution",
											id: receipt.executionId,
										}),
								})
							return Response.json(
								{ ...receipt, delivery: "accepted", item: null },
								{ status: 202 },
							)
						}
						if (response.status === 202 && call.operation === "interrupt") {
							// The cancellation is accepted; the following read remains authoritative.
							yield* Schema.decodeUnknownEffect(
								Api.ExecutionsApi.Execution.Receipt,
							)(yield* response.json).pipe(
								Effect.catchTag("SchemaError", () => new CoreReceiptInvalid()),
							)
							return webResponse(
								yield* api.chats.getChat({
									params: { chatId: yield* chatId() },
									responseMode,
								}),
							)
						}
						return webResponse(response)
					}).pipe(
						Effect.catchTags({
							CoreReceiptInvalid: () =>
								Effect.succeed(
									Response.json(
										{
											code: "outcome_unknown",
											message:
												"The core accepted this command but its receipt could not be read. Check the saved command before trying again.",
										},
										{ status: 503 },
									),
								),
							SchemaError: () =>
								Effect.succeed(
									Response.json(
										{
											code: "invalid_input",
											message: "Review the parameters for this operation.",
										},
										{ status: 400 },
									),
								),
						}),
						// This Promise factory is the runtime boundary for the native SDK.
						// @effect-diagnostics-next-line strictEffectProvide:off
						Effect.provide(middleware),
					),
					{ signal },
				),
		}
	}
}
