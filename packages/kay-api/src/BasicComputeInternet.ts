import { isPublicAddress } from "@kaicom/k/NodeHttpServer"
import { lookup } from "node:dns/promises"
import { chmod, lstat, unlink } from "node:fs/promises"
import {
	Agent,
	createServer,
	request,
	type IncomingHttpHeaders,
} from "node:http"
import { connect, isIP, type Socket } from "node:net"
import { dirname, isAbsolute } from "node:path"

const limits = {
	bytes: 128 * 1024 * 1024,
	requests: 256,
	connections: 8,
	timeoutMs: 90_000,
} as const

/** Supplied only by local tests, never by a request or environment variable. */
export interface InternetDependencies {
	readonly lookup?: (
		hostname: string,
	) => Promise<
		ReadonlyArray<{ readonly address: string; readonly family: number }>
	>
	readonly connect?: (address: string, port: number) => Socket
	readonly limits?: { readonly [K in keyof typeof limits]?: number }
}

const stripHopHeaders = (headers: IncomingHttpHeaders) => {
	const removed = new Set([
		"connection",
		"proxy-connection",
		"proxy-authorization",
		"proxy-authenticate",
		"keep-alive",
		"te",
		"trailer",
		"transfer-encoding",
		"upgrade",
		...(headers.connection ?? "")
			.toLowerCase()
			.split(",")
			.map((s) => s.trim()),
	])
	return Object.fromEntries(
		Object.entries(headers).filter(
			([name]) => !removed.has(name.toLowerCase()),
		),
	)
}

/** Public web access for one disposable workspace. The socket has no control API. */
export const startBasicComputeInternet = async (input: {
	readonly socketPath: string
	readonly authorize: () => Promise<void>
	readonly dependencies?: InternetDependencies
}): Promise<{ readonly close: () => Promise<void> }> => {
	const dependencies = input.dependencies ?? {}
	if (!isAbsolute(input.socketPath) || input.socketPath.includes("\0"))
		throw new Error("Use an absolute task internet socket path.")
	const directory = await lstat(dirname(input.socketPath))
	if (
		!directory.isDirectory() ||
		directory.isSymbolicLink() ||
		(directory.mode & 0o077) !== 0
	)
		throw new Error("Use a private directory for the task internet socket.")
	const budget = { ...limits, ...dependencies.limits }
	const resolve =
		dependencies.lookup ?? ((hostname) => lookup(hostname, { all: true }))
	const dial =
		dependencies.connect ??
		((address, port) => connect({ host: address, port }))
	// Socket callbacks own these mutable handles until their close events arrive.
	const clients = new Set<Socket>()
	const upstreams = new Set<Socket>()
	let bytes = 0
	let requests = 0
	let active = 0
	let closed = false
	let closing: Promise<void> | undefined
	const destroyAll = () => {
		for (const socket of clients) socket.destroy()
		for (const socket of upstreams) socket.destroy()
	}
	const count = (chunk: Buffer) => {
		bytes += chunk.length
		if (bytes > budget.bytes) destroyAll()
	}
	const address = async (hostname: string) => {
		const host = hostname.replace(/^\[|\]$/g, "")
		if (isIP(host) !== 0) {
			if (!isPublicAddress(host))
				throw new Error("Target is not a public address.")
			return host
		}
		const addresses = await resolve(host)
		if (
			addresses.length === 0 ||
			addresses.some((a) => !isPublicAddress(a.address))
		)
			throw new Error("Target is not a public address.")
		// Connect to this checked address, not to a hostname resolved for a second time.
		return addresses[0]!.address
	}
	const upstream = (host: string, port: number) => {
		const socket = dial(host, port)
		upstreams.add(socket)
		socket.on("data", count)
		socket.once("close", () => upstreams.delete(socket))
		return socket
	}
	const available = (socket: { readonly destroyed: boolean }) =>
		!closed && !socket.destroyed && bytes <= budget.bytes
	const claim = () => {
		requests++
		if (
			closed ||
			bytes > budget.bytes ||
			requests > budget.requests ||
			active >= budget.connections
		)
			return undefined
		active++
		let released = false
		return () => {
			if (released) return
			released = true
			active--
		}
	}
	const server = createServer({ maxHeaderSize: 16 * 1024 }, (req, res) => {
		const release = claim()
		res.setHeader("Connection", "close")
		if (release === undefined) {
			res.writeHead(429).end("Task internet limit reached.")
			return
		}
		res.once("close", release)
		void (async () => {
			const url = new URL(req.url ?? "")
			if (
				url.protocol !== "http:" ||
				(url.port !== "" && url.port !== "80") ||
				url.username !== "" ||
				url.password !== "" ||
				url.hash !== "" ||
				req.method === "CONNECT"
			)
				throw new Error("Unsupported public web target.")
			await input.authorize()
			if (!available(req.socket)) return
			const host = await address(url.hostname)
			if (!available(req.socket)) return
			const agent = new Agent({ keepAlive: false })
			agent.createConnection = () => upstream(host, 80)
			const target = request(
				{
					protocol: "http:",
					hostname: url.hostname,
					port: 80,
					path: url.pathname + url.search,
					method: req.method,
					headers: {
						...stripHopHeaders(req.headers),
						host: url.host,
						connection: "close",
					},
					agent,
				},
				(reply) => {
					res.writeHead(reply.statusCode ?? 502, {
						...stripHopHeaders(reply.headers),
						connection: "close",
					})
					reply.on("error", () => res.destroy())
					reply.pipe(res)
				},
			)
			res.once("close", () => {
				target.destroy()
				agent.destroy()
			})
			req.once("aborted", () => {
				target.destroy()
				res.destroy()
			})
			target.on("error", () => {
				if (!res.headersSent)
					res.writeHead(502).end("Public web request failed.")
				else res.destroy()
			})
			req.pipe(target)
		})().catch(() => {
			if (!res.headersSent)
				res
					.writeHead(403)
					.end("Public web access is unavailable for this request.")
			else res.destroy()
		})
	})
	server.maxRequestsPerSocket = 1
	server.headersTimeout = Math.min(budget.timeoutMs, 30_000)
	server.requestTimeout = budget.timeoutMs
	server.on("connection", (socket) => {
		if (closed || clients.size >= budget.connections || bytes > budget.bytes) {
			socket.destroy()
			return
		}
		clients.add(socket)
		socket.on("data", count)
		const timer = setTimeout(() => socket.destroy(), budget.timeoutMs)
		timer.unref()
		socket.once("close", () => {
			clearTimeout(timer)
			clients.delete(socket)
		})
		socket.on("error", () => socket.destroy())
	})
	server.on("connect", (req, client, head) => {
		const release = claim()
		if (release === undefined) {
			client.end("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n")
			return
		}
		client.once("close", release)
		void (async () => {
			const authority = req.url ?? ""
			const url = new URL("https://" + authority)
			if (
				authority !== url.host + (url.port === "" ? ":443" : "") ||
				(url.port !== "" && url.port !== "443") ||
				url.username !== "" ||
				url.password !== "" ||
				url.pathname !== "/" ||
				url.search !== "" ||
				url.hash !== ""
			)
				throw new Error("Unsupported public web tunnel.")
			await input.authorize()
			if (!available(client)) return
			const host = await address(url.hostname)
			if (!available(client)) return
			const target = upstream(host, 443)
			client.once("close", () => target.destroy())
			target.once("close", () => client.destroy())
			target.on("error", () => client.destroy())
			target.once("connect", () => {
				if (!available(client)) {
					target.destroy()
					return
				}
				client.write("HTTP/1.1 200 Connection Established\r\n\r\n")
				if (head.length > 0) target.write(head)
				client.pipe(target)
				target.pipe(client)
			})
		})().catch(() => {
			client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n")
		})
	})
	server.on("upgrade", (_req, socket) =>
		socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"),
	)
	server.on("clientError", (_error, socket) => socket.destroy())
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject)
		server.listen(input.socketPath, () => {
			server.off("error", reject)
			resolve()
		})
	})
	const owned = await lstat(input.socketPath)
	try {
		await chmod(input.socketPath, 0o666)
	} catch (error) {
		server.close()
		destroyAll()
		throw error
	}
	return {
		close: () => {
			if (closing !== undefined) return closing
			closed = true
			closing = (async () => {
				const disconnected = [...clients, ...upstreams].map(
					(socket) =>
						new Promise<void>((resolve) =>
							socket.once("close", () => resolve()),
						),
				)
				destroyAll()
				// Node closes a Unix listener by unlinking its pathname. Check before
				// that operation, not just before our fallback unlink below.
				const current = await lstat(input.socketPath).catch(
					(error: unknown) => {
						if (
							error instanceof Error &&
							"code" in error &&
							error.code === "ENOENT"
						)
							return undefined
						throw error
					},
				)
				if (
					current !== undefined &&
					(!current.isSocket() ||
						current.dev !== owned.dev ||
						current.ino !== owned.ino)
				)
					throw new Error(
						"Task internet socket ownership changed. Restore its path before cleanup.",
					)
				await new Promise<void>((resolve) => server.close(() => resolve()))
				await Promise.all(disconnected)
				try {
					const current = await lstat(input.socketPath)
					if (
						current.isSocket() &&
						current.dev === owned.dev &&
						current.ino === owned.ino
					)
						await unlink(input.socketPath)
				} catch (error) {
					if (!(
						error instanceof Error &&
						"code" in error &&
						error.code === "ENOENT"
					))
						throw error
				}
			})().catch((error: unknown) => {
				closing = undefined
				throw error
			})
			return closing
		},
	}
}
