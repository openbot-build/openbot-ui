import { FeedbackFailure, type Feedback } from "./Feedback.ts"
import { prepareFeedback } from "./FeedbackSetup.ts"
import {
	isAuthorizationReply,
	rememberAuthorizationReply,
} from "./NativeNavigation.ts"
import { makeProductOperations } from "./ProductOperations.ts"
import { conversationTitle } from "./ConversationTitle.ts"
import {
	ConversationActivityFailure,
	readConversationActivity,
} from "./ConversationActivity.ts"
import { DevicesFailure, readDevices } from "./Devices.ts"
import { fileValidationMessage } from "./FileValidation.ts"
import { makeDefaultBot } from "./DefaultBot.ts"
import { BusinessFailure, makeBusiness } from "./ProductBusiness.ts"
import { makeMembership, MembershipFailure } from "./Membership.ts"
import {
	makeBasicCompute,
	BasicComputeFailure,
	type BasicComputeConfiguration,
} from "./BasicCompute.ts"
import { makeComputeStore } from "./BasicComputeStore.ts"
import { basicComputeManagedOperation } from "./BasicComputeManagement.ts"
import type { DatabaseRuntime } from "./Database.ts"
import type { Telemetry } from "./Telemetry.ts"
import type { IncomingMessage, ServerResponse } from "node:http"
import { once } from "node:events"
import { Match, Schema } from "effect"
import { Sse } from "effect/encoding"
import * as Product from "@kaicom/kay-contracts"
import type { NativeCall, NativeClient } from "@kaicom/kay-contracts/Native"
export type {
	NativeCall,
	NativeClient,
	NativeClientFactory,
} from "@kaicom/kay-contracts/Native"
const json = (res: ServerResponse, status: number, value: unknown) => {
	res.writeHead(status, {
		"content-type": "application/json",
		"cache-control": "no-store",
	})
	res.end(JSON.stringify(value))
}
const object = (value: unknown) =>
	Schema.decodeUnknownSync(Schema.JsonObject)(value)
const text = (value: unknown) => Schema.decodeUnknownSync(Schema.String)(value)
const id = (value: unknown) => Schema.decodeUnknownSync(Product.Id)(value)
const natural = (value: unknown) =>
	Schema.decodeUnknownSync(Schema.Natural)(value)
const list = (value: unknown) =>
	Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(value)

const summary = (value: unknown): Product.ConversationSummary => {
	const raw = object(value),
		chat = object(raw["chat"])
	const branch =
		chat["branchOf"] === undefined ? null : object(chat["branchOf"])
	return Schema.decodeUnknownSync(Product.ConversationSummary)({
		id: chat["id"],
		botId: chat["bot"],
		kind: chat["kind"],
		revision: chat["revision"],
		title: chat["title"] ?? null,
		status: raw["status"],
		activity:
			raw["activity"] ?? (raw["status"] === "Running" ? "active" : "inactive"),
		createdAt: chat["createdAt"],
		memory: chat["memory"] ?? { read: true, write: true },
		branch:
			branch === null
				? null
				: {
						sourceChatId: branch["chat"],
						sourceRevision: branch["revision"],
						throughSequence: branch["throughSeq"],
						rootChatId: branch["root"],
						reason: branch["reason"],
					},
	})
}
const conversations = (value: unknown) =>
	list(value)
		.map(summary)
		.filter((chat) => chat.kind === "direct" || chat.kind === "conversation")
const conversation = (value: unknown): Product.Conversation => {
	const raw = object(value),
		open = object(raw["open"])
	return Schema.decodeUnknownSync(Product.Conversation)({
		...summary(raw),
		queuedInputs: raw["inbox"],
		activeTurnId: raw["turn"] === null ? null : object(raw["turn"])["id"],
		openWork: {
			tasks: open["delegations"],
			approvals: open["requests"],
			reminders: open["reminders"],
		},
	})
}
const companions = (
	value: unknown,
	defaultBot: string | null,
): ReadonlyArray<Product.Companion> =>
	list(value).map((bot) =>
		Schema.decodeUnknownSync(Product.Companion)({
			id: bot["id"],
			name: bot["name"],
			description: bot["role"],
			isDefault: bot["id"] === defaultBot,
			archived: bot["archived"],
		}),
	)

const messages = (value: unknown) => {
	const page = object(value)
	return Schema.decodeUnknownSync(Product.MessagePage)({
		items: list(page["items"]).flatMap((item) => {
			const contents = list(object(item["content"])["content"])
			return contents.map((message, index) => ({
				id: contents.length === 1 ? item["id"] : `${id(item["id"])}:${index}`,
				sourceItemId: item["id"],
				sequence: item["seq"],
				turnId:
					item["origin"] === undefined ? null : object(item["origin"])["turn"],
				role: message["role"],
				parts:
					typeof message["content"] === "string"
						? [{ type: "text", text: message["content"] }]
						: list(message["content"]).map((part) => ({
								type: text(part["type"]),
								...(typeof part["text"] === "string"
									? { text: part["text"] }
									: { details: part }),
							})),
			}))
		}),
		next: page["next"],
	})
}
const turns = (value: unknown) => {
	const page = object(value)
	return Schema.decodeUnknownSync(Product.TurnPage)({
		items: list(page["items"]).map((turn) => ({
			id: turn["id"],
			chatId: turn["chat"],
			status: object(turn["status"])["_tag"],
			startedAt: turn["startedAt"],
			completedAt: turn["completedAt"] ?? null,
			inputItemIds: turn["input"],
			itemIds: turn["items"],
		})),
		next: page["next"],
	})
}
const event = (value: unknown): Product.ChatEvent => {
	const raw = object(value),
		response =
			raw["response"] === undefined ? undefined : object(raw["response"])
	const tool = Schema.is(Product.ToolActivity)(raw["toolActivity"])
		? Schema.decodeSync(Product.ToolActivity)(raw["toolActivity"])
		: undefined
	return Schema.decodeUnknownSync(Product.ChatEvent)({
		type: raw["type"],
		chatId: raw["chat"],
		turnId: raw["turn"],
		sequence: raw["sequence_number"],
		...(typeof raw["item_id"] === "string" ? { itemId: raw["item_id"] } : {}),
		...(typeof raw["delta"] === "string" ? { delta: raw["delta"] } : {}),
		...(typeof raw["text"] === "string" ? { text: raw["text"] } : {}),
		...(response === undefined ? {} : { status: response["status"] }),
		...(typeof raw["executionId"] === "string"
			? { executionId: raw["executionId"] }
			: {}),
		...(typeof raw["commandKey"] === "string"
			? { commandKey: raw["commandKey"] }
			: {}),
		...(raw["inputItems"] === undefined
			? {}
			: { inputItems: raw["inputItems"] }),
		...(raw["executionSequence"] === undefined
			? {}
			: { executionSequence: raw["executionSequence"] }),
		...(tool === undefined ||
		raw["type"] !== "response.tool_activity" ||
		typeof raw["executionId"] !== "string" ||
		typeof raw["turn"] !== "string" ||
		!Schema.is(Schema.Natural)(raw["executionSequence"]) ||
		tool.step !== `tool:${tool.itemId.length}:${tool.itemId}${tool.callId}`
			? {}
			: { toolActivity: tool }),
	})
}
const sendPayload = (value: unknown) => {
	const input = Schema.decodeUnknownSync(Product.SendMessage)(value, {
		onExcessProperty: "error",
	})
	return {
		input:
			typeof input.input === "string"
				? input.input
				: [
						{
							role: "user",
							content: input.input.map((part) =>
								part.type === "text"
									? { type: "input_text", text: part.text }
									: {
											type:
												part.type === "image" ? "input_image" : "input_file",
											file_id: part.fileId,
										},
							),
						},
					],
		...(input.stream === undefined ? {} : { stream: input.stream }),
		...(input.memory === undefined ? {} : { memory: input.memory }),
		...(input.commandKey === undefined ? {} : { commandKey: input.commandKey }),
	}
}
const errorFor = (status: number, requestId: string): Product.ProductError => ({
	code:
		status === 401
			? "unauthorized"
			: status === 403
				? "forbidden"
				: status === 404
					? "not_found"
					: status === 409
						? "conflict"
						: status === 400 || status === 422
							? "invalid_input"
							: "unavailable",
	message:
		status === 401
			? "Sign in to use Kay."
			: status === 403
				? "You do not have access to this item."
				: status === 409
					? "This item changed. Read its current state before trying again."
					: status === 404
						? "This item was not found."
						: "Kay could not finish this request.",
	requestId,
})

const relayEvents = async (
	response: Response,
	res: ServerResponse,
	observe?: (chunk: Uint8Array) => void,
) => {
	if (response.body === null)
		throw new Error("The upstream stream has no body.")
	res.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-store",
		"x-accel-buffering": "no",
	})
	res.flushHeaders()
	const reader = response.body.getReader(),
		decoder = new TextDecoder()
	const abort = new AbortController()
	const closed = () => {
		abort.abort()
		// A quiet subscription may have no next event to release its pending read.
		void reader.cancel().catch(() => undefined)
	}
	res.once("close", closed)
	let frames: string[] = []
	const parser = Sse.makeParser(
		(frame) => {
			if (frame._tag !== "Event") return
			const value = event(JSON.parse(frame.data))
			if (frame.event !== value.type)
				throw new Error("The event type does not match its data.")
			frames.push(
				Sse.encoder.write({
					_tag: "Event",
					event: value.type,
					id: undefined,
					data: JSON.stringify(value),
				}),
			)
		},
		{ maxEventSize: 1024 * 1024 },
	)
	try {
		while (!res.destroyed) {
			const chunk = await reader.read()
			if (chunk.value !== undefined) observe?.(chunk.value)
			const failure = parser.feed(
				decoder.decode(chunk.value, { stream: !chunk.done }),
			)
			if (failure !== undefined) throw failure
			const ready = frames
			frames = []
			for (const frame of ready)
				if (!res.write(frame))
					await once(res, "drain", { signal: abort.signal })
			if (chunk.done) break
		}
		res.end()
	} finally {
		res.off("close", closed)
		abort.abort()
		await reader.cancel()
		reader.releaseLock()
	}
}

/** This router runs only after the existing identity and account admission gates. */
export const handleProductRequest = async (input: {
	readonly req: IncomingMessage
	readonly res: ServerResponse
	readonly url: URL
	readonly payload: unknown
	readonly client: NativeClient
	readonly identity: typeof Product.Identity.Type
	readonly requestId: string
	readonly db?: DatabaseRuntime
	readonly telemetry?: Telemetry
	readonly startedAt?: number
	readonly epoch?: number
	readonly membershipCodeManagerAccountId?: string
	readonly basicCompute?: BasicComputeConfiguration
	readonly feedback?: { readonly service: Feedback; readonly origin: string }
}) => {
	const { req, res, url, client, identity, requestId } = input
	const path = url.pathname.slice("/api/kay/v1".length),
		method = req.method ?? "GET"
	const business =
		input.db === undefined
			? undefined
			: makeBusiness({ db: input.db, identity, client })
	const operations =
		input.db === undefined || input.epoch === undefined
			? undefined
			: makeProductOperations({
					db: input.db,
					identity,
					client,
					epoch: input.epoch,
				})
	let receiving = false
	const read = async (call: NativeCall): Promise<unknown> => {
		const response = await client.request(call)
		if (!response.ok) throw new ProductHttpFailure(response.status)
		receiving = true
		return response.json()
	}
	const prepareReporting = async (botId: string) => {
		if (
			input.feedback === undefined ||
			input.db === undefined ||
			input.epoch === undefined
		)
			return
		try {
			if (
				!(await prepareFeedback({
					feedback: input.feedback.service,
					origin: input.feedback.origin,
					db: input.db,
					client,
					identity,
					epoch: input.epoch,
					botId,
				}))
			)
				input.telemetry?.increment("feedback_setup_unavailable")
		} catch {
			input.telemetry?.increment("feedback_setup_unavailable")
		}
	}
	try {
		const eventsPath = /^\/chats\/([^/]+)\/events$/.exec(path)
		if (method === "GET" && eventsPath !== null) {
			if (url.search !== "") throw new InvalidProductInput()
			const response = await client.request({
				operation: "observeChat",
				id: id(decodeURIComponent(eventsPath[1]!)),
			})
			if (!response.ok) {
				await response.body?.cancel()
				throw new ProductHttpFailure(response.status)
			}
			if (response.status === 204) {
				res.writeHead(204, { "cache-control": "no-store" })
				res.end()
				return
			}
			if (
				response.headers.get("content-type")?.includes("text/event-stream") !==
				true
			) {
				await response.body?.cancel()
				throw new ProductHttpFailure(502)
			}
			receiving = true
			await relayEvents(response, res)
			return
		}
		const activityPath = /^\/chats\/([^/]+)\/activity$/.exec(path)
		if (method === "GET" && activityPath !== null) {
			if (url.search !== "") throw new InvalidProductInput()
			json(
				res,
				200,
				await readConversationActivity({
					chatId: id(decodeURIComponent(activityPath[1]!)),
					read,
				}),
			)
			return
		}
		if (method === "GET" && path === "/devices") {
			if (url.search !== "") throw new InvalidProductInput()
			const settings = object(await read({ operation: "memberSettings" }))
			const store =
				input.db === undefined ? undefined : makeComputeStore(input.db)
			json(
				res,
				200,
				await readDevices({
					client,
					userId: identity.userId,
					defaultBotId:
						settings["defaultBot"] == null ? null : id(settings["defaultBot"]),
					isManaged: (computerId) =>
						store?.isManaged(computerId) ?? Promise.resolve(false),
				}),
			)
			return
		}
		if (path === "/admin/feedback" || path.startsWith("/admin/feedback/")) {
			if (input.feedback === undefined) throw new ProductHttpFailure(503)
			const access = Schema.decodeUnknownSync(Product.Access)(
				await read({ operation: "access" }),
			)
			if (!access.adminConsole) throw new ProductHttpFailure(403)
			const service = input.feedback.service
			const reportPath = /^\/admin\/feedback\/([^/]+)$/.exec(path)
			if (path === "/admin/feedback" && method === "GET") {
				for (const key of url.searchParams.keys())
					if (
						!["status", "before"].includes(key) ||
						url.searchParams.getAll(key).length !== 1
					)
						throw new InvalidProductInput()
				const status = url.searchParams.get("status"),
					before = url.searchParams.get("before")
				json(
					res,
					200,
					await service.list({
						...(status === null
							? {}
							: {
									status: Schema.decodeUnknownSync(Product.FeedbackStatus)(
										status,
									),
								}),
						...(before === null ? {} : { before }),
					}),
				)
				return
			}
			if (reportPath !== null) {
				if (url.search !== "") throw new InvalidProductInput()
				const reportId = Schema.decodeSync(
					Schema.String.check(Schema.isUUID()),
				)(decodeURIComponent(reportPath[1]!))
				if (method === "GET") {
					json(res, 200, await service.get(reportId))
					return
				}
				if (method === "PATCH") {
					const command = Schema.decodeUnknownSync(Product.FeedbackUpdate)(
						input.payload,
						{ onExcessProperty: "error" },
					)
					json(
						res,
						200,
						await service.update(reportId, command, identity.userId),
					)
					return
				}
			}
			throw new ProductHttpFailure(404)
		}
		if (path === "/basic-compute" || path.startsWith("/basic-compute/")) {
			if (input.db === undefined) throw new ProductHttpFailure(503)
			if (url.search !== "") throw new InvalidProductInput()
			const compute = makeBasicCompute({
				db: input.db,
				identity,
				client,
				...(input.basicCompute === undefined
					? {}
					: { config: input.basicCompute }),
			})
			if (method === "GET" && path === "/basic-compute") {
				json(res, 200, await compute.get())
				return
			}
			const saved = /^\/basic-compute\/requests\/([^/]+)$/.exec(path)
			if (method === "GET" && saved !== null) {
				json(
					res,
					200,
					await compute.getOperation(
						Schema.decodeSync(Product.RequestId)(decodeURIComponent(saved[1]!)),
					),
				)
				return
			}
			const action = /^\/basic-compute\/(provision|repair|release)$/.exec(path)
			if (method === "POST" && action !== null) {
				const command = Schema.decodeUnknownSync(Product.BasicComputeCommand)(
					input.payload,
					{ onExcessProperty: "error" },
				)
				const kind = Schema.decodeUnknownSync(
					Product.BasicComputeOperation.fields.action,
				)(action[1])
				json(res, 200, await compute.run(kind, command))
				return
			}
			throw new ProductHttpFailure(404)
		}
		if (
			path === "/membership" ||
			path.startsWith("/membership/") ||
			path.startsWith("/admin/membership/")
		) {
			if (input.db === undefined) throw new ProductHttpFailure(503)
			const canManageCodes =
				input.membershipCodeManagerAccountId === identity.userId &&
				Schema.decodeUnknownSync(Product.Access)(
					await read({ operation: "access" }),
				).adminConsole
			if (path.startsWith("/admin/") && !canManageCodes)
				throw new ProductHttpFailure(403)
			receiving = false
			const membership = makeMembership({ db: input.db, canManageCodes })
			const codesPath = path === "/admin/membership/codes"
			for (const name of url.searchParams.keys())
				if (!(codesPath && method === "GET" && name === "before"))
					throw new InvalidProductInput()
			if (url.searchParams.getAll("before").length > 1)
				throw new InvalidProductInput()
			if (path === "/membership" && method === "GET") {
				json(res, 200, await membership.get(identity.userId))
				return
			}
			if (path === "/membership/redeem" && method === "POST") {
				const command = Schema.decodeUnknownSync(Product.RedeemMembership)(
					input.payload,
					{ onExcessProperty: "error" },
				)
				json(
					res,
					200,
					await membership.redeem({
						accountId: identity.userId,
						displayName: identity.displayName,
						command,
					}),
				)
				return
			}
			const redemptionPath = /^\/membership\/redemptions\/([^/]+)$/.exec(path)
			if (redemptionPath !== null && method === "GET") {
				const key = Schema.decodeSync(Product.RequestId)(
					decodeURIComponent(redemptionPath[1]!),
				)
				json(
					res,
					200,
					await membership.redemption({
						accountId: identity.userId,
						requestId: key,
					}),
				)
				return
			}
			if (codesPath && method === "GET") {
				json(
					res,
					200,
					await membership.listCodes(
						url.searchParams.get("before") ?? undefined,
					),
				)
				return
			}
			if (codesPath && method === "POST") {
				const command = Schema.decodeUnknownSync(Product.CreateMembershipCode)(
					input.payload,
					{ onExcessProperty: "error" },
				)
				json(
					res,
					200,
					await membership.createCode({ actorId: identity.userId, command }),
				)
				return
			}
			const codeRequestPath =
				/^\/admin\/membership\/code-requests\/([^/]+)$/.exec(path)
			if (codeRequestPath !== null && method === "GET") {
				const key = Schema.decodeSync(Product.RequestId)(
					decodeURIComponent(codeRequestPath[1]!),
				)
				json(
					res,
					200,
					await membership.codeRequest({
						actorId: identity.userId,
						requestId: key,
					}),
				)
				return
			}
			const revokePath = /^\/admin\/membership\/codes\/([^/]+)\/revoke$/.exec(
				path,
			)
			if (revokePath !== null && method === "POST") {
				Schema.decodeUnknownSync(Schema.Struct({}))(input.payload, {
					onExcessProperty: "error",
				})
				json(
					res,
					200,
					await membership.revokeCode({
						actorId: identity.userId,
						codeId: id(decodeURIComponent(revokePath[1]!)),
					}),
				)
				return
			}
			throw new ProductHttpFailure(404)
		}
		if (path === "/default-bot" && (method === "GET" || method === "POST")) {
			if (input.db === undefined || input.epoch === undefined)
				throw new ProductHttpFailure(503)
			if (method === "POST") {
				const expected = Schema.decodeUnknownSync(
					Schema.Struct({ userId: Product.Id, organizationId: Product.Id }),
				)(input.payload, { onExcessProperty: "error" })
				if (
					expected.userId !== identity.userId ||
					expected.organizationId !== identity.organizationId
				)
					throw new ProductHttpFailure(409)
			}
			const setup = makeDefaultBot({
				db: input.db,
				identity,
				client,
				epoch: input.epoch,
			})
			const state = method === "POST" ? await setup.ensure() : await setup.get()
			if (method === "POST" && state.phase === "ready" && state.botId !== null)
				await prepareReporting(state.botId)
			json(res, 200, state)
			return
		}
		const operationPath = /^\/operations\/([^/]+)(\/reconcile)?$/.exec(path)
		if (
			operationPath !== null &&
			((method === "GET" && operationPath[2] === undefined) ||
				(method === "POST" && operationPath[2] !== undefined))
		) {
			if (operations === undefined) throw new ProductHttpFailure(503)
			const operationId = Schema.decodeSync(Product.RequestId)(
				decodeURIComponent(operationPath[1]!),
			)
			if (method === "POST") {
				const completed = await operations.reconcile(operationId)
				await completed.body?.cancel()
			}
			json(res, 200, await operations.get(operationId))
			return
		}
		if (path === "/preferences" && ["GET", "PATCH", "PUT"].includes(method)) {
			if (business === undefined) throw new ProductHttpFailure(503)
			const action =
				method === "PATCH" ? "PATCH" : method === "PUT" ? "PUT" : "GET"
			json(res, 200, await business.preferences(action, input.payload))
			return
		}
		const automationLink = /^\/automations\/([^/]+)\/conversation$/.exec(path)
		if (automationLink !== null && (method === "GET" || method === "PUT")) {
			if (business === undefined) throw new ProductHttpFailure(503)
			const triggerId = id(decodeURIComponent(automationLink[1]!))
			const patch =
				method === "PUT"
					? Schema.decodeUnknownSync(Product.AutomationLinkPatch)(
							input.payload,
							{ onExcessProperty: "error" },
						)
					: undefined
			json(
				res,
				200,
				patch === undefined
					? await business.getAutomationLink(triggerId)
					: await business.linkAutomation(triggerId, patch),
			)
			return
		}
		const managed = /^\/chats\/([^/]+)\/metadata$/.exec(path)
		if (managed !== null && (method === "GET" || method === "PATCH")) {
			if (business === undefined) throw new ProductHttpFailure(503)
			const chatId = id(decodeURIComponent(managed[1]!))
			const patch =
				method === "PATCH"
					? Schema.decodeUnknownSync(Product.ChatMetadataPatch)(input.payload, {
							onExcessProperty: "error",
						})
					: undefined
			await read({ operation: "chat", id: chatId })
			const value =
				patch === undefined
					? ((await business.listMetadata()).find(
							(item) => item.chatId === chatId,
						) ?? {
							chatId,
							revision: 0,
							title: null,
							archived: false,
							automationIds: [],
						})
					: await business.patchMetadata(chatId, patch)
			json(res, 200, value)
			return
		}
		if (path === "/features/catalog" && method === "GET") {
			const access = Schema.decodeUnknownSync(Product.Access)(
				await read({ operation: "access" }),
			)
			const catalog = Schema.decodeUnknownSync(
				Schema.Array(Product.FeatureOperation),
			)(await read({ operation: "visibleFeatureCatalog" }))
			json(
				res,
				200,
				catalog.filter(
					(operation) =>
						access.adminConsole ||
						!Product.isAdministrationOperation(operation),
				),
			)
			return
		}
		const executionResult = /^\/feature-results\/([^/]+)$/.exec(path)
		if (executionResult !== null && method === "GET") {
			for (const name of url.searchParams.keys())
				if (name !== "operation") throw new InvalidProductInput()
			if (url.searchParams.getAll("operation").length !== 1)
				throw new InvalidProductInput()
			const operation = Schema.decodeUnknownSync(Product.FeatureOperation)(
				await read({
					operation: "featureDefinition",
					id: id(url.searchParams.get("operation")),
				}),
			)
			if (operation.resultMode !== "execution") throw new InvalidProductInput()
			if (Product.isAdministrationOperation(operation)) {
				const access = Schema.decodeUnknownSync(Product.Access)(
					await read({ operation: "access" }),
				)
				if (!access.adminConsole) throw new ProductHttpFailure(403)
			}
			const response = await client.request({
				operation: "featureResult",
				id: id(decodeURIComponent(executionResult[1]!)),
				query: { operation: operation.id },
			})
			if (
				response.ok &&
				input.db !== undefined &&
				isAuthorizationReply(operation.id)
			) {
				const body = Schema.decodeUnknownSync(Product.FeatureResult)(
					await response.json(),
				)
				if (!body.pending && body.result !== undefined)
					await rememberAuthorizationReply({
						db: input.db,
						accountId: identity.userId,
						operationId: operation.id,
						body: body.result,
					})
				json(res, response.status, body)
			} else await relayFeatureResponse(response, res)
			return
		}
		const execution = /^\/executions\/([^/]+)$/.exec(path)
		if (execution !== null && method === "GET") {
			for (const name of url.searchParams.keys())
				if (name !== "commandKey") throw new InvalidProductInput()
			if (url.searchParams.getAll("commandKey").length > 1)
				throw new InvalidProductInput()
			json(
				res,
				200,
				Schema.decodeUnknownSync(Product.Execution)(
					await read({
						operation: "execution",
						id: id(decodeURIComponent(execution[1]!)),
						...(url.searchParams.has("commandKey")
							? {
									query: {
										commandKey: Schema.decodeUnknownSync(Product.RequestId)(
											url.searchParams.get("commandKey"),
										),
									},
								}
							: {}),
					}),
				),
			)
			return
		}
		const receipt = /^\/execution-commands\/([^/]+)$/.exec(path)
		if (receipt !== null && method === "GET") {
			json(
				res,
				200,
				Schema.decodeUnknownSync(Schema.NullOr(Product.ExecutionReceipt))(
					await read({
						operation: "commandReceipt",
						id: id(decodeURIComponent(receipt[1]!)),
					}),
				),
			)
			return
		}
		const feature =
			/^\/features\/([A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*)$/.exec(path)
		if (feature !== null) {
			const operation = Schema.decodeUnknownSync(Product.FeatureOperation)(
				await read({ operation: "featureDefinition", id: feature[1]! }),
			)
			if (Product.isAdministrationOperation(operation)) {
				const access = Schema.decodeUnknownSync(Product.Access)(
					await read({ operation: "access" }),
				)
				if (!access.adminConsole) throw new ProductHttpFailure(403)
			}
			receiving = false
			if (operation.method !== method) {
				json(res, 404, errorFor(404, requestId))
				return
			}
			if (operation.transport === "websocket") {
				json(res, 400, {
					code: "invalid_input",
					message: "Use the workspace live connection for this operation.",
					requestId,
				})
				return
			}
			const multipart =
				req.headers["content-type"]?.startsWith("multipart/form-data") === true
			for (const name of url.searchParams.keys())
				if (name !== "input") throw new InvalidProductInput()
			if (url.searchParams.getAll("input").length > 1)
				throw new InvalidProductInput()
			const command =
				method === "GET" || multipart
					? Schema.decodeSync(Schema.fromJsonString(Product.FeatureInput))(
							url.searchParams.get("input") ?? "{}",
							{ onExcessProperty: "error" },
						)
					: Schema.decodeSync(Product.FeatureInput)(input.payload ?? {}, {
							onExcessProperty: "error",
						})
			if (
				input.db !== undefined &&
				basicComputeManagedOperation(operation.id) &&
				typeof command.params?.["computerId"] === "string"
			) {
				const computeStore = makeComputeStore(input.db)
				if (await computeStore.isManaged(command.params["computerId"]))
					throw BasicComputeFailure.make({
						status: 403,
						code: "forbidden",
						message:
							"Manage this personal task workspace through its setup and repair controls.",
					})
				if (
					await computeStore.pendingCreation({
						accountId: identity.userId,
						organizationId: identity.organizationId,
					})
				)
					throw BasicComputeFailure.make({
						status: 409,
						code: "conflict",
						message:
							"Finish or restore the basic workspace setup before changing computer permissions.",
					})
			}
			if (multipart !== (operation.transport === "multipart"))
				throw new InvalidProductInput()
			if (
				isAuthorizationReply(operation.id) &&
				Schema.is(Schema.JsonObject)(command.payload) &&
				command.payload["returnTo"] !== undefined
			)
				Schema.decodeUnknownSync(Product.ReturnTo)(command.payload["returnTo"])
			const payload = multipart
				? { ...command, payload: await readMultipart(req) }
				: command
			const response =
				operations !== undefined && operation.id === "chats.createConversation"
					? await operations.run({
							operation: "create",
							payload: command.payload,
						})
					: operations !== undefined && operation.id === "chats.forkChat"
						? await operations.run({
								operation: "fork",
								id: id(command.params?.["chatId"]),
								payload: command.payload,
							})
						: await client.request({
								operation: "feature",
								id: operation.id,
								payload,
							})
			receiving = true
			if (!response.ok) {
				const validation = await fileValidationMessage({
					operation: operation.id,
					response,
				})
				if (!response.bodyUsed) await response.body?.cancel()
				if (method !== "GET" && response.status >= 500)
					throw new Error("The core write result is uncertain.")
				json(
					res,
					response.status,
					validation === null
						? errorFor(response.status, requestId)
						: { code: "invalid_input", message: validation, requestId },
				)
				return
			}
			if (
				input.db !== undefined &&
				isAuthorizationReply(operation.id) &&
				operation.resultMode !== "execution"
			) {
				const body: unknown = await response.json()
				await rememberAuthorizationReply({
					db: input.db,
					accountId: identity.userId,
					operationId: operation.id,
					body,
					...(command.payload === undefined
						? {}
						: { payload: command.payload }),
				})
				json(res, response.status, body)
			} else await relayFeatureResponse(response, res)
			return
		}
		if (method === "GET" && (path === "/bootstrap" || path === "/bots")) {
			const settings = object(await read({ operation: "memberSettings" }))
			const defaultBot =
				settings["defaultBot"] === null ? null : id(settings["defaultBot"])
			const bots = companions(await read({ operation: "bots" }), defaultBot)
			if (path === "/bots") {
				json(res, 200, bots)
				return
			}
			const access = Schema.decodeUnknownSync(Product.Access)(
				await read({ operation: "access" }),
			)
			const chats = conversations(await read({ operation: "chats" }))
			const metadata =
				business === undefined
					? []
					: (await business.listMetadata()).filter((item) =>
							chats.some((chat) => chat.id === item.chatId),
						)
			json(
				res,
				200,
				Schema.decodeSync(Product.Bootstrap)({
					identity,
					access,
					defaultBotId: defaultBot,
					features: {
						dualConversations: true,
						tasks: true,
						files: true,
						automations: true,
						live: true,
						computers: true,
					},
					companions: bots,
					conversations: chats,
					metadata,
				}),
			)
			return
		}
		let call: NativeCall
		let project: (value: unknown) => unknown = conversation
		let status = 200
		const reminderPath = /^\/reminders\/([^/]+)(\/cancel)?$/.exec(path)
		if (path === "/reminders" && method === "GET") {
			const query: Record<string, string> = {}
			for (const [key, value] of url.searchParams) {
				if (
					!["chatId", "after"].includes(key) ||
					url.searchParams.getAll(key).length !== 1
				)
					throw new InvalidProductInput()
				query[key] = id(value)
			}
			call = { operation: "reminders", query }
			project = Schema.decodeUnknownSync(Product.ReminderPage)
		} else if (
			reminderPath !== null &&
			method === "GET" &&
			reminderPath[2] === undefined
		) {
			call = {
				operation: "reminder",
				id: id(decodeURIComponent(reminderPath[1]!)),
			}
			project = Schema.decodeUnknownSync(Product.Reminder)
		} else if (
			reminderPath !== null &&
			method === "POST" &&
			reminderPath[2] !== undefined
		) {
			call = {
				operation: "cancelReminder",
				id: id(decodeURIComponent(reminderPath[1]!)),
				payload: Schema.decodeUnknownSync(
					Schema.Struct({ commandKey: Product.RequestId }),
				)(input.payload, { onExcessProperty: "error" }),
			}
			status = 202
			project = object
		} else if (path === "/chats" && method === "GET") {
			call = { operation: "chats" }
			project = conversations
		} else if (path === "/chats" && method === "POST") {
			call = {
				operation: "create",
				payload: Schema.decodeUnknownSync(Product.CreateConversation)(
					input.payload,
					{ onExcessProperty: "error" },
				),
			}
			status = 201
		} else {
			const match =
				/^\/(chats|bots)\/([^/]+)(?:\/(items|turns|wait|messages|interrupt|forks|branches|files))?$/.exec(
					path,
				)
			if (match === null) {
				json(res, 404, errorFor(404, requestId))
				return
			}
			const target = id(decodeURIComponent(match[2]!)),
				action = match[3]
			if (
				match[1] === "bots" &&
				!(method === "POST" && action === "messages")
			) {
				json(res, 404, errorFor(404, requestId))
				return
			}
			if (method === "GET" && action === undefined)
				call = { operation: "chat", id: target }
			else if (method === "PATCH" && action === undefined)
				call = {
					operation: "update",
					id: target,
					payload: Schema.decodeUnknownSync(Product.UpdateConversation)(
						input.payload,
						{ onExcessProperty: "error" },
					),
				}
			else if (method === "GET" && action === "branches") {
				call = { operation: "branches", id: target }
				project = conversations
			} else if (
				method === "POST" &&
				action === "files" &&
				match[1] === "chats"
			) {
				call = {
					operation: "attachFile",
					id: target,
					payload: Schema.decodeUnknownSync(Product.AttachFile)(input.payload, {
						onExcessProperty: "error",
					}),
				}
			} else if (method === "POST" && action === "forks") {
				call = {
					operation: "fork",
					id: target,
					payload: Schema.decodeUnknownSync(Product.ForkConversation)(
						input.payload,
						{ onExcessProperty: "error" },
					),
				}
				status = 201
			} else if (method === "POST" && action === "interrupt") {
				const value = Schema.decodeUnknownSync(
					Schema.Struct({ includeTasks: Schema.Boolean }),
				)(input.payload, { onExcessProperty: "error" })
				call = {
					operation: "interrupt",
					id: target,
					payload: { delegations: value.includeTasks },
				}
			} else if (
				method === "GET" &&
				(action === "items" || action === "turns" || action === "wait")
			) {
				const query: Record<string, string> = {}
				for (const key of url.searchParams.keys())
					if (
						!(
							action === "wait"
								? ["after"]
								: [action === "items" ? "before" : "after", "limit"]
						).includes(key)
					)
						throw new InvalidProductInput()
				for (const [key, value] of url.searchParams) {
					if (url.searchParams.getAll(key).length !== 1)
						throw new InvalidProductInput()
					if (key === "after" && action === "turns") query[key] = id(value)
					else {
						const number = natural(Number(value))
						if (
							value === "" ||
							(key === "limit" && (number < 1 || number > 100))
						)
							throw new InvalidProductInput()
						query[key] = String(number)
					}
				}
				if (action === "wait" && query["after"] === undefined)
					throw new InvalidProductInput()
				call = { operation: action, id: target, query }
				project =
					action === "items"
						? messages
						: action === "turns"
							? turns
							: conversation
			} else if (method === "POST" && action === "messages") {
				call = {
					operation: match[1] === "bots" ? "sendToBot" : "send",
					id: target,
					payload: sendPayload(input.payload),
				}
				if (input.feedback !== undefined) {
					try {
						const settings = object(await read({ operation: "memberSettings" }))
						const botId =
							match[1] === "bots"
								? target
								: id(
										object(
											object(await read({ operation: "chat", id: target }))[
												"chat"
											],
										)["bot"],
									)
						if (settings["defaultBot"] === botId) await prepareReporting(botId)
					} catch {
						input.telemetry?.increment("feedback_setup_unavailable")
					}
				}
				if (input.db !== undefined && input.basicCompute !== undefined) {
					let preparation: "not_required" | "ready" | "unavailable" =
						"not_required"
					try {
						const botId =
							match[1] === "bots"
								? target
								: id(
										object(
											object(await read({ operation: "chat", id: target }))[
												"chat"
											],
										)["bot"],
									)
						preparation = await makeBasicCompute({
							db: input.db,
							identity,
							client,
							config: input.basicCompute,
						}).prepareForMessage(botId)
					} catch (error) {
						if (
							(error instanceof ProductHttpFailure &&
								[401, 403, 404].includes(error.status)) ||
							(error instanceof BasicComputeFailure && error.status === 401)
						)
							throw error
						preparation = "unavailable"
					}
					Match.value(preparation).pipe(
						Match.when("unavailable", () =>
							input.telemetry?.increment("basic_compute_prepare_unavailable"),
						),
						Match.orElse(() => undefined),
					)
				}
				project = (value) => {
					const raw = object(value)
					return Schema.decodeUnknownSync(Product.MessageReceipt)({
						delivery: raw["delivery"],
						chatId: raw["chat"],
						itemId: raw["item"],
						turnId: raw["turn"],
						...(raw["executionId"] === undefined
							? {}
							: { executionId: raw["executionId"] }),
						...(raw["commandKey"] === undefined
							? {}
							: { commandKey: raw["commandKey"] }),
						...(raw["inputItems"] === undefined
							? {}
							: { inputItems: raw["inputItems"] }),
					})
				}
				status = 202
			} else {
				json(res, 404, errorFor(404, requestId))
				return
			}
		}
		const response =
			operations === undefined
				? await client.request(call)
				: await operations.run(call)
		if (!response.ok) {
			await response.body?.cancel()
			if (method !== "GET" && response.status >= 500)
				throw new Error("The core write result is uncertain.")
			json(res, response.status, errorFor(response.status, requestId))
			return
		}
		receiving = true
		if (
			response.headers.get("content-type")?.includes("text/event-stream") ===
			true
		) {
			input.telemetry?.increment("stream_started")
			try {
				await relayEvents(
					response,
					res,
					input.telemetry?.stream(input.startedAt ?? performance.now()),
				)
			} catch (error) {
				input.telemetry?.increment("stream_interrupted")
				throw error
			}
			return
		}
		const projected = project(await response.json())
		if (call.operation === "chat" && business !== undefined) {
			const chat = Schema.decodeUnknownSync(Product.Conversation)(projected)
			if (chat.kind === "conversation") {
				try {
					let saved = (await business.listMetadata()).find(
						(row) => row.chatId === chat.id,
					)
					if (saved?.title == null && chat.title === null) {
						// Read only the beginning, even when a long conversation has many pages.
						const first = messages(
							await read({
								operation: "items",
								id: chat.id,
								query: { before: "33", limit: "32" },
							}),
						)
						const title = conversationTitle(first)
						if (title !== null) saved = await business.fillTitle(chat.id, title)
					}
					json(res, status, { ...chat, title: saved?.title ?? chat.title })
					return
				} catch {
					// Naming is product metadata; a failure must not hide a readable Chat.
					input.telemetry?.increment("conversation_title_unavailable")
				}
			}
		}
		json(res, status, projected)
	} catch (error) {
		if (res.headersSent) {
			res.destroy()
			return
		}
		if (
			error instanceof FeedbackFailure ||
			error instanceof MembershipFailure ||
			error instanceof BasicComputeFailure
		) {
			json(res, error.status, {
				code:
					error instanceof FeedbackFailure
						? errorFor(error.status, requestId).code
						: error.code,
				message: error.message,
				requestId,
			})
			return
		}
		if (
			error instanceof BusinessFailure ||
			error instanceof ConversationActivityFailure ||
			error instanceof DevicesFailure
		) {
			json(res, error.status, errorFor(error.status, requestId))
			return
		}
		if (error instanceof ProductHttpFailure) {
			json(res, error.status, errorFor(error.status, requestId))
			return
		}
		if (
			error instanceof InvalidProductInput ||
			(!receiving && Schema.isSchemaError(error))
		) {
			json(res, 400, errorFor(400, requestId))
			return
		}
		json(res, 503, {
			code: method === "GET" ? "unavailable" : "outcome_unknown",
			message:
				method === "GET"
					? "Kay could not read the current state."
					: "Kay could not confirm this change. Read its state before trying again.",
			requestId,
		})
	}
}
class ProductHttpFailure extends Error {
	readonly status: number
	constructor(status: number) {
		super("The core rejected this request.")
		this.status = status
	}
}
class InvalidProductInput extends Error {}

const readMultipart = async (req: IncomingMessage): Promise<FormData> => {
	const chunks: Uint8Array[] = []
	let bytes = 0
	for await (const chunk of req) {
		const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
		bytes += value.length
		if (bytes > 16 * 1024 * 1024) throw new InvalidProductInput()
		chunks.push(value)
	}
	return new Response(Buffer.concat(chunks), {
		headers: { "content-type": req.headers["content-type"] ?? "" },
	}).formData()
}
const relayFeatureResponse = async (
	response: Response,
	res: ServerResponse,
) => {
	const headers: Record<string, string> = {
		"cache-control": "no-store",
		"x-accel-buffering": "no",
	}
	for (const name of [
		"content-type",
		"content-disposition",
		"content-length",
		"etag",
		"last-modified",
	]) {
		const value = response.headers.get(name)
		if (value !== null) headers[name] = value
	}
	res.writeHead(response.status, headers)
	res.flushHeaders()
	if (response.body === null) {
		res.end()
		return
	}
	const reader = response.body.getReader(),
		abort = new AbortController()
	const closed = () => {
		abort.abort()
		void reader.cancel()
	}
	res.once("close", closed)
	try {
		while (!res.destroyed) {
			const chunk = await reader.read()
			if (chunk.done) break
			if (!res.write(chunk.value))
				await once(res, "drain", { signal: abort.signal })
		}
		res.end()
	} finally {
		res.off("close", closed)
		await reader.cancel()
		reader.releaseLock()
	}
}
