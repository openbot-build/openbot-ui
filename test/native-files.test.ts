import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { after, test } from "node:test"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import { installRuntime } from "../src/lib/runtime.ts"

const hooks = registerHooks({
	resolve(specifier, context, nextResolve) {
		return nextResolve(specifier.startsWith("@/")
			? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href
			: specifier, context)
	},
})
after(() => hooks.deregister())

const input = new File(["Native upload 世界"], "native.txt", { type: "text/plain" })
const object = { id: "native-file", object: "file", filename: input.name, mediaType: input.type,
	bytes: input.size, status: "ready", createdAt: 1 }
let failStorage = false
let released = false
const seen: string[] = []
installRuntime({
	version: 1, kind: "native", apiOrigin: "https://service.test",
	fetch: async (input, init) => {
		const request = new Request(input, init)
		seen.push(`${request.method} ${request.url}`)
		if (request.url === "https://service.test/v1/files")
			return Response.json({ _tag: "FilesDisabled", message: "Proxy uploads are off." }, { status: 409 })
		if (request.url === "https://service.test/v1/files/uploads")
			return Response.json({ file: { ...object, status: "pending" }, url: "https://storage.test/file?signed=value",
				method: "PUT", headers: { "content-type": object.mediaType, "content-length": String(object.bytes) }, expiresAt: 1000 }, { status: 201 })
		if (request.url.startsWith("https://storage.test/")) {
			assert.ok(init?.signal)
			assert.equal(await request.text(), "Native upload 世界")
			return new Response(new ReadableStream({ cancel() { released = true } }), { status: failStorage ? 403 : 200 })
		}
		if (request.url === "https://service.test/v1/files/native-file/complete") {
			assert.equal(released, true)
			return Response.json(object)
		}
		throw new Error("Unexpected request.")
	},
	signIn: async () => {}, signOut: async () => {}, writeClipboard: async () => {}, openExternal: async () => {},
	createWebSocket: () => { throw new Error("Not used in this test.") },
})

async function upload() {
	const { uploadFileAtom } = await import("../src/atoms/files.ts")
	const registry = AtomRegistry.make()
	const unmount = registry.mount(uploadFileAtom)
	try {
		return await new Promise((resolve, reject) => {
			registry.subscribe(uploadFileAtom, (value) => {
				if (AsyncResult.isSuccess(value)) resolve(value.value)
				else if (AsyncResult.isFailure(value)) reject(value.cause)
			})
			registry.set(uploadFileAtom, input)
		})
	} finally { unmount(); registry.dispose() }
}

test("direct file uploads use native transport and close storage responses before completion", { timeout: 5000 }, async (t) => {
	t.mock.method(globalThis, "fetch", () => { throw new Error("Browser fetch must not receive native file requests.") })
	assert.deepEqual(await upload(), object)
	assert.deepEqual(seen, ["POST https://service.test/v1/files", "POST https://service.test/v1/files/uploads",
		"PUT https://storage.test/file?signed=value", "POST https://service.test/v1/files/native-file/complete"])
})

test("a failed storage upload releases its response and cannot mark the file ready", { timeout: 5000 }, async () => {
	failStorage = true
	released = false
	seen.length = 0
	await assert.rejects(upload())
	assert.equal(released, true)
	assert.equal(seen.some((path) => path.endsWith("/complete")), false)
})
