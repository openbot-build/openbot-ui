import assert from "node:assert/strict"
import { test, type TestContext } from "node:test"
import { startCapture } from "../src/lib/live-audio.ts"

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
	return { promise, resolve, reject }
}

function media(t: TestContext, getUserMedia: () => Promise<MediaStream>) {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis.navigator, "mediaDevices")
	Object.defineProperty(globalThis.navigator, "mediaDevices", { value: { getUserMedia }, configurable: true })
	t.after(() => {
		if (descriptor) Object.defineProperty(globalThis.navigator, "mediaDevices", descriptor)
		else Reflect.deleteProperty(globalThis.navigator, "mediaDevices")
	})
}

function stream() {
	let stops = 0
	return {
		value: { getTracks: () => [{ stop: () => { stops++ } }] } as unknown as MediaStream,
		stops: () => stops,
	}
}

test("a canceled capture does not ask for a microphone, and a late grant is stopped", async t => {
	const grant = deferred<MediaStream>()
	let prompts = 0
	media(t, () => { prompts++; return grant.promise })
	const cancel = new AbortController()
	cancel.abort()
	await assert.rejects(startCapture({} as AudioContext, 24000, () => {}, cancel.signal), { name: "AbortError" })
	assert.equal(prompts, 0)
	const pending = new AbortController()
	const capture = startCapture({} as AudioContext, 24000, () => {}, pending.signal)
	pending.abort()
	const input = stream()
	grant.resolve(input.value)
	await assert.rejects(capture, { name: "AbortError" })
	assert.equal(prompts, 1)
	assert.equal(input.stops(), 1)
})

test("cancel releases microphone tracks while the worklet module is still loading", async t => {
	const input = stream()
	media(t, async () => input.value)
	const loading = deferred<void>()
	const entered = deferred<void>()
	const context = { audioWorklet: { addModule: () => { entered.resolve(); return loading.promise } } } as unknown as AudioContext
	const cancel = new AbortController()
	const capture = startCapture(context, 24000, () => {}, cancel.signal)
	await entered.promise
	cancel.abort()
	assert.equal(input.stops(), 1)
	loading.resolve()
	await assert.rejects(capture, { name: "AbortError" })
	assert.equal(input.stops(), 1)
})

test("worklet failure releases the microphone", async t => {
	const input = stream()
	media(t, async () => input.value)
	const context = { audioWorklet: { addModule: async () => { throw new Error("Worklet failed") } } } as unknown as AudioContext
	await assert.rejects(startCapture(context, 24000, () => {}), /Worklet failed/)
	assert.equal(input.stops(), 1)
})

test("an active capture closes its port, nodes, and tracks once on cancel", async t => {
	const input = stream()
	media(t, async () => input.value)
	let ports = 0, nodes = 0, sources = 0, chunks = 0
	const port = { onmessage: null as null | ((event: { data: ArrayBuffer }) => void), close: () => { ports++ } }
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, "AudioWorkletNode")
	Object.defineProperty(globalThis, "AudioWorkletNode", { configurable: true, value: class {
		port = port
		connect() {}
		disconnect() { nodes++ }
	} })
	t.after(() => {
		if (descriptor) Object.defineProperty(globalThis, "AudioWorkletNode", descriptor)
		else Reflect.deleteProperty(globalThis, "AudioWorkletNode")
	})
	const context = {
		audioWorklet: { addModule: async () => {} },
		createMediaStreamSource: () => ({ connect() {}, disconnect() { sources++ } }),
		destination: {},
	} as unknown as AudioContext
	const cancel = new AbortController()
	const capture = await startCapture(context, 24000, () => { chunks++ }, cancel.signal)
	port.onmessage?.({ data: new ArrayBuffer(2) })
	assert.equal(chunks, 1)
	cancel.abort()
	capture.stop()
	assert.equal(input.stops(), 1)
	assert.deepEqual({ ports, nodes, sources }, { ports: 1, nodes: 1, sources: 1 })
	assert.equal(port.onmessage, null)
})
