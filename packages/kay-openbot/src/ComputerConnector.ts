import { NodeSocket } from "@effect/platform-node"
import { ComputersApi } from "@openbot-build/client/Api"
import { Effect, Schema } from "effect"
import { Socket } from "effect/socket"

/** Use the pinned core's wire codecs without exporting an Effect runtime to Kay. */
export const openNativeComputerSocket = (input: {
	readonly origin: string
	readonly token: string
	readonly onOpen: () => void
	readonly onMessage: (message: unknown) => void
	readonly onClose: () => void
}) => {
	const target = new URL("/v1/hooks/computers/connect", input.origin)
	if (
		!["http:", "https:"].includes(target.protocol) ||
		target.username !== "" ||
		target.password !== ""
	)
		throw new Error(
			"Use the private core HTTP origin for a computer connector.",
		)
	target.protocol = target.protocol === "https:" ? "wss:" : "ws:"
	const make = Effect.runSync(
		// @effect-diagnostics-next-line strictEffectProvide:off -- This process boundary owns the native WebSocket constructor; its layer has no scoped resources.
		Effect.provide(
			Socket.WebSocketConstructor,
			NodeSocket.layerWebSocketConstructor,
		),
	)
	const socket = make(target.toString(), {
		headers: { authorization: `Bearer ${input.token}` },
	})
	let closed = false
	const close = () => {
		if (!closed) {
			closed = true
			socket.close(1000)
			input.onClose()
		}
	}
	socket.addEventListener("open", input.onOpen)
	socket.addEventListener("close", close)
	socket.addEventListener("error", close)
	socket.addEventListener("message", (event) => {
		try {
			if (
				typeof event.data !== "string" ||
				Buffer.byteLength(event.data) > 512 * 1024
			) {
				close()
				return
			}
			input.onMessage(
				Schema.decodeSync(Schema.fromJsonString(ComputersApi.ToConnector))(
					event.data,
				),
			)
		} catch {
			close()
		}
	})
	return {
		close,
		send: (message: unknown) => {
			if (closed || socket.readyState !== 1) return false
			if (
				"bufferedAmount" in socket &&
				typeof socket.bufferedAmount === "number" &&
				socket.bufferedAmount > 1024 * 1024
			) {
				close()
				return false
			}
			const value = Schema.decodeUnknownSync(ComputersApi.FromConnector)(
				message,
			)
			socket.send(
				Schema.encodeSync(Schema.fromJsonString(ComputersApi.FromConnector))(
					value,
				),
			)
			return true
		},
	}
}
