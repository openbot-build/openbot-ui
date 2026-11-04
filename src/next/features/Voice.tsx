import { t } from "@lingui/core/macro"
import type * as Product from "@kaicom/kay-contracts"
import { RequestFailed, type Client } from "@kaicom/kay-contracts/Client"
import { useEffect, useRef, useState } from "react"
import { createWebSocket, nativeRuntime } from "../../lib/runtime"
import { watchAppPause } from "../../lib/app-lifecycle"
import {
	ImagePlus,
	Mic,
	MicOff,
	PhoneOff,
	Play,
	RefreshCw,
	Square,
} from "lucide-react"
import { Button } from "../../components/ui/button"
import { PcmEncoder, decodePcm } from "./Audio"
import {
	ConnectionLifetime,
	LiveCreation,
	type CreationReceipt,
} from "./VoiceState"
import { objectOf } from "./SchemaForm"

interface Format {
	readonly encoding: string
	readonly sampleRate: number
}
interface Ready {
	readonly input: Format
	readonly output: Format
	readonly detection: string
	readonly text: boolean
	readonly image: boolean
	readonly truncate: boolean
	readonly interruption: boolean
	readonly voices: readonly string[]
}
const savedReceipt = (key: string): CreationReceipt | undefined => {
	try {
		const value = objectOf(JSON.parse(sessionStorage.getItem(key) ?? "null"))
		return typeof value["chatId"] === "string" &&
			["idle", "pending", "unknown", "known"].includes(String(value["phase"]))
			? (value as unknown as CreationReceipt)
			: undefined
	} catch {
		return undefined
	}
}
const audioFormat = (value: unknown): Format => {
	const fields = objectOf(value)
	if (
		typeof fields["sampleRate"] !== "number" ||
		!Number.isFinite(fields["sampleRate"]) ||
		fields["sampleRate"] <= 0 ||
		fields["encoding"] !== "pcm16"
	)
		throw new Error("The server did not select a supported PCM audio format.")
	return { encoding: "pcm16", sampleRate: fields["sampleRate"] }
}
export function Voice({
	client,
	bootstrap,
	onOpenChat,
}: {
	readonly client: Client
	readonly bootstrap: Product.Bootstrap
	readonly onOpenChat: (id: string) => void
}) {
	const receiptKey = `kay.live.receipt.${bootstrap.identity.organizationId}.${bootstrap.identity.userId}`
	const [receipt, setReceipt] = useState(
		() => new LiveCreation(savedReceipt(receiptKey)).snapshot,
	)
	const creation = useRef(new LiveCreation(receipt))
	const botId = bootstrap.defaultBotId ?? ""
	const [chatId, setChat] = useState(receipt.chatId)
	const [status, setStatus] = useState<
		"idle" | "connecting" | "connected" | "closed"
	>("idle")
	const [error, setError] = useState<string | null>(null)
	const [ready, setReady] = useState<Ready | null>(null)
	const [capturing, setCapturing] = useState(false)
	const [capturePending, setCapturePending] = useState(false)
	const [text, setText] = useState("")
	const [voice, setVoice] = useState("")
	const [voices, setVoices] = useState<readonly string[]>([])
	const [detection, setDetection] = useState("server")
	const [transcripts, setTranscripts] = useState<Record<string, string>>({})
	const [savedChats, setSavedChats] = useState<
		readonly { id: string; createdAt: number }[]
	>([])
	const [reading, setReading] = useState(false)
	const lifetime = useRef(new ConnectionLifetime())
	const socket = useRef<WebSocket | null>(null)
	const context = useRef<AudioContext | null>(null)
	const microphone = useRef<MediaStream | null>(null)
	const capture = useRef<AudioWorkletNode | null>(null)
	const inputNode = useRef<MediaStreamAudioSourceNode | null>(null)
	const encoder = useRef<PcmEncoder | null>(null)
	const captureGeneration = useRef(0)
	const captureStarting = useRef(false)
	const outputs = useRef(new Set<AudioBufferSourceNode>())
	const playAt = useRef(0)
	const outputStart = useRef<number | null>(null)
	const nextOutput = useRef(true)
	const currentOutput = useRef<{ id: string; started: number } | null>(null)
	const mounted = useRef(true)
	const format = useRef<Ready | null>(null)
	const connecting = useRef(false)
	const worklet = useRef<AudioContext | null>(null)
	const persist = () => {
		const value = creation.current.snapshot
		try {
			sessionStorage.setItem(receiptKey, JSON.stringify(value))
		} catch {
			/* Browser storage can be unavailable. The in-memory receipt still prevents a retry. */
		}
		if (mounted.current) setReceipt(value)
	}
	const stopSound = () => {
		for (const source of outputs.current) {
			try {
				source.stop()
			} catch {
				/* It may already have ended. */
			}
		}
		outputs.current.clear()
		playAt.current = 0
		currentOutput.current = null
		outputStart.current = null
		nextOutput.current = true
	}
	const stopCapture = () => {
		captureGeneration.current++
		captureStarting.current = false
		capture.current?.disconnect()
		inputNode.current?.disconnect()
		capture.current = null
		inputNode.current = null
		encoder.current = null
		microphone.current?.getTracks().forEach((track) => track.stop())
		microphone.current = null
		if (mounted.current) {
			setCapturing(false)
			setCapturePending(false)
		}
	}
	const disconnect = () => {
		stopCapture()
		stopSound()
		lifetime.current.close()
		socket.current = null
		context.current = null
		worklet.current = null
		format.current = null
		connecting.current = false
		if (mounted.current) {
			setReady(null)
			setStatus("closed")
		}
	}
	useEffect(() => {
		mounted.current = true
		const stopWatching = watchAppPause(window, disconnect, nativeRuntime())
		return () => {
			stopWatching()
			mounted.current = false
			disconnect()
		}
	}, [])
	const send = (message: unknown) => {
		if (socket.current?.readyState === WebSocket.OPEN)
			socket.current.send(JSON.stringify(message))
	}
	const cancel = () => {
		if (
			format.current?.truncate === true &&
			currentOutput.current !== null &&
			context.current !== null
		)
			send({
				type: "output.truncate",
				itemId: currentOutput.current.id,
				audioEndMs: Math.max(
					0,
					Math.floor(
						(context.current.currentTime - currentOutput.current.started) *
							1000,
					),
				),
			})
		send({ type: "response.cancel" })
		stopSound()
	}
	const findChats = async () => {
		setReading(true)
		setError(null)
		try {
			const result = await client.featureCall("chats.listChats", {
				query: { kind: "live", bot: botId },
			})
			if (!mounted.current) return
			if (!Array.isArray(result))
				throw new Error(t`The saved voice conversations could not be read.`)
			setSavedChats(
				result
					.flatMap((value) => {
						const chat = objectOf(objectOf(value)["chat"])
						return typeof chat["id"] === "string" && chat["kind"] === "live"
							? [
									{
										id: chat["id"],
										createdAt:
											typeof chat["createdAt"] === "number"
												? chat["createdAt"]
												: 0,
									},
								]
							: []
					})
					.sort((a, b) => b.createdAt - a.createdAt),
			)
		} catch (failure) {
			if (mounted.current)
				setError(
					failure instanceof Error
						? failure.message
						: t`Saved conversations could not be loaded.`,
				)
		} finally {
			if (mounted.current) setReading(false)
		}
	}
	const connect = async () => {
		if (
			connecting.current ||
			socket.current !== null ||
			receipt.phase === "pending" ||
			(chatId === "" && receipt.phase === "unknown")
		)
			return
		connecting.current = true
		const attempt = lifetime.current.begin()
		setError(null)
		setStatus("connecting")
		try {
			const audio = new AudioContext()
			context.current = audio
			lifetime.current.track(attempt, () => {
				if (audio.state !== "closed") void audio.close().catch(() => undefined)
			})
			await audio.resume()
			if (!mounted.current || !lifetime.current.current(attempt)) return
			let id = chatId
			if (id === "") {
				creation.current.begin()
				persist()
				try {
					const result = objectOf(
						await client.featureCall("live.createLiveChat", {
							params: { botId },
							payload: {},
						}),
					)
					const chat = objectOf(result["chat"])
					id = typeof chat["id"] === "string" ? chat["id"] : ""
					if (id === "")
						throw new Error(
							t`The server did not return the created voice conversation. Read saved conversations before trying again.`,
						)
					creation.current.complete(id)
					persist()
					if (mounted.current) setChat(id)
				} catch (failure) {
					creation.current.fail(
						!(failure instanceof RequestFailed) ||
							failure.problem.code === "outcome_unknown" ||
							failure.status === 0 ||
							failure.status >= 500,
					)
					persist()
					throw failure
				}
			}
			if (!mounted.current || !lifetime.current.current(attempt)) return
			const url = new URL(client.liveUrl(id))
			url.searchParams.set("turnDetection", detection)
			if (voice !== "") url.searchParams.set("voice", voice)
			const ws = createWebSocket(url.href)
			socket.current = ws
			ws.binaryType = "arraybuffer"
			lifetime.current.track(attempt, () => {
				ws.onmessage = null
				ws.onerror = null
				ws.onclose = null
				ws.close(1000, "Conversation ended")
			})
			const deadline = setTimeout(() => {
				if (lifetime.current.current(attempt)) {
					setError(
						t`The voice connection did not become ready. Reconnect to the saved conversation.`,
					)
					disconnect()
				}
			}, 30000)
			lifetime.current.track(attempt, () => clearTimeout(deadline))
			ws.onmessage = (event) => {
				if (
					!mounted.current ||
					!lifetime.current.current(attempt) ||
					socket.current !== ws
				)
					return
				try {
					if (event.data instanceof ArrayBuffer) {
						const configuration = format.current
						if (configuration === null)
							throw new Error(t`Audio arrived before the connection was ready.`)
						const samples = decodePcm(event.data)
						if (samples.length === 0) return
						const buffer = audio.createBuffer(
							1,
							samples.length,
							configuration.output.sampleRate,
						)
						buffer.copyToChannel(samples, 0)
						const source = audio.createBufferSource()
						source.buffer = buffer
						source.connect(audio.destination)
						const start = Math.max(audio.currentTime, playAt.current)
						if (nextOutput.current) {
							outputStart.current = start
							nextOutput.current = false
						}
						source.start(start)
						playAt.current = start + buffer.duration
						outputs.current.add(source)
						source.onended = () => {
							outputs.current.delete(source)
							source.disconnect()
						}
						return
					}
					const message = objectOf(JSON.parse(String(event.data)))
					if (message["type"] === "session.ready") {
						clearTimeout(deadline)
						const audioFormats = objectOf(message["audio"]),
							caps = objectOf(message["capabilities"]),
							inputs = objectOf(caps["inputs"])
						const configuration: Ready = {
							input: audioFormat(audioFormats["input"]),
							output: audioFormat(audioFormats["output"]),
							detection: String(message["turnDetection"]),
							text: inputs["text"] === true,
							image: inputs["image"] === true,
							truncate: caps["truncate"] === true,
							interruption: caps["interruption"] === true,
							voices: Array.isArray(caps["voices"])
								? caps["voices"].filter(
										(value): value is string => typeof value === "string",
									)
								: [],
						}
						format.current = configuration
						setReady(configuration)
						setVoices(configuration.voices)
						setStatus("connected")
						connecting.current = false
					} else if (
						message["type"] === "output.stop" ||
						message["type"] === "input.speech.started"
					)
						stopSound()
					else if (message["type"] === "output.done") nextOutput.current = true
					else if (
						message["type"] === "input.transcript" ||
						message["type"] === "output.transcript.delta"
					) {
						const itemId = String(message["itemId"])
						if (
							message["type"] === "output.transcript.delta" &&
							currentOutput.current?.id !== itemId
						)
							currentOutput.current = {
								id: itemId,
								started: outputStart.current ?? audio.currentTime,
							}
						setTranscripts((current) => ({
							...current,
							[itemId]:
								message["type"] === "input.transcript"
									? String(message["text"])
									: (current[itemId] ?? "") + String(message["delta"]),
						}))
					} else if (message["type"] === "error")
						setError(String(message["message"]))
				} catch (failure) {
					setError(
						failure instanceof Error
							? failure.message
							: t`The voice connection returned invalid data.`,
					)
					disconnect()
				}
			}
			ws.onerror = () => {
				if (mounted.current && lifetime.current.current(attempt))
					setError(
						t`The voice connection failed. Your saved conversation is still available.`,
					)
			}
			ws.onclose = () => {
				if (lifetime.current.current(attempt)) disconnect()
			}
		} catch (failure) {
			if (mounted.current && lifetime.current.current(attempt)) {
				setError(
					failure instanceof Error
						? failure.message
						: t`Voice could not start.`,
				)
				disconnect()
			}
		}
	}
	const startCapture = async () => {
		const audio = context.current,
			configuration = format.current,
			ws = socket.current
		if (
			audio === null ||
			configuration === null ||
			ws === null ||
			captureStarting.current ||
			capture.current !== null
		)
			return
		captureStarting.current = true
		setCapturePending(true)
		const ticket = ++captureGeneration.current
		let media: MediaStream | undefined
		const current = () =>
			mounted.current &&
			ticket === captureGeneration.current &&
			socket.current === ws &&
			ws.readyState === WebSocket.OPEN &&
			context.current === audio
		try {
			media = await navigator.mediaDevices.getUserMedia({
				audio: {
					channelCount: 1,
					echoCancellation: true,
					noiseSuppression: true,
				},
			})
			if (!current()) {
				media.getTracks().forEach((track) => track.stop())
				return
			}
			microphone.current = media
			if (worklet.current !== audio) {
				await audio.audioWorklet.addModule(
					new URL("./capture.worklet.js", import.meta.url).href,
				)
				if (current()) worklet.current = audio
			}
			if (!current()) {
				media.getTracks().forEach((track) => track.stop())
				return
			}
			const resampler = new PcmEncoder(
				audio.sampleRate,
				configuration.input.sampleRate,
			)
			encoder.current = resampler
			const node = new AudioWorkletNode(audio, "kay-capture")
			capture.current = node
			node.port.onmessage = (event: MessageEvent<Float32Array>) => {
				if (!current()) return
				if (ws.bufferedAmount > 1024 * 1024) {
					setError(
						t`The connection is too slow for audio. Microphone input was stopped.`,
					)
					stopCapture()
					return
				}
				const bytes = resampler.push(event.data)
				if (bytes.byteLength > 0) ws.send(bytes)
			}
			const source = audio.createMediaStreamSource(media)
			inputNode.current = source
			source.connect(node)
			node.connect(audio.destination)
			setCapturing(true)
		} catch (failure) {
			media?.getTracks().forEach((track) => track.stop())
			if (current()) {
				setError(
					failure instanceof Error
						? failure.message
						: t`The microphone could not start.`,
				)
				stopCapture()
			}
		} finally {
			if (ticket === captureGeneration.current) {
				captureStarting.current = false
				if (mounted.current) setCapturePending(false)
			}
		}
	}
	const finishSpeaking = () => {
		const bytes = encoder.current?.flush()
		if (
			bytes !== undefined &&
			bytes.byteLength > 0 &&
			socket.current?.readyState === WebSocket.OPEN
		)
			socket.current.send(bytes)
		stopCapture()
		send({ type: "input.audio.commit" })
	}
	const sendImage = async (file: File | undefined) => {
		const ws = socket.current
		if (file === undefined || ws === null || format.current?.image !== true)
			return
		try {
			const bytes = new Uint8Array(await file.arrayBuffer())
			if (
				!mounted.current ||
				socket.current !== ws ||
				ws.readyState !== WebSocket.OPEN
			)
				return
			let binary = ""
			for (let offset = 0; offset < bytes.length; offset += 8192)
				binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
			send({ type: "input.image", mediaType: file.type, data: btoa(binary) })
		} catch (failure) {
			if (mounted.current && socket.current === ws)
				setError(
					failure instanceof Error
						? failure.message
						: t`The image could not be sent.`,
				)
		}
	}
	const selectChat = (id: string) => {
		setChat(id)
		if (id !== "") creation.current.complete(id)
		else creation.current.clear()
		persist()
		setTranscripts({})
	}
	return (
		<section className="feature-command feature-voice">
			<h2>{t`Talk with Kay`}</h2>
			<p className="feature-help">{t`Start a voice conversation, then turn on your microphone. Reconnect opens this same conversation.`}</p>
			<label className="feature-field">
				<span>{t`Existing voice conversation`}</span>
				<input
					value={chatId}
					disabled={
						status === "connected" ||
						status === "connecting" ||
						receipt.phase === "pending"
					}
					onChange={(event) => selectChat(event.target.value)}
					placeholder={t`Leave empty to start a new conversation`}
				/>
			</label>
			{receipt.phase === "unknown" && (
				<p
					className="feature-error"
					role="alert"
				>{t`A voice conversation may already have been created. Read saved conversations and select it before reconnecting; creating another is paused.`}</p>
			)}
			<Button
				variant="outline"
				disabled={
					reading ||
					status === "connected" ||
					status === "connecting" ||
					receipt.phase === "pending"
				}
				onClick={() => void findChats()}
			>
				<RefreshCw size={16} />
				{reading ? t`Loading…` : t`Read saved voice conversations`}
			</Button>
			{savedChats.length > 0 && (
				<label className="feature-field">
					<span>{t`Saved voice conversations`}</span>
					<select
						value={chatId}
						disabled={status === "connected" || status === "connecting"}
						onChange={(event) => selectChat(event.target.value)}
					>
						<option value="">{t`Choose a conversation`}</option>
						{savedChats.map((chat) => (
							<option key={chat.id} value={chat.id}>
								{new Date(chat.createdAt).toLocaleString()} · {chat.id}
							</option>
						))}
					</select>
				</label>
			)}
			<label className="feature-field">
				<span>{t`Turn detection`}</span>
				<select
					value={detection}
					disabled={status === "connected" || status === "connecting"}
					onChange={(event) => setDetection(event.target.value)}
				>
					<option value="server">{t`Automatic`}</option>
					<option value="client">{t`Finish speaking manually`}</option>
				</select>
			</label>
			{voices.length > 0 && (
				<label className="feature-field">
					<span>{t`Voice on the next connection`}</span>
					<select
						value={voice}
						disabled={status === "connected" || status === "connecting"}
						onChange={(event) => setVoice(event.target.value)}
					>
						<option value="">{t`Default voice`}</option>
						{voices.map((name) => (
							<option key={name} value={name}>
								{name}
							</option>
						))}
					</select>
				</label>
			)}
			{error !== null && (
				<p className="feature-error" role="alert">
					{error}
				</p>
			)}
			<p role="status">
				{status === "connected"
					? t`Connected`
					: status === "connecting"
						? t`Connecting…`
						: t`Disconnected`}
			</p>
			<div className="feature-toolbar">
				<Button
					disabled={
						botId === "" ||
						status === "connecting" ||
						status === "connected" ||
						receipt.phase === "pending" ||
						(chatId === "" && receipt.phase === "unknown")
					}
					onClick={() => void connect()}
				>
					<Play size={16} />
					{chatId !== "" ? t`Reconnect` : t`Start voice`}
				</Button>
				<Button
					variant="outline"
					disabled={ready === null}
					onClick={() =>
						capturing || capturePending ? stopCapture() : void startCapture()
					}
				>
					{capturing ? <MicOff size={16} /> : <Mic size={16} />}{" "}
					{capturePending
						? t`Cancel microphone`
						: capturing
							? t`Mute`
							: t`Microphone`}
				</Button>
				<Button
					variant="outline"
					disabled={ready === null || !ready.interruption}
					onClick={cancel}
				>
					<Square size={16} />
					{t`Stop answer`}
				</Button>
				<Button
					variant="outline"
					disabled={status !== "connected" && status !== "connecting"}
					onClick={disconnect}
				>
					<PhoneOff size={16} />
					{t`End`}
				</Button>
			</div>
			{ready?.detection === "client" && (
				<Button
					disabled={!capturing}
					onClick={finishSpeaking}
				>{t`Finish speaking`}</Button>
			)}
			{ready?.text === true && (
				<form
					onSubmit={(event) => {
						event.preventDefault()
						if (text.trim() !== "") {
							send({ type: "input.text", text })
							setText("")
						}
					}}
				>
					<label className="feature-field">
						<span>{t`Send text into this voice conversation`}</span>
						<input
							value={text}
							onChange={(event) => setText(event.target.value)}
						/>
					</label>
					<Button type="submit" disabled={text.trim() === ""}>{t`Send`}</Button>
				</form>
			)}
			{ready?.image === true && (
				<label className="feature-field">
					<span>
						<ImagePlus size={16} />
						{t`Send an image into this voice conversation`}
					</span>
					<input
						type="file"
						accept="image/*"
						onChange={(event) => {
							void sendImage(event.target.files?.[0])
							event.target.value = ""
						}}
					/>
				</label>
			)}
			{Object.entries(transcripts).map(([key, value]) => (
				<p key={key} className="feature-value-text">
					{value}
				</p>
			))}
			{chatId !== "" && (
				<button
					className="feature-text-button"
					onClick={() => onOpenChat(chatId)}
				>{t`Open saved conversation`}</button>
			)}
		</section>
	)
}
