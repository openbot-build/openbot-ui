import * as Api from "@openbot-build/client/Api"
import { Match, Schema } from "effect"
import { Sse } from "effect/encoding"

type Receipt = {
	readonly executionId: string
	readonly sequence: number
	readonly chat: string
	readonly turn: string | null
	readonly inputItems?: ReadonlyArray<string>
	readonly commandKey?: string
}
type ExecutionEvent = Api.ExecutionsApi.Execution.Event
const Tool = Schema.Struct({
	chatId: Schema.NonEmptyString,
	turnId: Schema.NonEmptyString,
	itemId: Schema.NonEmptyString,
	callId: Schema.NonEmptyString,
	name: Schema.NonEmptyString,
	computerId: Schema.optionalKey(Schema.NonEmptyString),
})
type Tool = typeof Tool.Type

/** Project one durable execution into the existing Kay message stream. */
export const chatExecutionStream = ({
	receipt,
	observe,
	acknowledge = true,
	afterSequence = 0,
}: {
	readonly receipt: Receipt
	readonly observe: (signal: AbortSignal) => Promise<Response>
	readonly acknowledge?: boolean
	readonly afterSequence?: number
}): Response => {
	if (!Number.isSafeInteger(afterSequence) || afterSequence < 0)
		throw new Error("Use a valid execution cursor.")
	const abort = new AbortController()
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
	return new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				const encoder = new TextEncoder()
				let sequence = 0
				let observed = afterSequence
				let forwarded = false
				const steps = new Map<
					string,
					{ attempt: number; item: string; text: string }
				>()
				const tools = new Map<string, { attempt: number; tool: Tool }>()
				const emit = (type: string, fields: Record<string, unknown> = {}) => {
					controller.enqueue(
						encoder.encode(
							Sse.encoder.write({
								_tag: "Event",
								event: type,
								id: undefined,
								data: JSON.stringify({
									type,
									chat: receipt.chat,
									turn: receipt.turn,
									sequence_number: sequence++,
									executionSequence:
										observed === 0 ? receipt.sequence : observed,
									executionId: receipt.executionId,
									...(receipt.commandKey === undefined
										? {}
										: { commandKey: receipt.commandKey }),
									...(receipt.inputItems === undefined
										? {}
										: { inputItems: receipt.inputItems }),
									...fields,
								}),
							}),
						),
					)
				}
				// This acknowledges the committed command, not that a model has started.
				if (acknowledge) emit("response.accepted")
				// The cursor may have advanced since the caller's activity read.
				// Refresh that snapshot once before following subsequent events.
				else emit("response.checkpoint")
				const project = (event: ExecutionEvent, rawTool: unknown) => {
					if (forwarded) return
					if (event.executionId !== receipt.executionId)
						throw new Error("The execution stream belongs to another command.")
					if (event.sequence <= observed) return
					observed = event.sequence
					const emitTool = (
						step: string,
						attempt: number,
						tool: Tool,
						status: "queued" | "ended",
					) =>
						emit("response.tool_activity", {
							toolActivity: {
								step,
								attempt,
								itemId: tool.itemId,
								callId: tool.callId,
								name: tool.name,
								computerId: tool.computerId ?? null,
								status,
							},
						})
					const begin = (body: { step: string; attempt: number }) => {
						let step = steps.get(body.step)
						if (step !== undefined && body.attempt < step.attempt)
							return undefined
						if (step === undefined) {
							// The native ModelSteps executor reserves this Item ID before
							// streaming and commits that same ID in the Chat checkpoint.
							if (!body.step.startsWith("model:") || body.step.length === 6)
								return undefined
							step = {
								attempt: body.attempt,
								item: body.step.slice(6),
								text: "",
							}
							steps.set(body.step, step)
						} else if (body.attempt > step.attempt) {
							step.attempt = body.attempt
							step.text = ""
							emit("response.output_text.delta", {
								item_id: step.item,
								text: "",
							})
						}
						return step
					}
					Match.value(event.body).pipe(
						Match.tags({
							StepStarted: (body) => {
								begin(body)
								// Older SDKs discard unknown fields. Validate the optional safe
								// projection independently, never reconstruct it from tool parameters.
								if (!Schema.is(Tool)(rawTool)) return
								const tool = Schema.decodeSync(Tool)(rawTool)
								if (
									tool.chatId !== receipt.chat ||
									tool.turnId !== receipt.turn ||
									body.step !==
										`tool:${tool.itemId.length}:${tool.itemId}${tool.callId}`
								)
									return
								const previous = tools.get(body.step)
								if (previous !== undefined && body.attempt <= previous.attempt)
									return
								tools.set(body.step, { attempt: body.attempt, tool })
								emitTool(body.step, body.attempt, tool, "queued")
							},
							Text: (body) => {
								if (receipt.turn === null) return
								const step = begin(body)
								if (step === undefined) return
								step.text += body.text
								emit("response.output_text.delta", {
									item_id: step.item,
									delta: body.text,
								})
							},
							StepCompleted: (body) => {
								const tool = tools.get(body.step)
								if (tool !== undefined && tool.attempt === body.attempt)
									emitTool(body.step, body.attempt, tool.tool, "ended")
								else if (
									body.step.startsWith("tool:") &&
									(tool === undefined || body.attempt > tool.attempt)
								)
									emit("response.checkpoint")
								const step = steps.get(body.step)
								if (
									step !== undefined &&
									step.attempt === body.attempt &&
									step.text !== ""
								)
									emit("response.output_text.done", {
										item_id: step.item,
										text: step.text,
									})
							},
							State: (body) => {
								const status =
									body.status === "completed"
										? "completed"
										: body.status === "failed"
											? "failed"
											: body.status === "cancelled" ||
												  body.status === "interrupted"
												? "cancelled"
												: "in_progress"
								emit(`response.${status}`, { response: { status } })
							},
							InputMoved: (body) => {
								// A Turn may move someone else's later input. Native receipt
								// items bind the move to this command; legacy Turns cannot guess.
								const inputItems = receipt.inputItems
								const belongsToCommand =
									inputItems === undefined
										? receipt.turn === null
										: body.items.some((item) => inputItems.includes(item))
								if (!belongsToCommand) {
									emit("response.checkpoint")
									return
								}
								forwarded = true
								emit("response.execution_moved", {
									executionId: body.executionId,
									turn: null,
								})
							},
						}),
						Match.orElse(() => {
							// Decisions, checkpoints and moved inputs prompt a read, never another send.
							emit("response.checkpoint")
						}),
					)
				}
				void (async () => {
					try {
						const response = await observe(abort.signal)
						if (!response.ok || response.body === null)
							throw new Error("The accepted execution could not be observed.")
						reader = response.body.getReader()
						const decoder = new TextDecoder()
						const parser = Sse.makeParser(
							(frame) => {
								if (frame._tag !== "Event") return
								if (frame.event !== "execution")
									throw new Error("The execution observation failed.")
								const raw = JSON.parse(frame.data)
								// Tool metadata is an optional projection. Validate it separately so
								// a bad projection cannot end an otherwise valid execution stream.
								const event =
									raw?.body?._tag === "StepStarted"
										? {
												...raw,
												body: Object.fromEntries(
													Object.entries(raw.body).filter(
														([key]) => key !== "tool",
													),
												),
											}
										: raw
								project(
									Schema.decodeUnknownSync(Api.ExecutionsApi.Execution.Event)(
										event,
									),
									raw?.body?.tool,
								)
							},
							{ maxEventSize: 1024 * 1024 },
						)
						while (!abort.signal.aborted) {
							const chunk = await reader.read()
							const error = parser.feed(
								decoder.decode(chunk.value, { stream: !chunk.done }),
							)
							if (error !== undefined) throw error
							if (chunk.done || forwarded) break
						}
						if (!abort.signal.aborted) controller.close()
					} catch (error) {
						if (!abort.signal.aborted) controller.error(error)
					} finally {
						await reader?.cancel().catch(() => {})
					}
				})()
			},
			cancel() {
				// Closing a reader must not cancel the durable execution or other chats.
				abort.abort()
				return reader?.cancel()
			},
		}),
		{
			headers: {
				"content-type": "text/event-stream",
				"cache-control": "no-store",
				"x-accel-buffering": "no",
			},
		},
	)
}
