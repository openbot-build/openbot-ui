import { useLayoutEffect } from "react"

export function useVisualViewport() {
	useLayoutEffect(() => {
		const style = document.documentElement.style
		const heightProperty = "--native-viewport-height"
		const topProperty = "--native-viewport-top"
		const previousHeight = style.getPropertyValue(heightProperty)
		const previousTop = style.getPropertyValue(topProperty)
		const viewport = window.visualViewport
		const measure = () => {
			// Keep the last unzoomed layout while the user magnifies the page.
			if (Math.abs((viewport?.scale ?? 1) - 1) > 0.01) return
			const height = viewport?.height ?? window.innerHeight
			const top = viewport?.offsetTop ?? 0
			if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(top))
				return
			const nextHeight = `${height}px`
			const nextTop = `${Math.max(0, top)}px`
			if (style.getPropertyValue(heightProperty) !== nextHeight)
				style.setProperty(heightProperty, nextHeight)
			if (style.getPropertyValue(topProperty) !== nextTop)
				style.setProperty(topProperty, nextTop)
		}
		// Publish keyboard geometry before the mascot measures anchors next frame.
		measure()
		viewport?.addEventListener("resize", measure)
		viewport?.addEventListener("scroll", measure)
		window.addEventListener("resize", measure)
		window.addEventListener("pageshow", measure)
		return () => {
			viewport?.removeEventListener("resize", measure)
			viewport?.removeEventListener("scroll", measure)
			window.removeEventListener("resize", measure)
			window.removeEventListener("pageshow", measure)
			if (previousHeight === "") style.removeProperty(heightProperty)
			else style.setProperty(heightProperty, previousHeight)
			if (previousTop === "") style.removeProperty(topProperty)
			else style.setProperty(topProperty, previousTop)
		}
	}, [])
}
