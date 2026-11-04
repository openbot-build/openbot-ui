import type { IncomingMessage, ServerResponse } from "node:http"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"

/** These callbacks authenticate the remote system themselves; they do not use a Kay browser session. */
export const publicNativeEndpoint = ({
	method,
	path,
}: {
	readonly method: string
	readonly path: string
}) =>
	(method === "POST" &&
		/^\/v1\/hooks\/(?:triggers|channels)\/[A-Za-z0-9_-]{1,128}$/.test(path)) ||
	(method === "POST" && path === "/v1/hooks/computers/pairings") ||
	(method === "POST" &&
		/^\/v1\/hooks\/computers\/pairings\/[A-Za-z0-9_-]{1,128}\/poll$/.test(
			path,
		)) ||
	(method === "GET" &&
		[
			"/v1/apps/client-metadata",
			"/v1/app-index/sources",
			"/v1/app-index/apps",
			"/v1/app-index/app",
		].includes(path))

export const nativeConnectorPath = "/v1/hooks/computers/connect"

/** Forward only native authentication and provider signatures, never an asserted user or organization. */
export const nativePublicHeaders = ({
	req,
	requestId,
}: {
	readonly req: IncomingMessage
	readonly requestId: string
}) => {
	const headers = new Headers({ "x-request-id": requestId })
	for (const name of [
		"authorization",
		"content-type",
		"content-encoding",
		"accept",
		"idempotency-key",
		"x-openbot-timestamp",
		"x-openbot-signature",
		"x-slack-request-timestamp",
		"x-slack-signature",
		"x-telegram-bot-api-secret-token",
		"x-lark-request-timestamp",
		"x-lark-request-nonce",
		"x-lark-signature",
	]) {
		const value = req.headers[name]
		if (typeof value === "string") headers.set(name, value)
	}
	return headers
}

/** Preserve the signed bytes. A provider gets one core request, with no JSON projection or automatic retry. */
export const relayNativePublic = async (input: {
	readonly req: IncomingMessage
	readonly res: ServerResponse
	readonly origin: string
	readonly url: URL
	readonly requestId: string
}) => {
	const { req, res } = input
	const chunks: Buffer[] = []
	let bytes = 0
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
		bytes += buffer.length
		if (bytes > 16 * 1024 * 1024) {
			res.writeHead(413, {
				"content-type": "application/json",
				"cache-control": "no-store",
			})
			res.end(
				JSON.stringify({
					code: "invalid_input",
					message: "The callback is too large.",
				}),
			)
			return
		}
		chunks.push(buffer)
	}
	const abort = new AbortController()
	const closed = () => abort.abort()
	res.once("close", closed)
	try {
		const response = await fetch(
			new URL(input.url.pathname + input.url.search, input.origin),
			{
				method: req.method ?? "GET",
				headers: nativePublicHeaders({ req, requestId: input.requestId }),
				...(req.method === "GET" ? {} : { body: Buffer.concat(chunks) }),
				redirect: "manual",
				signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)]),
			},
		)
		const headers: Record<string, string> = {
			"cache-control": "no-store",
			"x-accel-buffering": "no",
		}
		for (const name of ["content-type", "retry-after", "www-authenticate"]) {
			const value = response.headers.get(name)
			if (value !== null) headers[name] = value
		}
		res.writeHead(response.status, headers)
		if (response.body === null) res.end()
		else {
			const reader = response.body.getReader()
			async function* chunks() {
				try {
					while (true) {
						const part = await reader.read()
						if (part.done) return
						yield part.value
					}
				} finally {
					await reader.cancel()
					reader.releaseLock()
				}
			}
			await pipeline(Readable.from(chunks()), res)
		}
	} finally {
		res.off("close", closed)
	}
}
