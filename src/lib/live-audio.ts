/**
 * Sound for Live talks. OpenBot speaks `pcm16`: 16-bit signed little-endian
 * PCM with one channel, at the sample rate of the session. The browser works
 * with float samples at the rate of its own sound device, so this module
 * changes the rate and the form in both ways.
 */

/**
 * The AudioWorklet that takes the microphone. It changes the rate to the rate
 * of the session with linear interpolation, makes 16-bit samples, and posts
 * about 40 ms of sound at a time. A worklet runs on the sound thread, so it
 * comes in as text and runs from a Blob address.
 */
const captureWorklet = `
class Capture extends AudioWorkletProcessor {
	constructor(options) {
		super()
		const target = options.processorOptions.targetRate
		this.step = sampleRate / target
		this.position = 0
		this.last = 0
		this.length = Math.max(1, Math.round(target * 0.04))
		this.chunk = new Int16Array(this.length)
		this.size = 0
	}
	process(inputs) {
		const data = inputs[0] && inputs[0][0]
		if (!data || data.length === 0) return true
		let t = this.position
		while (Math.floor(t) + 1 < data.length) {
			const i = Math.floor(t)
			const a = i < 0 ? this.last : data[i]
			const b = data[i + 1]
			const v = Math.max(-1, Math.min(1, a + (b - a) * (t - i)))
			this.chunk[this.size++] = v < 0 ? v * 0x8000 : v * 0x7fff
			if (this.size === this.length) {
				// The transfer empties the old array, so a new one takes its place.
				this.port.postMessage(this.chunk.buffer, [this.chunk.buffer])
				this.chunk = new Int16Array(this.length)
				this.size = 0
			}
			t += this.step
		}
		this.position = t - data.length
		this.last = data[data.length - 1]
		return true
	}
}
registerProcessor("openbot-capture", Capture)
`

/** The microphone, as 16-bit sound at `targetRate`. Call `stop` to let it go. */
export interface Capture {
	readonly stop: () => void
}

/**
 * Starts the microphone. `onChunk` gets each piece of sound. The browser
 * removes echo, so the person can talk while the Bot speaks.
 */
export const startCapture = async (
	context: AudioContext,
	targetRate: number,
	onChunk: (chunk: ArrayBuffer) => void,
): Promise<Capture> => {
	const stream = await navigator.mediaDevices.getUserMedia({
		audio: {
			channelCount: 1,
			echoCancellation: true,
			noiseSuppression: true,
			autoGainControl: true,
		},
	})
	try {
		const url = URL.createObjectURL(
			new Blob([captureWorklet], { type: "text/javascript" }),
		)
		try {
			await context.audioWorklet.addModule(url)
		} finally {
			URL.revokeObjectURL(url)
		}
		const source = context.createMediaStreamSource(stream)
		const node = new AudioWorkletNode(context, "openbot-capture", {
			numberOfInputs: 1,
			numberOfOutputs: 1,
			channelCount: 1,
			channelCountMode: "explicit",
			processorOptions: { targetRate },
		})
		node.port.onmessage = (event: MessageEvent<ArrayBuffer>) =>
			onChunk(event.data)
		source.connect(node)
		// The browser runs only the nodes that lead to the speakers. The worklet
		// writes no sound to its output, so this plays only silence.
		node.connect(context.destination)
		return {
			stop: () => {
				node.port.onmessage = null
				source.disconnect()
				node.disconnect()
				for (const track of stream.getTracks()) track.stop()
			},
		}
	} catch (error) {
		for (const track of stream.getTracks()) track.stop()
		throw error
	}
}

/**
 * Plays the sound of the Bot without gaps. Each piece starts where the last
 * one ends. `stop` ends the sound at once, such as when the person talks.
 */
export class Player {
	private next = 0
	private readonly sources = new Set<AudioBufferSourceNode>()
	/** One odd byte that waits for the next piece. */
	private carry: number | undefined
	/** When the sound of the current answer item started, in context time. */
	private itemStart: number | undefined

	constructor(
		private readonly context: AudioContext,
		private readonly rate: number,
		private readonly onSpeaking: (speaking: boolean) => void,
	) {}

	play(bytes: ArrayBuffer) {
		let view = new Uint8Array(bytes)
		if (this.carry !== undefined) {
			const joined = new Uint8Array(view.length + 1)
			joined[0] = this.carry
			joined.set(view, 1)
			view = joined
			this.carry = undefined
		}
		if (view.length % 2 === 1) {
			this.carry = view[view.length - 1]
			view = view.subarray(0, view.length - 1)
		}
		const count = view.length / 2
		if (count === 0) return
		const data = new DataView(view.buffer, view.byteOffset, view.byteLength)
		const buffer = this.context.createBuffer(1, count, this.rate)
		const channel = buffer.getChannelData(0)
		for (let index = 0; index < count; index++)
			channel[index] = data.getInt16(index * 2, true) / 0x8000
		const source = this.context.createBufferSource()
		source.buffer = buffer
		source.connect(this.context.destination)
		const start = Math.max(this.context.currentTime + 0.02, this.next)
		this.itemStart ??= start
		source.start(start)
		this.next = start + buffer.duration
		this.sources.add(source)
		this.onSpeaking(true)
		source.onended = () => {
			this.sources.delete(source)
			if (this.sources.size === 0) this.onSpeaking(false)
		}
	}

	/** The next sound belongs to a new answer item. */
	newItem() {
		this.itemStart = undefined
	}

	/**
	 * Stops all sound now. It gives how much of the current item the person
	 * heard, in milliseconds.
	 */
	stop(): number {
		const heard =
			this.itemStart === undefined
				? 0
				: Math.max(0, (this.context.currentTime - this.itemStart) * 1000)
		for (const source of this.sources) {
			source.onended = null
			source.stop()
		}
		this.sources.clear()
		this.next = 0
		this.carry = undefined
		this.itemStart = undefined
		this.onSpeaking(false)
		return Math.round(heard)
	}
}
