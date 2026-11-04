/** The public boundary between the shared Web app and a native shell. */
export interface NativeRuntime {
	readonly version: 1
	readonly kind: "native"
	readonly apiOrigin: string
	readonly development?: boolean
	readonly developmentSignIn?: boolean
	readonly storageNamespace?: string
	readonly connection?: {
		readonly defaultOrigin: string
		/** Block normal app setup until the user repairs or re-reads settings. */
		readonly recovery?: "invalid-settings" | "unsupported-version" | "unreadable-settings"
		readonly retry?: () => Promise<void>
		/** Save the selection, cancel old requests, then reload the app. */
		readonly change: (origin: string | null) => Promise<void>
	}
	/** Fetch keeps native credentials in the shell and supports abort and streams. */
	readonly fetch: typeof globalThis.fetch
	/** Resolve only after the new native session is ready for API calls. */
	readonly signIn: (input: {
		readonly email?: string
		readonly returnTo?: string
	}) => Promise<void>
	readonly signOut: () => Promise<void>
	readonly writeClipboard: (text: string) => Promise<void>
	readonly openExternal: (url: string) => Promise<void>
	readonly createWebSocket: (url: string) => WebSocket
	/** Return true to consume Android back, before native history or app exit. */
	readonly onBackPress?: (handler: () => boolean) => Promise<() => void>
	/** Mobile OS activity changes. Resuming never starts a new talk by itself. */
	readonly onAppStateChange?: (handler: (state: "active" | "inactive") => void) => Promise<() => void>
}

declare global {
	var __OPENBOT_RUNTIME__: NativeRuntime | undefined
}

/** Install once, before the shared app starts. This module starts no I/O. */
export function installRuntime(runtime: NativeRuntime): void {
	if (globalThis.__OPENBOT_RUNTIME__ !== undefined)
		throw new Error("The app runtime is already set.")
	if (runtime.version !== 1 || runtime.kind !== "native")
		throw new Error("The app runtime version is not supported.")
	const origin = new URL(normalizeServiceOrigin(runtime.apiOrigin, runtime.development))
	if (
		origin.origin !== runtime.apiOrigin ||
		origin.username !== "" ||
		origin.password !== ""
	)
		throw new Error("The API needs an HTTPS origin without a path or credentials.")
	for (const name of [
		"fetch", "signIn", "signOut", "writeClipboard", "openExternal", "createWebSocket",
	] as const)
		if (typeof runtime[name] !== "function")
			throw new Error(`The app runtime has no ${name} action.`)
	Object.defineProperty(globalThis, "__OPENBOT_RUNTIME__", {
		value: Object.freeze({ ...runtime }),
		writable: false,
		configurable: false,
	})
}

/** Browser callers have no native dependency or import-time setup. */
export const nativeRuntime = (): NativeRuntime | undefined =>
	globalThis.__OPENBOT_RUNTIME__

export const apiOrigin = (): string =>
	nativeRuntime()?.apiOrigin ?? globalThis.location?.origin ?? ""

/** Native requests use the shell's API and file-storage origin checks. */
export const fetchResource: typeof globalThis.fetch = (input, init) =>
	(nativeRuntime()?.fetch ?? globalThis.fetch)(input, init)

export function storageKey(name: string): string {
	const namespace = nativeRuntime()?.storageNamespace
	return namespace ? `${namespace}.${name}` : name
}

/** Only local development can use cleartext HTTP. Native Rust checks it again. */
export function normalizeServiceOrigin(input: string, development = false): string {
	const url = new URL(input.trim())
	const loopback = url.hostname === "localhost" || url.hostname === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(url.hostname)
	if ((url.protocol !== "https:" && !(development && url.protocol === "http:" && loopback)) || url.username || url.password || url.href !== `${url.origin}/`)
		throw new Error("Use an HTTPS service address without a path. Local HTTP is allowed only during development.")
	return url.origin
}

export const writeClipboard = (text: string): Promise<void> => {
	const native = nativeRuntime()
	if (native !== undefined) return native.writeClipboard(text)
	if (globalThis.navigator?.clipboard === undefined)
		return Promise.reject(new Error("The clipboard is not available."))
	return globalThis.navigator.clipboard.writeText(text)
}

/** A WebSocket transport can live in Rust; the UI uses its WebSocket surface. */
export const createWebSocket = (url: string): WebSocket =>
	nativeRuntime()?.createWebSocket(url) ?? new WebSocket(url)

export function externalUrl(input: string): string {
	const url = new URL(input)
	if (url.protocol !== "https:" || url.username !== "" || url.password !== "")
		throw new Error("This external link is not an HTTPS address.")
	return url.href
}

/** Return paths can never send a login result to a different origin. */
export function returnPath(input: string | null | undefined): string {
	if (!input?.startsWith("/") || input.startsWith("//") || /[\\\u0000-\u001f]/.test(input))
		return "/"
	const url = new URL(input, "https://return.invalid")
	return url.origin === "https://return.invalid" ? url.pathname + url.search + url.hash : "/"
}
