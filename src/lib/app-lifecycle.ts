import type { NativeRuntime } from "./runtime"

/** End media before the page or native activity becomes inactive. */
export function watchAppPause(
	window: Window,
	pause: (error?: string) => void,
	native?: Pick<NativeRuntime, "onAppStateChange">,
): () => void {
	let disposed = false
	let unlisten: (() => void) | undefined
	const hidden = () => {
		if (!disposed) pause()
	}
	const visibility = () => {
		if (window.document.visibilityState === "hidden") hidden()
	}
	window.addEventListener("pagehide", hidden)
	window.document.addEventListener("visibilitychange", visibility)
	void native?.onAppStateChange?.((state) => {
		if (state === "inactive") hidden()
	}).then((stop) => {
		if (disposed) stop()
		else unlisten = stop
	}, () => {
		if (!disposed) pause("Live talk stopped because the app state could not be read.")
	})
	visibility()
	return () => {
		disposed = true
		window.removeEventListener("pagehide", hidden)
		window.document.removeEventListener("visibilitychange", visibility)
		unlisten?.()
	}
}
