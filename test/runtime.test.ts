import assert from "node:assert/strict"
import { test } from "node:test"
import { apiOrigin, externalUrl, installRuntime, nativeRuntime, returnPath, writeClipboard } from "../src/lib/runtime.ts"

test("external links reject active schemes and hidden credentials", () => {
	for (const value of ["javascript:alert(1)", "file:///tmp/test", "http://example.com", "https://name:secret@example.com", "/relative"])
		assert.throws(() => externalUrl(value))
	assert.equal(externalUrl("https://example.com/help"), "https://example.com/help")
})

test("browser mode has no native setup", () => {
	assert.equal(nativeRuntime(), undefined)
	assert.equal(apiOrigin(), "")
})

test("login return paths cannot escape the app origin", () => {
	for (const value of [null, undefined, "https://evil.test", "//evil.test", "/\\evil.test", "/\n/evil.test"])
		assert.equal(returnPath(value), "/")
	assert.equal(returnPath("/c/chat?tab=details#latest"), "/c/chat?tab=details#latest")
})

test("native setup rejects unsafe origins and cannot be replaced", async () => {
	const copied: string[] = []
	const runtime = {
		version: 1 as const,
		kind: "native" as const,
		apiOrigin: "https://api.example.com",
		fetch: globalThis.fetch,
		signIn: async () => {},
		signOut: async () => {},
		writeClipboard: async (text: string) => { copied.push(text) },
		openExternal: async () => {},
		createWebSocket: () => { throw new Error("Not used in this test.") },
	}
	for (const apiOrigin of ["http://api.example.com", "https://api.example.com/", "https://api.example.com/path", "https://name:secret@api.example.com", "https://api.example.com?x=1"])
		assert.throws(() => installRuntime({ ...runtime, apiOrigin }))
	installRuntime(runtime)
	assert.equal(apiOrigin(), runtime.apiOrigin)
	assert.equal(Object.isFrozen(nativeRuntime()), true)
	await writeClipboard("hello")
	assert.deepEqual(copied, ["hello"])
	assert.throws(() => installRuntime(runtime))
})
