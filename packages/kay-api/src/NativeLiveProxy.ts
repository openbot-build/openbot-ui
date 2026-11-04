import {
	request as httpRequest,
	type IncomingMessage,
	type Server,
} from "node:http"
import { request as httpsRequest } from "node:https"
import type { Duplex } from "node:stream"
import { randomUUID } from "node:crypto"
import type { Telemetry } from "./Telemetry.ts"
import { nativeConnectorPath } from "./NativePublic.ts"

export class LiveProxyFailure extends Error {
	readonly status: number
	readonly code: string
	constructor(status: number, code: string, message: string) {
		super(message)
		this.status = status
		this.code = code
	}
}

export type LiveAdmission = {
	readonly target: URL
	readonly headers: Headers
	readonly release: () => Promise<void>
	readonly revalidate: (signal: AbortSignal) => Promise<boolean>
}

const closers = new WeakMap<Server, () => void>()

/** HTTP server shutdown does not close upgraded sockets. Call before server.close(). */
export const closeNativeLiveProxy = (server: Server) => closers.get(server)?.()

/** Tunnel the native protocol, including binary audio, without interpreting or replaying it. */
export const attachNativeLiveProxy = ({
	server,
	publicOrigin,
	authorize,
	telemetry,
	connector = false,
	handshakeTimeoutMs = 10_000,
	revalidateEveryMs = 15_000,
	maxDurationMs = 55 * 60_000,
}: {
	readonly server: Server
	readonly publicOrigin: string
	readonly authorize: (
		req: IncomingMessage,
		url: URL,
		requestId: string,
		signal: AbortSignal,
	) => Promise<LiveAdmission>
	readonly telemetry: Telemetry
	readonly connector?: boolean
	readonly handshakeTimeoutMs?: number
	readonly revalidateEveryMs?: number
	readonly maxDurationMs?: number
}) => {
	const connections = new Set<() => void>()
	const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
		const requestId = randomUUID()
		const abort = new AbortController()
		let admission: LiveAdmission | undefined
		let upstream: Duplex | undefined
		let upstreamRequest: ReturnType<typeof httpRequest> | undefined
		let finished = false
		let upgraded = false
		let rejecting = false
		let checkTimer: ReturnType<typeof setTimeout> | undefined
		let lifetime: ReturnType<typeof setTimeout> | undefined
		let validationDeadline: ReturnType<typeof setTimeout> | undefined
		const release = () => {
			const current = admission
			admission = undefined
			if (current !== undefined)
				void current
					.release()
					.catch(() => telemetry.increment("live_lease_release_failed"))
		}
		const finish = () => {
			if (finished) return
			finished = true
			clearTimeout(handshake)
			clearTimeout(checkTimer)
			clearTimeout(lifetime)
			clearTimeout(validationDeadline)
			abort.abort()
			upstreamRequest?.destroy()
			upstream?.destroy()
			socket.destroy()
			connections.delete(finish)
			release()
			if (upgraded) telemetry.increment("live_closed")
		}
		const reject = (status: number, code: string, message: string) => {
			if (finished || rejecting) return
			rejecting = true
			clearTimeout(handshake)
			lifetime = setTimeout(finish, 1_000)
			lifetime.unref()
			telemetry.increment("live_rejected")
			const body = JSON.stringify({ code, message, requestId })
			// Complete the HTTP rejection before closing; no redirect or upstream body is forwarded.
			socket.end(
				`HTTP/1.1 ${status} Request Rejected\r\nConnection: close\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nX-Request-Id: ${requestId}\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
				finish,
			)
		}
		const handshake = setTimeout(() => {
			reject(504, "unavailable", "The live connection timed out.")
			abort.abort()
		}, handshakeTimeoutMs)
		handshake.unref()
		connections.add(finish)
		socket.once("close", finish)
		socket.once("end", finish)
		socket.once("error", finish)
		const revalidate = () => {
			checkTimer = setTimeout(() => {
				const current = admission
				if (finished || current === undefined) return
				validationDeadline = setTimeout(finish, 5_000)
				validationDeadline.unref()
				void current
					.revalidate(
						AbortSignal.any([abort.signal, AbortSignal.timeout(5_000)]),
					)
					.then((valid) => {
						clearTimeout(validationDeadline)
						if (valid && !finished) revalidate()
						else finish()
					})
					.catch(finish)
			}, revalidateEveryMs)
			checkTimer.unref()
		}
		void (async () => {
			const url = new URL(req.url ?? "/", publicOrigin)
			const computer = connector && url.pathname === nativeConnectorPath
			if (
				!computer &&
				!/^\/api\/kay\/v1\/chats\/[^/]+\/live$/.test(url.pathname)
			)
				throw new LiveProxyFailure(
					404,
					"not_found",
					"This live endpoint does not exist.",
				)
			if (
				req.method !== "GET" ||
				(!computer && req.headers.origin !== publicOrigin)
			)
				throw new LiveProxyFailure(
					403,
					"forbidden",
					"Connect to Live from Kay.",
				)
			if (
				req.headers.upgrade?.toLowerCase() !== "websocket" ||
				req.headers["sec-websocket-version"] !== "13" ||
				typeof req.headers["sec-websocket-key"] !== "string"
			)
				throw new LiveProxyFailure(
					400,
					"invalid",
					"A WebSocket handshake is required.",
				)
			const acquired = await authorize(req, url, requestId, abort.signal)
			if (finished || abort.signal.aborted) {
				await acquired.release()
				return
			}
			admission = acquired
			const headers = Object.fromEntries(acquired.headers)
			headers["connection"] = "Upgrade"
			headers["upgrade"] = "websocket"
			for (const name of [
				"sec-websocket-key",
				"sec-websocket-version",
				"sec-websocket-protocol",
				"sec-websocket-extensions",
			] as const) {
				const value = req.headers[name]
				if (typeof value === "string") headers[name] = value
			}
			const request =
				acquired.target.protocol === "https:" ? httpsRequest : httpRequest
			upstreamRequest = request(acquired.target, {
				method: "GET",
				headers,
				signal: abort.signal,
			})
			upstreamRequest.once("response", (response) => {
				const status = response.statusCode ?? 502
				response.destroy()
				reject(
					status >= 400 && status <= 599 ? status : 502,
					status === 401
						? "unauthorized"
						: status === 403
							? "forbidden"
							: "unavailable",
					"OpenBot could not open this live connection.",
				)
			})
			upstreamRequest.once("error", () => {
				if (upgraded) finish()
				else
					reject(502, "unavailable", "The live connection could not be opened.")
			})
			upstreamRequest.once("upgrade", (response, remote, remoteHead) => {
				if (finished) {
					remote.destroy()
					return
				}
				if (response.statusCode !== 101) {
					remote.destroy()
					reject(
						502,
						"unavailable",
						"The server did not accept the live connection.",
					)
					return
				}
				upstream = remote
				upgraded = true
				clearTimeout(handshake)
				telemetry.increment("live_opened")
				const responseHeaders = [
					"HTTP/1.1 101 Switching Protocols",
					"Connection: Upgrade",
					"Upgrade: websocket",
					`X-Request-Id: ${requestId}`,
				]
				for (const name of [
					"sec-websocket-accept",
					"sec-websocket-protocol",
					"sec-websocket-extensions",
				] as const) {
					const value = response.headers[name]
					if (typeof value === "string")
						responseHeaders.push(`${name}: ${value}`)
				}
				socket.write(responseHeaders.join("\r\n") + "\r\n\r\n")
				if (remoteHead.length > 0) socket.write(remoteHead)
				if (head.length > 0) remote.write(head)
				remote.once("close", finish)
				remote.once("end", finish)
				remote.once("error", finish)
				remote.pipe(socket)
				socket.pipe(remote)
				if (!computer) {
					lifetime = setTimeout(finish, maxDurationMs)
					lifetime.unref()
					revalidate()
				}
			})
			upstreamRequest.end()
		})().catch((error: unknown) => {
			if (error instanceof LiveProxyFailure)
				reject(error.status, error.code, error.message)
			else reject(503, "unavailable", "Live is temporarily unavailable.")
		})
	}
	server.on("upgrade", onUpgrade)
	const close = () => {
		for (const finish of connections) finish()
	}
	closers.set(server, close)
	server.once("close", () => {
		close()
		closers.delete(server)
	})
	return close
}
