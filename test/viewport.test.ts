import assert from "node:assert/strict"
import { test } from "node:test"
import { watchViewport } from "../src/lib/viewport.ts"

test("keyboard resize keeps focus alone, zoom keeps its layout, and cleanup stops work", () => {
	const values = new Map<string, string>()
	const viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, scale: 1 })
	let callback: FrameRequestCallback | undefined
	const window = Object.assign(new EventTarget(), {
		visualViewport: viewport,
		innerHeight: 800,
		document: { documentElement: { style: {
			setProperty: (key: string, value: string) => values.set(key, value),
			removeProperty: (key: string) => values.delete(key),
		} } },
		requestAnimationFrame: (next: FrameRequestCallback) => { callback = next; return 1 },
		cancelAnimationFrame: () => { callback = undefined },
	})
	const stop = watchViewport(window as unknown as Window)
	assert.equal(values.get("--viewport-height"), "800px")
	viewport.height = 410
	viewport.offsetTop = 12
	viewport.dispatchEvent(new Event("resize"))
	callback?.(0)
	assert.equal(values.get("--viewport-height"), "410px")
	assert.equal(values.get("--viewport-top"), "12px")
	viewport.scale = 2
	viewport.height = 205
	viewport.dispatchEvent(new Event("resize"))
	callback?.(0)
	assert.equal(values.get("--viewport-height"), "410px")
	stop()
	assert.equal(values.size, 0)
	viewport.dispatchEvent(new Event("scroll"))
	assert.equal(callback, undefined)
})
