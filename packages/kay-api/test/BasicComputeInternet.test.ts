import assert from "node:assert/strict"
import { once } from "node:events"
import {
	chmod,
	lstat,
	mkdtemp,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises"
import {
	createServer as httpServer,
	request,
	type IncomingMessage,
	type RequestListener,
} from "node:http"
import { connect, createServer as tcpServer, type Socket } from "node:net"
import { test, type TestContext } from "node:test"
import {
	startBasicComputeInternet,
	type InternetDependencies,
} from "../src/BasicComputeInternet.ts"

const fixture = async (
	t: TestContext,
	dependencies: InternetDependencies = {},
	authorize = async () => {},
) => {
	const directory = await mkdtemp("/tmp/kay-net-")
	await chmod(directory, 0o700)
	const socketPath = directory + "/web.sock"
	const proxy = await startBasicComputeInternet({
		socketPath,
		authorize,
		dependencies,
	})
	t.after(async () => {
		await proxy.close()
		await rm(directory, { recursive: true, force: true })
	})
	return { ...proxy, socketPath, directory }
}
const read = (
	socketPath: string,
	path: string,
	options: {
		readonly method?: string
		readonly body?: string
		readonly headers?: Record<string, string>
	} = {},
) =>
	new Promise<{
		status: number
		text: string
		headers: IncomingMessage["headers"]
	}>((resolve, reject) => {
		const req = request(
			{
				socketPath,
				path,
				method: options.method ?? "GET",
				headers: options.headers ?? {},
			},
			(res) => {
				let text = ""
				res.on("data", (data) => {
					text += String(data)
				})
				res.on("error", reject)
				res.on("end", () =>
					resolve({ status: res.statusCode!, text, headers: res.headers }),
				)
			},
		)
		req.on("error", reject)
		req.end(options.body)
	})
const localHttp = async (t: TestContext, handler: RequestListener) => {
	const server = httpServer(handler)
	server.listen(0, "127.0.0.1")
	await once(server, "listening")
	const address = server.address()
	assert.ok(address !== null && typeof address !== "string")
	t.after(async () => {
		server.closeAllConnections()
		await new Promise<void>((resolve) => server.close(() => resolve()))
	})
	return address.port
}
const tunnel = async (socketPath: string, authority = "public.test:443") => {
	const socket = connect({ path: socketPath })
	await once(socket, "connect")
	socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`)
	return socket
}
const closed = (socket: Socket) =>
	new Promise<void>((resolve) => socket.once("close", () => resolve()))
const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }]

test("public HTTP preserves methods, paths and bodies without forwarding proxy or hop headers", async (t) => {
	let authorization = 0
	const received: Array<{
		host: string | undefined
		path: string | undefined
		body: string
		proxy: string | string[] | undefined
		secret: string | string[] | undefined
	}> = []
	const port = await localHttp(t, (req, res) => {
		let body = ""
		req.on("data", (chunk) => {
			body += String(chunk)
		})
		req.on("end", () => {
			received.push({
				host: req.headers.host,
				path: req.url,
				body,
				proxy: req.headers["proxy-authorization"],
				secret: req.headers["x-remove"],
			})
			res.setHeader("Connection", "x-hidden")
			res.setHeader("x-hidden", "private")
			res.end("public result")
		})
	})
	const connections: Array<{ address: string; port: number }> = []
	const proxy = await fixture(
		t,
		{
			lookup: publicLookup,
			connect: (address, targetPort) => {
				connections.push({ address, port: targetPort })
				return connect({ host: "127.0.0.1", port })
			},
		},
		async () => {
			authorization++
		},
	)
	const result = await read(
		proxy.socketPath,
		"http://public.test/search?q=hello",
		{
			method: "POST",
			body: "query",
			headers: {
				Host: "internal.test",
				"Proxy-Authorization": "secret",
				Connection: "x-remove",
				"x-remove": "secret",
			},
		},
	)
	assert.equal(result.status, 200)
	assert.equal(result.text, "public result")
	assert.equal(result.headers["x-hidden"], undefined)
	assert.deepEqual(received, [
		{
			host: "public.test",
			path: "/search?q=hello",
			body: "query",
			proxy: undefined,
			secret: undefined,
		},
	])
	assert.deepEqual(connections, [{ address: "93.184.216.34", port: 80 }])
	assert.equal(authorization, 1)
	assert.equal((await lstat(proxy.socketPath)).mode & 0o777, 0o666)
})

test("CONNECT forwards bytes to the checked public address and close stops both sides", async (t) => {
	const sockets = new Set<Socket>()
	const target = tcpServer((socket) => {
		sockets.add(socket)
		socket.on("close", () => sockets.delete(socket))
		socket.pipe(socket)
	})
	target.listen(0, "127.0.0.1")
	await once(target, "listening")
	const address = target.address()
	assert.ok(address !== null && typeof address !== "string")
	t.after(async () => {
		for (const socket of sockets) socket.destroy()
		await new Promise<void>((resolve) => target.close(() => resolve()))
	})
	const proxy = await fixture(t, {
		lookup: publicLookup,
		connect: (host, port) => {
			assert.equal(host, "93.184.216.34")
			assert.equal(port, 443)
			return connect({ host: "127.0.0.1", port: address.port })
		},
	})
	const socket = await tunnel(proxy.socketPath)
	assert.match(String((await once(socket, "data"))[0]), /^HTTP\/1.1 200 /)
	socket.write("encrypted payload")
	assert.equal(String((await once(socket, "data"))[0]), "encrypted payload")
	const finished = closed(socket)
	await proxy.close()
	await finished
	await assert.rejects(lstat(proxy.socketPath), { code: "ENOENT" })
	await proxy.close()
})

test("private literal, mapped, metadata, and mixed DNS targets never open an upstream socket", async (t) => {
	let connections = 0
	const proxy = await fixture(t, {
		lookup: async () => [
			{ address: "93.184.216.34", family: 4 },
			{ address: "127.0.0.1", family: 4 },
		],
		connect: () => {
			connections++
			throw new Error("Must not connect")
		},
	})
	for (const path of [
		"http://127.0.0.1/",
		"http://2130706433/",
		"http://169.254.169.254/latest/meta-data/",
		"http://100.100.100.200/",
		"http://[::1]/",
		"http://[::ffff:127.0.0.1]/",
		"http://mixed.test/",
	]) {
		assert.equal((await read(proxy.socketPath, path)).status, 403, path)
	}
	const socket = await tunnel(proxy.socketPath, "127.0.0.1:443")
	assert.match(String((await once(socket, "data"))[0]), /^HTTP\/1.1 403 /)
	socket.destroy()
	assert.equal(connections, 0)
})

test("authorization is checked for every request and revoked access opens no connection", async (t) => {
	let checks = 0
	let connections = 0
	const proxy = await fixture(
		t,
		{
			lookup: publicLookup,
			connect: () => {
				connections++
				throw new Error("Must not connect")
			},
		},
		async () => {
			checks++
			throw new Error("Private account detail")
		},
	)
	for (let index = 0; index < 2; index++) {
		const result = await read(
			proxy.socketPath,
			"http://public.test/private?token=secret",
		)
		assert.equal(result.status, 403)
		assert.ok(
			!result.text.includes("secret") && !result.text.includes("account"),
		)
	}
	assert.equal(checks, 2)
	assert.equal(connections, 0)
})

test("redirects do not bypass target checks and unsupported ports and schemes are rejected", async (t) => {
	let connections = 0
	const port = await localHttp(t, (_req, res) =>
		res.writeHead(302, { location: "http://127.0.0.1/private" }).end(),
	)
	const proxy = await fixture(t, {
		lookup: publicLookup,
		connect: () => {
			connections++
			return connect({ host: "127.0.0.1", port })
		},
	})
	const redirect = await read(proxy.socketPath, "http://public.test/")
	assert.equal(redirect.status, 302)
	assert.equal(
		(await read(proxy.socketPath, redirect.headers.location!)).status,
		403,
	)
	for (const url of [
		"http://public.test:8080/",
		"https://public.test/",
		"file:///etc/passwd",
		"http://user:pass@public.test/",
	])
		assert.equal((await read(proxy.socketPath, url)).status, 403)
	const socket = await tunnel(proxy.socketPath, "public.test:22")
	assert.match(String((await once(socket, "data"))[0]), /^HTTP\/1.1 403 /)
	socket.destroy()
	assert.equal(connections, 1)
})

test("request budget is shared and slow headers cannot hold the workspace indefinitely", async (t) => {
	const proxy = await fixture(
		t,
		{ limits: { requests: 1, timeoutMs: 100 } },
		async () => {
			throw new Error("Denied")
		},
	)
	assert.equal(
		(await read(proxy.socketPath, "http://public.test/")).status,
		403,
	)
	assert.equal(
		(await read(proxy.socketPath, "http://public.test/")).status,
		429,
	)
	const slow = connect({ path: proxy.socketPath })
	await once(slow, "connect")
	const ended = closed(slow)
	slow.write("GET http://public.test/ HTTP/1.1\r\n")
	await ended
})

test("one lease bounds concurrent connections and total traffic", async (t) => {
	const proxy = await fixture(t, {
		limits: { connections: 1, bytes: 256, timeoutMs: 1000 },
	})
	const first = connect({ path: proxy.socketPath })
	await once(first, "connect")
	const second = connect({ path: proxy.socketPath })
	second.on("error", () => {})
	const secondEnded = closed(second)
	await secondEnded
	const firstEnded = closed(first)
	first.write("x".repeat(300))
	await firstEnded
	await assert.rejects(read(proxy.socketPath, "http://public.test/"))
})

test("a late authorization result after close cannot start a new connection", async (t) => {
	let approve: () => void = () => {}
	let entered: () => void = () => {}
	const checking = new Promise<void>((resolve) => {
		entered = resolve
	})
	const pending = new Promise<void>((resolve) => {
		approve = resolve
	})
	let connections = 0
	const proxy = await fixture(
		t,
		{
			lookup: publicLookup,
			connect: () => {
				connections++
				throw new Error("Must not connect")
			},
		},
		async () => {
			entered()
			await pending
		},
	)
	const response = read(proxy.socketPath, "http://public.test/").catch(
		() => undefined,
	)
	await checking
	await proxy.close()
	approve()
	await response
	await new Promise<void>((resolve) => setImmediate(resolve))
	assert.equal(connections, 0)
})

test("startup never removes an existing socket", async (t) => {
	const proxy = await fixture(t)
	const before = await lstat(proxy.socketPath)
	await assert.rejects(
		startBasicComputeInternet({
			socketPath: proxy.socketPath,
			authorize: async () => {},
		}),
		{ code: "EADDRINUSE" },
	)
	const after = await lstat(proxy.socketPath)
	assert.equal(after.ino, before.ino)
	assert.equal(after.dev, before.dev)
})

test("cleanup refuses to remove a replaced socket path", async (t) => {
	const proxy = await fixture(t)
	const saved = proxy.directory + "/original.sock"
	await rename(proxy.socketPath, saved)
	await writeFile(proxy.socketPath, "replacement")
	await assert.rejects(proxy.close(), /ownership changed/)
	assert.equal(await readFile(proxy.socketPath, "utf8"), "replacement")
	await rm(proxy.socketPath)
	await rename(saved, proxy.socketPath)
	await proxy.close()
})
