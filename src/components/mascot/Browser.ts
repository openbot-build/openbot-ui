import { Data, Match, Option } from "effect"
import { dual } from "effect/Function"
import { Box } from "./Motion.ts"
import { Browser, type AnchorSource } from "./Driver.ts"

export const makeBrowser: {
	(document: Document): (window: Window) => Browser["Service"]
	(window: Window, document: Document): Browser["Service"]
} = dual(2, (window: Window, document: Document): Browser["Service"] => {
	const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
	return {
		now: () => window.performance.now(),
		hidden: () => document.hidden,
		reducedMotion: () => motion.matches,
		viewportBox: () => {
			const viewport = window.visualViewport
			const width = viewport?.width ?? window.innerWidth
			const height = viewport?.height ?? window.innerHeight
			return Box.make({
				x: (viewport?.offsetLeft ?? 0) + width / 2,
				y: (viewport?.offsetTop ?? 0) + height / 2,
				width,
				height,
			})
		},
		launchBox: () =>
			Box.make({
				x: window.innerWidth / 2,
				y: window.innerHeight / 2,
				width: 220,
				height: 220,
			}),
		fallbackBox: () => {
			const viewport = window.visualViewport
			const left = viewport?.offsetLeft ?? 0
			const top = viewport?.offsetTop ?? 0
			const width = viewport?.width ?? window.innerWidth
			const height = viewport?.height ?? window.innerHeight
			return Box.make({
				x: left + Math.min(44, width / 2),
				y: top + Math.min(44, height / 2),
				width: 48,
				height: 48,
			})
		},
		requestFrame: (callback) => window.requestAnimationFrame(callback),
		cancelFrame: (handle) => window.cancelAnimationFrame(handle),
		setTimer: (callback, delay) => window.setTimeout(callback, delay),
		clearTimer: (handle) => window.clearTimeout(handle),
		onVisibility: (callback) => {
			document.addEventListener("visibilitychange", callback)
			return () => document.removeEventListener("visibilitychange", callback)
		},
		onMotion: (callback) => {
			motion.addEventListener("change", callback)
			return () => motion.removeEventListener("change", callback)
		},
		onLayout: (callback) => {
			// CSS transforms move slots without producing a ResizeObserver notification.
			let moving: ReadonlyArray<{
				readonly target: Element
				readonly key: string
			}> = []
			let frame = 0
			const tick = () => {
				frame = 0
				moving = moving.filter((motion) => motion.target.isConnected)
				callback()
				if (moving.length > 0 && !document.hidden)
					frame = window.requestAnimationFrame(tick)
			}
			// Viewport listeners publish layout CSS synchronously. Read anchors
			// after those listeners, even when this listener registered first.
			const scheduleLayout = () => {
				if (frame === 0 && !document.hidden)
					frame = window.requestAnimationFrame(tick)
			}
			const start = (target: EventTarget | null, key: string) => {
				if (
					!(target instanceof Element) ||
					(!target.matches("[data-mascot-anchor]") &&
						target.querySelector("[data-mascot-anchor]") === null)
				)
					return
				if (
					!moving.some(
						(motion) => motion.target === target && motion.key === key,
					)
				)
					moving = [...moving, { target, key }]
				callback()
				if (frame === 0 && !document.hidden)
					frame = window.requestAnimationFrame(tick)
			}
			const end = (target: EventTarget | null, key: string) => {
				moving = moving.filter(
					(motion) => motion.target !== target || motion.key !== key,
				)
				callback()
				if (moving.length === 0 && frame !== 0) {
					window.cancelAnimationFrame(frame)
					frame = 0
				}
			}
			const transitionStart = (event: TransitionEvent) =>
				start(event.target, `transition:${event.propertyName}`)
			const transitionEnd = (event: TransitionEvent) =>
				end(event.target, `transition:${event.propertyName}`)
			const animationStart = (event: AnimationEvent) =>
				start(event.target, `animation:${event.animationName}`)
			const animationEnd = (event: AnimationEvent) =>
				end(event.target, `animation:${event.animationName}`)
			const visibility = () => {
				if (document.hidden && frame !== 0) {
					window.cancelAnimationFrame(frame)
					frame = 0
				} else if (!document.hidden && moving.length > 0 && frame === 0) {
					frame = window.requestAnimationFrame(tick)
				}
			}
			window.addEventListener("resize", scheduleLayout)
			document.addEventListener("scroll", scheduleLayout, true)
			document.addEventListener("transitionrun", transitionStart, true)
			document.addEventListener("transitionend", transitionEnd, true)
			document.addEventListener("transitioncancel", transitionEnd, true)
			document.addEventListener("animationstart", animationStart, true)
			document.addEventListener("animationend", animationEnd, true)
			document.addEventListener("animationcancel", animationEnd, true)
			document.addEventListener("visibilitychange", visibility)
			window.visualViewport?.addEventListener("resize", scheduleLayout)
			window.visualViewport?.addEventListener("scroll", scheduleLayout)
			return () => {
				if (frame !== 0) window.cancelAnimationFrame(frame)
				moving = []
				window.removeEventListener("resize", scheduleLayout)
				document.removeEventListener("scroll", scheduleLayout, true)
				document.removeEventListener("transitionrun", transitionStart, true)
				document.removeEventListener("transitionend", transitionEnd, true)
				document.removeEventListener("transitioncancel", transitionEnd, true)
				document.removeEventListener("animationstart", animationStart, true)
				document.removeEventListener("animationend", animationEnd, true)
				document.removeEventListener("animationcancel", animationEnd, true)
				document.removeEventListener("visibilitychange", visibility)
				window.visualViewport?.removeEventListener("resize", scheduleLayout)
				window.visualViewport?.removeEventListener("scroll", scheduleLayout)
			}
		},
	}
})

let nextAnchorId = 0

export const makeAnchor = (element: HTMLElement): AnchorSource => {
	const id = element.dataset["mascotAnchorId"] ?? `kay-anchor-${nextAnchorId++}`
	element.dataset["mascotAnchorId"] = id
	return {
		id,
		readBoundary: () => {
			const owner = element.closest<HTMLElement>("[data-mascot-boundary]")
			const window = element.ownerDocument.defaultView
			if (owner === null || window === null || !owner.isConnected)
				return Option.none()
			const viewport = window.visualViewport
			const left = viewport?.offsetLeft ?? 0
			const top = viewport?.offsetTop ?? 0
			const right = left + (viewport?.width ?? window.innerWidth)
			const bottom = top + (viewport?.height ?? window.innerHeight)
			const rect = Match.value(owner.dataset["mascotBoundary"]).pipe(
				Match.when("header", () => ({ left, top, right, bottom })),
				Match.when("main", () => {
					// Main content is fixed-positioned; its containing main has no height.
					const rail =
						element.ownerDocument.querySelector<HTMLElement>(".companion-rail")
					const visible =
						rail !== null &&
						rail.getClientRects().length > 0 &&
						window.getComputedStyle(rail).visibility !== "hidden"
					return {
						left: visible
							? Math.max(left, rail.getBoundingClientRect().right)
							: left,
						top,
						right,
						bottom,
					}
				}),
				Match.orElse(() => owner.getBoundingClientRect()),
			)
			const x = Math.max(left, rect.left),
				y = Math.max(top, rect.top)
			const width = Math.min(right, rect.right) - x
			const height = Math.min(bottom, rect.bottom) - y
			if (width <= 0 || height <= 0) return Option.none()
			return Option.some(
				new Data.Class({
					id: owner.dataset["mascotBoundary"]!,
					box: Box.make({ x: x + width / 2, y: y + height / 2, width, height }),
					edge:
						owner.dataset["mascotBoundary"] === "header"
							? ("top" as const)
							: ("left" as const),
				}),
			)
		},
		read: () => {
			const rect = element.getBoundingClientRect()
			const window = element.ownerDocument.defaultView
			if (
				window === null ||
				!element.isConnected ||
				rect.width <= 0 ||
				rect.height <= 0
			)
				return Option.none()
			const viewport = window.visualViewport
			const left = viewport?.offsetLeft ?? 0,
				top = viewport?.offsetTop ?? 0
			const width = viewport?.width ?? window.innerWidth,
				height = viewport?.height ?? window.innerHeight
			const tolerance = 1
			if (
				rect.left < left - tolerance ||
				rect.top < top - tolerance ||
				rect.right > left + width + tolerance ||
				rect.bottom > top + height + tolerance
			)
				return Option.none()
			const visibleThrough = (node: HTMLElement | null): boolean => {
				if (node === null) return true
				const style = window.getComputedStyle(node)
				if (
					style.visibility === "hidden" ||
					style.visibility === "collapse" ||
					style.opacity === "0"
				)
					return false
				// Root overflow clips the viewport, which was checked above. A modal's
				// scroll lock can leave body at zero height while its fixed portal is visible.
				if (
					node !== element.ownerDocument.body &&
					node !== element.ownerDocument.documentElement &&
					(style.overflowX !== "visible" || style.overflowY !== "visible")
				) {
					const parent = node.getBoundingClientRect()
					// Client dimensions are untransformed and rounded to whole CSS pixels.
					const scaleX =
						node.offsetWidth > 0 ? parent.width / node.offsetWidth : 1
					const scaleY =
						node.offsetHeight > 0 ? parent.height / node.offsetHeight : 1
					const left = parent.left + node.clientLeft * scaleX,
						top = parent.top + node.clientTop * scaleY
					if (
						style.overflowX !== "visible" &&
						(rect.left < left - tolerance ||
							rect.right > left + node.clientWidth * scaleX + tolerance)
					)
						return false
					if (
						style.overflowY !== "visible" &&
						(rect.top < top - tolerance ||
							rect.bottom > top + node.clientHeight * scaleY + tolerance)
					)
						return false
				}
				return visibleThrough(node.parentElement)
			}
			if (!visibleThrough(element)) return Option.none()
			return Option.some(
				Box.make({
					x: rect.left + rect.width / 2,
					y: rect.top + rect.height / 2,
					width: rect.width,
					height: rect.height,
				}),
			)
		},
		observe: (callback) => {
			const observer = new ResizeObserver(callback)
			// Ancestor growth can move a reply slot without changing its own size.
			const observe = (node: HTMLElement | null): void => {
				if (node === null) return
				observer.observe(node)
				observe(node.parentElement)
			}
			observe(element)
			return () => observer.disconnect()
		},
	}
}
