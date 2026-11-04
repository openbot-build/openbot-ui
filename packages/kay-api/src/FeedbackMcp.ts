import type { IncomingMessage, ServerResponse } from "node:http"
import { Context, Effect, Layer, Schema } from "effect"
import { McpSchema, McpServer } from "effect/ai"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import * as Publisher from "@kaicom/k/McpPublisher"
import * as Document from "@kaicom/k/Document"
import * as Product from "@kaicom/kay-contracts"
import { FeedbackFailure, type Feedback } from "./Feedback.ts"

export const feedbackMcpPath = "/api/kay/v1/feedback/mcp"
export const feedbackRule =
	"When a Kay platform failure prevents progress, use Feedback2Platform from Kay platform feedback to submit a concise error report. Include expected and actual behavior and an error reference when available. Generate one UUID reportId per issue and reuse it for a retry. Never include credentials, cookies, raw logs, attachments or a complete conversation. Reporting does not repair the task; continue with a safe alternative when possible."
export interface FeedbackPublisher {
	readonly handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>
	readonly dispose: () => Promise<void>
}
export const makeFeedbackPublisher = ({
	feedback,
	origin,
}: {
	readonly feedback: Feedback
	readonly origin: string
}): FeedbackPublisher => {
	const register = Effect.gen(function* () {
		const server = yield* McpServer.McpServer
		const json = Schema.toJsonSchemaDocument(Product.FeedbackInput)
		const tool = yield* Schema.decodeUnknownEffect(McpSchema.Tool)({
			name: "Feedback2Platform",
			description:
				"Report a Kay platform error to its administrators. Submit only concise, necessary details. Never include credentials, raw logs, personal documents or a complete conversation. Reuse reportId for a retry. The conversation is not automatically identified.",
			inputSchema: {
				...json.schema,
				type: "object",
				...(Object.keys(json.definitions).length === 0
					? {}
					: { $defs: json.definitions }),
				additionalProperties: false,
			},
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		})
		yield* server.addTool({
			tool,
			annotations: Context.empty(),
			handle: (args) =>
				Effect.gen(function* () {
					yield* McpSchema.McpRequestContext
					const context = yield* Effect.context<never>()
					const request = Context.getOrUndefined(
						context,
						HttpServerRequest.HttpServerRequest,
					)
					const decoded = yield* Schema.decodeUnknownEffect(
						Product.FeedbackInput,
					)(args, { onExcessProperty: "error" }).pipe(
						Effect.mapError(() =>
							McpSchema.InvalidParams.make({
								message: "The report fields are invalid.",
							}),
						),
					)
					const result = yield* Effect.tryPromise(async () => {
						const owner = await feedback.authenticate(
							request?.headers["authorization"],
						)
						if (owner === null)
							throw new FeedbackFailure(
								401,
								"This reporting connection is not authorized.",
							)
						return feedback.submit(owner, decoded)
					}).pipe(
						Effect.match({
							onFailure: (error) => ({
								isError: true,
								text:
									error.cause instanceof FeedbackFailure
										? error.cause.message
										: "The report could not be accepted. Check the fields; keep the same reportId if its result is uncertain.",
							}),
							onSuccess: (receipt) => ({
								isError: false,
								text: JSON.stringify(receipt),
							}),
						}),
					)
					return McpSchema.CallToolResult.make({
						isError: result.isError,
						content: [
							McpSchema.TextContent.make({ type: "text", text: result.text }),
						],
					})
				}),
		})
	})
	const protection = HttpRouter.middleware(
		Effect.succeed((http) =>
			Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest
				if (new URL(request.originalUrl, origin).pathname !== feedbackMcpPath)
					return yield* http
				const owner = yield* Effect.tryPromise(() =>
					feedback.authenticate(request.headers["authorization"]),
				).pipe(Effect.catchCause(() => Effect.succeed(null)))
				if (owner === null)
					return HttpServerResponse.empty({
						status: 401,
						headers: { "cache-control": "no-store" },
					})
				return yield* http
			}),
		),
	)
	const app = HttpRouter.toWebHandler(
		Publisher.layer({
			publication: {
				card: {
					$schema: Document.cardSchemaUrl,
					name: "com.kai/feedback",
					version: "1.0.0",
					description: "Report Kay platform problems",
					remotes: [
						{
							type: "streamable-http",
							url: origin + feedbackMcpPath,
							supportedProtocolVersions: [Document.protocolVersion],
						},
					],
				},
				cardUrl: origin + "/api/kay/v1/feedback/card",
				catalogUrl: origin + "/api/kay/v1/feedback/catalog",
				mcpUrl: origin + feedbackMcpPath,
				noindex: true,
			},
			register,
		}).pipe(Layer.provide(protection.layer)),
		{ disableLogger: true },
	)
	return {
		dispose: app.dispose,
		handle: async (req, res) => {
			let size = 0
			const chunks: Buffer[] = []
			for await (const chunk of req) {
				const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
				size += bytes.length
				if (size > 16384) {
					res.writeHead(413)
					res.end()
					return
				}
				chunks.push(bytes)
			}
			const headers = new Headers()
			for (const [name, value] of Object.entries(req.headers))
				if (value !== undefined)
					headers.set(name, Array.isArray(value) ? value.join(", ") : value)
			const method = req.method ?? "GET"
			const response = await app.handler(
				new Request(origin + (req.url ?? "/"), {
					method,
					headers,
					...(method === "GET" || method === "HEAD"
						? {}
						: { body: Buffer.concat(chunks) }),
				}),
			)
			res.writeHead(response.status, Object.fromEntries(response.headers))
			if (response.body !== null)
				for await (const chunk of response.body) res.write(chunk)
			res.end()
		},
	}
}
