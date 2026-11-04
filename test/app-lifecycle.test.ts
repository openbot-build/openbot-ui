import assert from "node:assert/strict"
import { test } from "node:test"
import { watchAppPause } from "../src/lib/app-lifecycle.ts"

const target = () => Object.assign(new EventTarget(), {
	document: Object.assign(new EventTarget(), { visibilityState: "visible" }),
})

test("page and native pause stop a talk, while resume never starts one", async () => {
	const window = target()
	const stops: (string | undefined)[] = []
	let notify!: (state: "active" | "inactive") => void
	let removed = 0
	const dispose = watchAppPause(window as unknown as Window, error => stops.push(error), {
		onAppStateChange: async handler => { notify = handler; return () => { removed++ } },
	})
	await Promise.resolve()
	window.document.dispatchEvent(new Event("visibilitychange"))
	assert.equal(stops.length, 0)
	window.document.visibilityState = "hidden"
	window.document.dispatchEvent(new Event("visibilitychange"))
	window.dispatchEvent(new Event("pagehide"))
	notify("inactive")
	assert.equal(stops.length, 3)
	notify("active")
	assert.equal(stops.length, 3)
	dispose()
	assert.equal(removed, 1)
	window.dispatchEvent(new Event("pagehide"))
	notify("inactive")
	assert.equal(stops.length, 3)
})

test("a native listener that finishes after unmount is removed and cannot stop the next talk", async () => {
	const window = target()
	let notify!: (state: "active" | "inactive") => void
	let registered!: (stop: () => void) => void
	let stops = 0
	let removed = 0
	const dispose = watchAppPause(window as unknown as Window, () => { stops++ }, {
		onAppStateChange: handler => {
			notify = handler
			return new Promise(resolve => { registered = resolve })
		},
	})
	dispose()
	registered(() => { removed++ })
	await Promise.resolve()
	notify("inactive")
	assert.equal(stops, 0)
	assert.equal(removed, 1)
})

test("an already hidden page and a failed native subscription end the talk", async () => {
	const window = target()
	window.document.visibilityState = "hidden"
	const errors: (string | undefined)[] = []
	const dispose = watchAppPause(window as unknown as Window, error => errors.push(error), {
		onAppStateChange: async () => { throw new Error("No listener") },
	})
	assert.deepEqual(errors, [undefined])
	await Promise.resolve()
	assert.match(errors[1]!, /app state/)
	dispose()
})
