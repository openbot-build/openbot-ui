import { Schema } from "effect"
import { Sse } from "effect/encoding"
import * as Product from "./index.ts"

export class RequestFailed extends Error {
	readonly status: number
	readonly problem: Product.ProductError
	constructor(status: number, problem: Product.ProductError) {
		super(problem.message)
		this.status = status
		this.problem = problem
	}
}

export type Delivery =
	| { readonly kind: "receipt"; readonly receipt: Product.MessageReceipt }
	| {
			readonly kind: "stream"
			readonly events: AsyncIterable<Product.ChatEvent>
	  }

/** A stream is observed once. Recovery reads stored state instead of repeating a write. */
export async function* events(
	body: ReadableStream<Uint8Array>,
): AsyncIterable<Product.ChatEvent> {
	const reader = body.getReader()
	const decoder = new TextDecoder()
	let pending: Product.ChatEvent[] = []
	const parser = Sse.makeParser(
		(event) => {
			if (event._tag !== "Event") return
			const value = Schema.decodeUnknownSync(Product.ChatEvent)(
				JSON.parse(event.data),
			)
			if (event.event !== value.type)
				throw new Error("The event type does not match its data.")
			pending.push(value)
		},
		{ maxEventSize: 1024 * 1024 },
	)
	try {
		while (true) {
			const chunk = await reader.read()
			const failure = parser.feed(
				decoder.decode(chunk.value, { stream: !chunk.done }),
			)
			if (failure !== undefined) throw failure
			const ready = pending
			pending = []
			yield* ready
			if (chunk.done) return
		}
	} catch {
		throw new RequestFailed(0, {
			code: "outcome_unknown",
			message:
				"The live response was interrupted. Read the conversation to recover.",
		})
	} finally {
		await reader.cancel().catch(() => undefined)
		reader.releaseLock()
	}
}

export const make = (
	options: {
		readonly baseUrl?: string
		readonly fetch?: typeof globalThis.fetch
		readonly onUnauthorized?: () => void
	} = {},
) => {
	const base = options.baseUrl ?? "/api/kay/v1"
	const transport = options.fetch ?? globalThis.fetch
	const request = async (
		path: string,
		method = "GET",
		body?: unknown,
		signal?: AbortSignal,
	) => {
		let response: Response
		try {
			response = await transport(base + path, {
				method,
				credentials: "same-origin",
				redirect: "error",
				headers: {
					accept: "application/json, text/event-stream",
					...(body === undefined || body instanceof FormData
						? {}
						: { "content-type": "application/json" }),
				},
				...(body === undefined
					? {}
					: { body: body instanceof FormData ? body : JSON.stringify(body) }),
				...(signal === undefined ? {} : { signal }),
			})
		} catch {
			throw new RequestFailed(
				0,
				method === "GET"
					? {
							code: "unavailable",
							message: "Kay could not read the current state.",
						}
					: {
							code: "outcome_unknown",
							message:
								"Kay could not confirm this change. Read its state before trying again.",
						},
			)
		}
		if (response.status === 401) options.onUnauthorized?.()
		if (!response.ok) {
			let problem: Product.ProductError
			try {
				problem = Schema.decodeUnknownSync(Product.ProductError)(
					await response.json(),
				)
			} catch {
				problem = {
					code:
						response.status === 401
							? "unauthorized"
							: response.status === 403
								? "forbidden"
								: "unavailable",
					message: "Kay could not finish this request.",
				}
			}
			throw new RequestFailed(response.status, problem)
		}
		return response
	}
	const decodeResponse = async <A>(
		response: Response,
		schema: Schema.Decoder<A>,
		writing: boolean,
		emptyValue?: A,
	) => {
		try {
			const body = await response.text()
			if (body === "" && emptyValue !== undefined) return emptyValue
			return Schema.decodeUnknownSync(schema)(JSON.parse(body))
		} catch {
			throw new RequestFailed(
				response.status,
				writing
					? {
							code: "outcome_unknown",
							message:
								"Kay could not confirm this change. Read its state before trying again.",
						}
					: {
							code: "unavailable",
							message: "Kay could not read the current state.",
						},
			)
		}
	}
	const read = async <A>(
		path: string,
		schema: Schema.Decoder<A>,
		signal?: AbortSignal,
	) =>
		decodeResponse(await request(path, "GET", undefined, signal), schema, false)
	const change = async <A>(
		path: string,
		method: string,
		body: unknown,
		schema: Schema.Decoder<A>,
	) => decodeResponse(await request(path, method, body), schema, true)
	const send = async (
		path: string,
		input: Product.SendMessage,
		signal?: AbortSignal,
	): Promise<Delivery> => {
		const body = Schema.decodeSync(Product.SendMessage)(input, {
			onExcessProperty: "error",
		})
		const response = await request(path, "POST", body, signal)
		if (
			response.headers.get("content-type")?.includes("text/event-stream") ===
			true
		) {
			if (response.body === null)
				throw new RequestFailed(503, {
					code: "outcome_unknown",
					message:
						"The live response is missing. Read the conversation to recover.",
				})
			return { kind: "stream", events: events(response.body) }
		}
		return {
			kind: "receipt",
			receipt: await decodeResponse(response, Product.MessageReceipt, true),
		}
	}
	const changePreferences = (patch: Schema.JsonObject) =>
		change("/preferences", "PATCH", { change: patch }, Schema.JsonObject)
	const pause = (signal?: AbortSignal) =>
		new Promise<void>((resolve, reject) => {
			signal?.throwIfAborted()
			const abort = () => {
				clearTimeout(timer)
				reject(signal?.reason)
			}
			const timer = setTimeout(() => {
				signal?.removeEventListener("abort", abort)
				resolve()
			}, 1_000)
			signal?.addEventListener("abort", abort, { once: true })
		})
	let catalog: Promise<ReadonlyArray<Product.FeatureOperation>> | undefined
	const featureCatalog = (refresh = false) => {
		if (refresh) catalog = undefined
		return (catalog ??= read(
			"/features/catalog",
			Schema.Array(Product.FeatureOperation),
		).catch((error) => {
			catalog = undefined
			throw error
		}))
	}
	const featureResponse = async (
		operationId: string,
		input: Product.FeatureInput = {},
		signal?: AbortSignal,
		upload?: FormData,
	) => {
		const operation = (await featureCatalog()).find(
			(entry) => entry.id === operationId,
		)
		if (operation === undefined)
			throw new RequestFailed(404, {
				code: "not_found",
				message: "This operation is not available in Kay.",
			})
		if (operation.transport === "websocket")
			throw new RequestFailed(400, {
				code: "invalid_input",
				message: "Use the live workspace connection for this operation.",
			})
		const command = Schema.decodeSync(Product.FeatureInput)(input, {
			onExcessProperty: "error",
		})
		const query = operation.method === "GET" || upload !== undefined
		const path = `/features/${encodeURIComponent(operation.id)}${query ? `?input=${encodeURIComponent(JSON.stringify(command))}` : ""}`
		return request(
			path,
			operation.method,
			upload ?? (query ? undefined : command),
			signal,
		)
	}
	return {
		feedbackReports: (
			query: {
				readonly status?: typeof Product.FeedbackStatus.Type
				readonly before?: string
				readonly signal?: AbortSignal
			} = {},
		) => {
			const params = new URLSearchParams()
			if (query.status !== undefined) params.set("status", query.status)
			if (query.before !== undefined) params.set("before", query.before)
			return read(
				"/admin/feedback" + (params.size === 0 ? "" : "?" + params.toString()),
				Product.FeedbackPage,
				query.signal,
			)
		},
		feedbackReport: (id: string, signal?: AbortSignal) =>
			read(
				"/admin/feedback/" + encodeURIComponent(id),
				Product.FeedbackReport,
				signal,
			),
		updateFeedback: (id: string, command: Product.FeedbackUpdate) =>
			change(
				"/admin/feedback/" + encodeURIComponent(id),
				"PATCH",
				command,
				Product.FeedbackReport,
			),
		reminders: (
			input: {
				readonly chatId?: string
				readonly after?: string
				readonly signal?: AbortSignal
			} = {},
		) => {
			const query = new URLSearchParams()
			if (input.chatId !== undefined) query.set("chatId", input.chatId)
			if (input.after !== undefined) query.set("after", input.after)
			return read(
				`/reminders${query.size === 0 ? "" : "?" + query.toString()}`,
				Product.ReminderPage,
				input.signal,
			)
		},
		reminder: (id: string, signal?: AbortSignal) =>
			read(`/reminders/${encodeURIComponent(id)}`, Product.Reminder, signal),
		cancelReminder: async (id: string, signal?: AbortSignal) => {
			const response = await request(
				`/reminders/${encodeURIComponent(id)}/cancel`,
				"POST",
				{ commandKey: "reminder-cancel:" + crypto.randomUUID() },
				signal,
			)
			await decodeResponse(response, Schema.JsonObject, true)
		},
		basicCompute: (signal?: AbortSignal) =>
			read("/basic-compute", Product.BasicCompute, signal),
		provisionBasicCompute: (input: Product.BasicComputeCommand) =>
			change(
				"/basic-compute/provision",
				"POST",
				input,
				Product.BasicComputeOperation,
			),
		repairBasicCompute: (input: Product.BasicComputeCommand) =>
			change(
				"/basic-compute/repair",
				"POST",
				input,
				Product.BasicComputeOperation,
			),
		releaseBasicCompute: (input: Product.BasicComputeCommand) =>
			change(
				"/basic-compute/release",
				"POST",
				input,
				Product.BasicComputeOperation,
			),
		basicComputeRequest: (requestId: string, signal?: AbortSignal) =>
			read(
				"/basic-compute/requests/" + encodeURIComponent(requestId),
				Schema.NullOr(Product.BasicComputeOperation),
				signal,
			),
		membership: (signal?: AbortSignal) =>
			read("/membership", Product.Membership, signal),
		redeemMembership: (input: Product.RedeemMembership) =>
			change("/membership/redeem", "POST", input, Product.MembershipRedemption),
		membershipRedemption: (requestId: string, signal?: AbortSignal) =>
			read(
				`/membership/redemptions/${encodeURIComponent(requestId)}`,
				Schema.NullOr(Product.MembershipRedemption),
				signal,
			),
		membershipCodes: (
			options: { readonly before?: string; readonly signal?: AbortSignal } = {},
		) =>
			read(
				`/admin/membership/codes${options.before === undefined ? "" : `?before=${encodeURIComponent(options.before)}`}`,
				Product.MembershipCodePage,
				options.signal,
			),
		createMembershipCode: (input: Product.CreateMembershipCode) =>
			change(
				"/admin/membership/codes",
				"POST",
				input,
				Product.CreatedMembershipCode,
			),
		membershipCodeRequest: (requestId: string, signal?: AbortSignal) =>
			read(
				`/admin/membership/code-requests/${encodeURIComponent(requestId)}`,
				Schema.NullOr(Product.MembershipCode),
				signal,
			),
		revokeMembershipCode: (codeId: string) =>
			change(
				`/admin/membership/codes/${encodeURIComponent(codeId)}/revoke`,
				"POST",
				{},
				Product.MembershipCode,
			),
		featureCatalog: () => featureCatalog(true),
		featureResponse,
		featureCall: async (
			operationId: string,
			input: Product.FeatureInput = {},
			signal?: AbortSignal,
		) => {
			const operation = (await featureCatalog()).find(
				(entry) => entry.id === operationId,
			)
			const response = await featureResponse(operationId, input, signal)
			if (response.status === 204 || response.status === 205) return null
			const body = await decodeResponse(
				response,
				Schema.Json,
				operation?.method !== "GET",
				operation?.response === null ? null : undefined,
			)
			if (operation?.resultMode !== "execution") return body
			const receipt = Schema.decodeUnknownSync(Product.ExecutionReceipt)(body)
			// A command is submitted once. Only authorized state reads are retried.
			for (;;) {
				signal?.throwIfAborted()
				try {
					const saved = await read(
						`/feature-results/${encodeURIComponent(receipt.executionId)}?operation=${encodeURIComponent(operationId)}`,
						Product.FeatureResult,
						signal,
					)
					if (!saved.pending) return saved.result ?? null
				} catch (error) {
					signal?.throwIfAborted()
					if (
						!(error instanceof RequestFailed) ||
						(error.status > 0 && error.status < 500)
					)
						throw error
				}
				await pause(signal)
			}
		},
		featureUpload: async (
			operationId: string,
			file: File,
			input: Product.FeatureInput = {},
			signal?: AbortSignal,
		) => {
			const body = new FormData()
			body.set("file", file)
			return decodeResponse(
				await featureResponse(operationId, input, signal, body),
				Schema.Json,
				true,
			)
		},
		liveUrl: (chatId: string) => {
			const url = new URL(
				`${base}/chats/${encodeURIComponent(chatId)}/live`,
				globalThis.location.origin,
			)
			url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
			return url.toString()
		},
		preferences: (signal?: AbortSignal) =>
			read("/preferences", Schema.JsonObject, signal),
		execution: (id: string, signal?: AbortSignal, commandKey?: string) =>
			read(
				`/executions/${encodeURIComponent(id)}${commandKey === undefined ? "" : `?commandKey=${encodeURIComponent(commandKey)}`}`,
				Product.Execution,
				signal,
			),
		commandReceipt: (key: string, signal?: AbortSignal) =>
			read(
				`/execution-commands/${encodeURIComponent(key)}`,
				Schema.NullOr(Product.ExecutionReceipt),
				signal,
			),
		defaultBotStatus: (signal?: AbortSignal) =>
			read("/default-bot", Product.DefaultBotStatus, signal),
		ensureDefaultBot: (
			identity: Pick<typeof Product.Identity.Type, "userId" | "organizationId">,
		) => change("/default-bot", "POST", identity, Product.DefaultBotStatus),
		patchPreferences: (change: Schema.JsonObject) => changePreferences(change),
		chatMetadata: (id: string, signal?: AbortSignal) =>
			read(
				`/chats/${encodeURIComponent(id)}/metadata`,
				Product.ChatMetadata,
				signal,
			),
		patchChatMetadata: (
			id: string,
			patch: typeof Product.ChatMetadataPatch.Type,
		) =>
			change(
				`/chats/${encodeURIComponent(id)}/metadata`,
				"PATCH",
				Schema.decodeSync(Product.ChatMetadataPatch)(patch, {
					onExcessProperty: "error",
				}),
				Product.ChatMetadata,
			),
		automationLink: (triggerId: string, signal?: AbortSignal) =>
			read(
				`/automations/${encodeURIComponent(triggerId)}/conversation`,
				Product.AutomationLink,
				signal,
			),
		linkAutomation: (triggerId: string, patch: Product.AutomationLinkPatch) =>
			change(
				`/automations/${encodeURIComponent(triggerId)}/conversation`,
				"PUT",
				Schema.decodeSync(Product.AutomationLinkPatch)(patch, {
					onExcessProperty: "error",
				}),
				Product.AutomationLink,
			),
		bootstrap: (signal?: AbortSignal) =>
			read("/bootstrap", Product.Bootstrap, signal),
		companions: (signal?: AbortSignal) =>
			read("/bots", Schema.Array(Product.Companion), signal),
		conversations: (signal?: AbortSignal) =>
			read("/chats", Schema.Array(Product.ConversationSummary), signal),
		conversationOperation: (requestId: string) =>
			read(
				`/operations/${encodeURIComponent(requestId)}`,
				Product.ConversationOperation,
			),
		reconcileConversationOperation: (requestId: string) =>
			change(
				`/operations/${encodeURIComponent(requestId)}/reconcile`,
				"POST",
				{},
				Product.ConversationOperation,
			),
		conversation: (id: string, signal?: AbortSignal) =>
			read(`/chats/${encodeURIComponent(id)}`, Product.Conversation, signal),
		chatActivity: (id: string, signal?: AbortSignal) =>
			read(
				`/chats/${encodeURIComponent(id)}/activity`,
				Product.ConversationActivity,
				signal,
			),
		chatEvents: async function* (id: string, signal?: AbortSignal) {
			const response = await request(
				`/chats/${encodeURIComponent(id)}/events`,
				"GET",
				undefined,
				signal,
			)
			if (response.status === 204) return
			if (
				response.headers.get("content-type")?.includes("text/event-stream") !==
					true ||
				response.body === null
			)
				throw new RequestFailed(502, {
					code: "unavailable",
					message: "The conversation activity could not be observed.",
				})
			yield* events(response.body)
		},
		devices: (signal?: AbortSignal) =>
			read("/devices", Product.DevicesOverview, signal),
		attachFile: async (
			id: string,
			input: Product.AttachFile,
			signal?: AbortSignal,
		) =>
			decodeResponse(
				await request(
					`/chats/${encodeURIComponent(id)}/files`,
					"POST",
					Schema.decodeSync(Product.AttachFile)(input, {
						onExcessProperty: "error",
					}),
					signal,
				),
				Product.Conversation,
				true,
			),
		messages: (id: string, before?: number, signal?: AbortSignal) =>
			read(
				`/chats/${encodeURIComponent(id)}/items${before === undefined ? "" : `?before=${before}`}`,
				Product.MessagePage,
				signal,
			),
		turns: (id: string, after?: string, signal?: AbortSignal) =>
			read(
				`/chats/${encodeURIComponent(id)}/turns${after === undefined ? "" : `?after=${encodeURIComponent(after)}`}`,
				Product.TurnPage,
				signal,
			),
		wait: (id: string, revision: number, signal?: AbortSignal) =>
			read(
				`/chats/${encodeURIComponent(id)}/wait?after=${revision}`,
				Product.Conversation,
				signal,
			),
		create: (input: typeof Product.CreateConversation.Type) =>
			change(
				"/chats",
				"POST",
				Schema.decodeSync(Product.CreateConversation)(input, {
					onExcessProperty: "error",
				}),
				Product.Conversation,
			),
		fork: (id: string, input: typeof Product.ForkConversation.Type) =>
			change(
				`/chats/${encodeURIComponent(id)}/forks`,
				"POST",
				Schema.decodeSync(Product.ForkConversation)(input, {
					onExcessProperty: "error",
				}),
				Product.Conversation,
			),
		branches: (id: string, signal?: AbortSignal) =>
			read(
				`/chats/${encodeURIComponent(id)}/branches`,
				Schema.Array(Product.ConversationSummary),
				signal,
			),
		update: (id: string, input: typeof Product.UpdateConversation.Type) =>
			change(
				`/chats/${encodeURIComponent(id)}`,
				"PATCH",
				Schema.decodeSync(Product.UpdateConversation)(input, {
					onExcessProperty: "error",
				}),
				Product.Conversation,
			),
		interrupt: (id: string, includeTasks = false) =>
			change(
				`/chats/${encodeURIComponent(id)}/interrupt`,
				"POST",
				{ includeTasks },
				Product.Conversation,
			),
		send: (id: string, input: Product.SendMessage, signal?: AbortSignal) =>
			send(`/chats/${encodeURIComponent(id)}/messages`, input, signal),
		sendToBot: (id: string, input: Product.SendMessage, signal?: AbortSignal) =>
			send(`/bots/${encodeURIComponent(id)}/messages`, input, signal),
	}
}
export type Client = ReturnType<typeof make>
