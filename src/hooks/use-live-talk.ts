import { ExecutionsApi, LiveApi } from "@openbot-build/client/Api"
import { Option, Schema } from "effect"
import { useCallback, useEffect, useRef, useState } from "react"
import { type Capture, Player, startCapture } from "@/lib/live-audio"

/** What the page shows about a Live talk. */
export interface TalkState {
	readonly status: "idle" | "connecting" | "open"
	readonly error: string | undefined
	/** The microphone sends no sound. */
	readonly muted: boolean
	/** The person talks now, as the model hears it. */
	readonly hearing: boolean
	/** The sound of the Bot plays now. */
	readonly speaking: boolean
	/** A Turn runs now. */
	readonly working: boolean
	/** The text of what the person said in this Turn, so far. */
	readonly heard: string
	/** The text of the answer of the Bot in this Turn, so far. */
	readonly answer: string
	/** The model takes typed text in the talk. */
	readonly canType: boolean
}

const idle: TalkState = {
	status: "idle",
	error: undefined,
	muted: false,
	hearing: false,
	speaking: false,
	working: false,
	heard: "",
	answer: "",
	canType: false,
}

const decodeMessage = Schema.decodeUnknownOption(
	Schema.fromJsonString(LiveApi.LiveServerMessage),
)

/** The address of the Live WebSocket of a chat, on the origin of the page. */
const liveUrl = (chatId: string, organization: string | undefined) => {
	const url = new URL(`/v1/chats/${chatId}/live`, globalThis.location.href)
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
	// A browser cannot send the organization header with a WebSocket.
	if (organization !== undefined)
		url.searchParams.set("organization", organization)
	return url.href
}

interface Session {
	readonly socket: WebSocket
	readonly context: AudioContext
	capture: Capture | undefined
	player: Player | undefined
	ready: boolean
	muted: boolean
	truncate: boolean
	/** The answer item whose sound plays now. */
	item: string | undefined
}

/**
 * A Live talk in a live Chat: the microphone goes to the Bot, and the sound of
 * the Bot plays. `onTurnEnd` runs after each Turn, so the page can load the
 * history again. Then it clears the text of the Turn.
 */
export const useLiveTalk = ({
	chatId,
	organization,
	onTurnEnd,
}: {
	readonly chatId: string
	readonly organization: string | undefined
	readonly onTurnEnd: () => Promise<unknown>
}) => {
	const [state, setState] = useState<TalkState>(idle)
	const session = useRef<Session | undefined>(undefined)
	const turnEnd = useRef(onTurnEnd)
	turnEnd.current = onTurnEnd

	const patch = useCallback(
		(next: Partial<TalkState>) =>
			setState((current) => ({ ...current, ...next })),
		[],
	)

	const close = useCallback((error?: string) => {
		const current = session.current
		session.current = undefined
		if (current !== undefined) {
			current.capture?.stop()
			current.player?.stop()
			current.socket.onclose = null
			current.socket.close()
			void current.context.close()
		}
		setState({ ...idle, error })
	}, [])

	const send = (message: LiveApi.LiveClientMessage) => {
		const socket = session.current?.socket
		if (socket?.readyState === WebSocket.OPEN)
			socket.send(JSON.stringify(message))
	}

	const onMessage = (current: Session, message: LiveApi.LiveServerMessage) => {
		switch (message.type) {
			case "session.reconnect":
				close(message.message)
				void turnEnd.current()
				return
			case "session.ready": {
				if (message.audio.input.encoding !== "pcm16") {
					close("This Live model does not take sound that a browser can send.")
					return
				}
				if (message.audio.output.encoding !== "pcm16") {
					close("This Live model sends sound that a browser cannot play.")
					return
				}
				current.ready = true
				current.truncate = message.capabilities.truncate
				current.player = new Player(
					current.context,
					message.audio.output.sampleRate,
					(speaking) => {
						if (session.current === current) patch({ speaking })
					},
				)
				patch({
					status: "open",
					canType: message.capabilities.inputs.text,
				})
				startCapture(
					current.context,
					message.audio.input.sampleRate,
					(chunk) => {
						if (!current.muted && current.socket.readyState === WebSocket.OPEN)
							current.socket.send(chunk)
					},
				).then(
					(capture) => {
						if (session.current === current) current.capture = capture
						else capture.stop()
					},
					() => {
						if (session.current === current)
							close("Allow the microphone to talk with the Bot.")
					},
				)
				return
			}
			case "input.speech.started":
				patch({ hearing: true })
				return
			case "input.speech.stopped":
				patch({ hearing: false })
				return
			case "input.transcript":
				patch({ heard: message.text })
				return
			case "output.transcript.delta":
				current.item = message.itemId
				setState((state) => ({
					...state,
					answer: state.answer + message.delta,
				}))
				return
			case "output.done":
				current.item = undefined
				current.player?.newItem()
				return
			case "output.stop": {
				const heard = current.player?.stop() ?? 0
				if (current.truncate && current.item !== undefined)
					send({
						type: "output.truncate",
						itemId: current.item,
						audioEndMs: heard,
					})
				current.item = undefined
				return
			}
			case "turn.started":
				patch({ working: true })
				return
			case "turn.completed":
				patch({ working: false })
				void turnEnd.current().finally(() => {
					if (session.current === current) patch({ heard: "", answer: "" })
				})
				return
			case "error":
				patch({ error: message.message })
				return
		}
	}

	const start = useCallback(() => {
		if (session.current !== undefined) return
		// The click starts the sound, so the browser lets it play.
		const context = new AudioContext()
		void context.resume()
		const socket = new WebSocket(liveUrl(chatId, organization))
		socket.binaryType = "arraybuffer"
		const current: Session = {
			socket,
			context,
			capture: undefined,
			player: undefined,
			ready: false,
			muted: false,
			truncate: false,
			item: undefined,
		}
		session.current = current
		setState({ ...idle, status: "connecting" })
		socket.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
			if (session.current !== current) return
			if (typeof event.data === "string") {
				const message = decodeMessage(event.data)
				if (Option.isSome(message)) onMessage(current, message.value)
			} else current.player?.play(event.data)
		}
		socket.onclose = () => {
			if (session.current !== current) return
			close(
				current.ready
					? undefined
					: "The live talk did not start. Check that the chat has a Live model, and try again.",
			)
			void turnEnd.current()
		}
	}, [chatId, organization])

	const setMuted = useCallback(
		(muted: boolean) => {
			const current = session.current
			if (current === undefined) return
			current.muted = muted
			// Forget the sound from before the mute, so the model does not answer it.
			if (muted) send({ type: "input.audio.clear" })
			patch({ muted })
		},
		[patch],
	)

	// The talk ends when the page goes away.
	useEffect(() => () => close(), [close])

	return {
		state,
		start,
		stop: () => close(),
		setMuted,
		sendText: (text: string) =>
			send({
				type: "input.text",
				commandKey: ExecutionsApi.Execution.CommandKey.make(
					crypto.randomUUID(),
				),
				text,
			}),
		cancel: () =>
			send({
				type: "response.cancel",
				commandKey: ExecutionsApi.Execution.CommandKey.make(
					crypto.randomUUID(),
				),
			}),
	}
}
