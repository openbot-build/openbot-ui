/** Keep the app and its portals above the software keyboard. Zoom stays native. */
export function watchViewport(window: Window): () => void {
	const viewport = window.visualViewport
	const style = window.document.documentElement.style
	let frame = 0
	const update = () => {
		frame = 0
		if (viewport && Math.abs(viewport.scale - 1) > 0.01) return
		style.setProperty("--viewport-height", `${viewport?.height ?? window.innerHeight}px`)
		style.setProperty("--viewport-top", `${viewport?.offsetTop ?? 0}px`)
	}
	const schedule = () => {
		if (!frame) frame = window.requestAnimationFrame(update)
	}
	update()
	window.addEventListener("resize", schedule)
	viewport?.addEventListener("resize", schedule)
	viewport?.addEventListener("scroll", schedule)
	return () => {
		window.cancelAnimationFrame(frame)
		window.removeEventListener("resize", schedule)
		viewport?.removeEventListener("resize", schedule)
		viewport?.removeEventListener("scroll", schedule)
		style.removeProperty("--viewport-height")
		style.removeProperty("--viewport-top")
	}
}
