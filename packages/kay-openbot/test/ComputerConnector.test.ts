import assert from "node:assert/strict"
import { once } from "node:events"
import { test } from "node:test"
import { NodeSocket } from "@effect/platform-node"
import { openNativeComputerSocket } from "../src/ComputerConnector.ts"

const receive = async (frames: ReadonlyArray<unknown>, expectClose = false) => {
	const server = new NodeSocket.NodeWS.WebSocketServer({
		port: 0,
		host: "127.0.0.1",
	})
	await once(server, "listening")
	const address = server.address()
	if (typeof address === "string" || address === null)
		throw new Error("Expected a TCP address")
	const messages: unknown[] = []
	let authorization: string | undefined
	let finish: () => void = () => {}
	const done = new Promise<void>((resolve) => {
		finish = resolve
	})
	server.on("connection", (socket, request) => {
		authorization = request.headers.authorization
		for (const frame of frames) socket.send(JSON.stringify(frame))
	})
	const connection = openNativeComputerSocket({
		origin: `http://127.0.0.1:${address.port}`,
		token: "test-connector",
		onOpen: () => {},
		onClose: () => {
			if (expectClose) finish()
		},
		onMessage: (message) => {
			messages.push(message)
			if (!expectClose && messages.length === frames.length) finish()
		},
	})
	try {
		await done
		assert.equal(authorization, "Bearer test-connector")
		return messages
	} finally {
		connection.close()
		for (const socket of server.clients) socket.terminate()
		await new Promise<void>((resolve, reject) =>
			server.close((error) =>
				error === undefined ? resolve() : reject(error),
			),
		)
	}
}

test(
	"computer socket preserves validated task activity and accepts legacy heartbeats",
	{ timeout: 5_000 },
	async () => {
		const frames = [
			{ _tag: "Ping" },
			{ _tag: "Ping", activity: "working" },
			{ _tag: "Ping", activity: "idle" },
			{ _tag: "Ping", activity: "unknown" },
			{ _tag: "Ping", activity: "idle", activityRequestId: "cleanup-check" },
		]
		assert.deepEqual(await receive(frames), frames)
	},
)

test(
	"computer socket preserves a cleanup probe across the pinned SDK",
	{ timeout: 5_000 },
	async () => {
		const server = new NodeSocket.NodeWS.WebSocketServer({
			port: 0,
			host: "127.0.0.1",
		})
		await once(server, "listening")
		const address = server.address()
		if (typeof address === "string" || address === null)
			throw new Error("Expected a TCP address")
		const accepted = once(server, "connection")
		let opened: () => void = () => {}
		const ready = new Promise<void>((resolve) => {
			opened = resolve
		})
		const connection = openNativeComputerSocket({
			origin: `http://127.0.0.1:${address.port}`,
			token: "test-connector",
			onOpen: opened,
			onClose: () => {},
			onMessage: () => {},
		})
		try {
			const [socket] = await accepted
			await ready
			const received = once(socket, "message")
			assert.equal(
				connection.send({ _tag: "Pong", activityRequestId: "cleanup-check" }),
				true,
			)
			const [bytes] = await received
			assert.deepEqual(JSON.parse(String(bytes)), {
				_tag: "Pong",
				activityRequestId: "cleanup-check",
			})
			assert.throws(() =>
				connection.send({ _tag: "Pong", activityRequestId: "" }),
			)
		} finally {
			connection.close()
			for (const socket of server.clients) socket.terminate()
			await new Promise<void>((resolve, reject) =>
				server.close((error) =>
					error === undefined ? resolve() : reject(error),
				),
			)
		}
	},
)

test(
	"computer socket rejects malformed task activity instead of treating it as idle",
	{ timeout: 5_000 },
	async () => {
		assert.deepEqual(
			await receive([{ _tag: "Ping", activity: false }], true),
			[],
		)
	},
)
