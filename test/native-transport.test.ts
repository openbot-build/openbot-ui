import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { after, test } from "node:test"
import { Effect } from "effect"
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

test("the API atom uses the native API origin and transport", { timeout: 5000 }, async (t) => {
	const seen: string[] = []
	installRuntime({
		version: 1,
		kind: "native",
		apiOrigin: "https://api.example.com",
		fetch: async (input, init) => {
			const request = new Request(input, init)
			seen.push(request.url)
			return Response.json({
				userId: "person", profile: {}, memberships: [],
				platformAdmin: false, expiresAt: "2030-01-01T00:00:00Z",
			})
		},
		signIn: async () => {}, signOut: async () => {},
		writeClipboard: async () => {}, openExternal: async () => {},
		createWebSocket: () => { throw new Error("Not used in this test.") },
	})
	t.mock.method(globalThis, "fetch", () => { throw new Error("Browser fetch must not receive native requests.") })
	const { Api, apiRuntime } = await import("../src/lib/api.ts")
	const atom = apiRuntime.atom(Effect.gen(function* () {
		const client = yield* Api
		return yield* client.api.account.session()
	}))
	const registry = AtomRegistry.make()
	t.after(() => registry.dispose())
	const result = await new Promise<string>((resolve, reject) => {
		registry.subscribe(atom, (value) => {
			if (AsyncResult.isSuccess(value)) resolve(value.value.userId)
			else if (AsyncResult.isFailure(value)) reject(value.cause)
		}, { immediate: true })
	})
	assert.equal(result, "person")
	assert.deepEqual(seen, ["https://api.example.com/auth/session"])

	const previousLocation = Object.getOwnPropertyDescriptor(globalThis, "location")
	t.after(() => {
		if (previousLocation) Object.defineProperty(globalThis, "location", previousLocation)
		else Reflect.deleteProperty(globalThis, "location")
	})
	let complete!: (path: string) => void
	const returned = new Promise<string>((resolve) => { complete = resolve })
	Object.defineProperty(globalThis, "location", { configurable: true, value: {
		replace: complete,
		assign: () => { throw new Error("Native sign-in must replace its history entry.") },
	} })
	const { signInAtom } = await import("../src/atoms/account.ts")
	const unmount = registry.mount(signInAtom)
	t.after(unmount)
	registry.set(signInAtom, { email: "person@example.com", returnTo: "//evil.test" })
	assert.equal(await returned, "/")
	assert.deepEqual(seen, ["https://api.example.com/auth/session"])
})
