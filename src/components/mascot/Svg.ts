import { Option } from "effect"
import type { Renderer } from "./Driver.ts"
import { Box, Pose, neutral } from "./Motion.ts"

export const makeRenderer = (document: Document): Renderer => {
	const existing = document.querySelector<HTMLElement>("[data-mascot-host]")
	const host = existing ?? document.createElement("div")
	host.classList.add("kay-mascot-host")
	host.dataset["mascotHost"] = ""
	host.setAttribute("aria-hidden", "true")
	const ns = "http://www.w3.org/2000/svg"
	const svg = host.querySelector("svg") ?? document.createElementNS(ns, "svg")
	svg.setAttribute("viewBox", "0 0 100 100")
	svg.setAttribute("aria-hidden", "true")
	svg.setAttribute("focusable", "false")
	const group = svg.querySelector("g") ?? document.createElementNS(ns, "g")
	group.setAttribute("fill", "currentColor")
	const left = group.querySelector<SVGRectElement>("rect:first-child")
	const right = group.querySelector<SVGRectElement>("rect:nth-child(2)")
	const leftEye = left ?? document.createElementNS(ns, "rect")
	const rightEye = right ?? document.createElementNS(ns, "rect")
	if (left === null) group.append(leftEye)
	if (right === null) group.append(rightEye)
	if (group.parentNode !== svg) svg.append(group)
	if (svg.parentNode !== host) host.append(svg)
	if (existing === null) document.body.append(host)
	const launchParent = host.parentElement ?? document.body
	// React may remove a closing surface between animation frames. Retain the same
	// node locally before the next paint, while Driver finishes the hidden handoff.
	const presence = new MutationObserver(() => {
		if (host.isConnected) return
		host.style.visibility = "hidden"
		const parking =
			document.querySelector<HTMLElement>('[data-mascot-boundary="main"]') ??
			launchParent
		parking.append(host)
	})
	presence.observe(document.body, { childList: true, subtree: true })
	const bounds = host.getBoundingClientRect()
	const leftBounds = leftEye.getBoundingClientRect()
	const rightBounds = rightEye.getBoundingClientRect()
	const initialPose =
		bounds.width > 0 &&
		bounds.height > 0 &&
		leftBounds.width > 0 &&
		rightBounds.width > 0
			? Pose.make({
					leftWidth: leftBounds.width / (bounds.width * 0.16),
					rightWidth: rightBounds.width / (bounds.width * 0.16),
					leftHeight: leftBounds.height / (bounds.height * 0.245),
					rightHeight: rightBounds.height / (bounds.height * 0.245),
					x:
						((leftBounds.left +
							leftBounds.width / 2 +
							rightBounds.left +
							rightBounds.width / 2) /
							2 -
							bounds.left) /
							bounds.width -
						0.5,
					y: 0,
					leftY:
						(leftBounds.top + leftBounds.height / 2 - bounds.top) /
							bounds.height -
						0.5,
					rightY:
						(rightBounds.top + rightBounds.height / 2 - bounds.top) /
							bounds.height -
						0.5,
				})
			: neutral
	return {
		initialPose,
		...(existing !== null && bounds.width > 0 && bounds.height > 0
			? {
					initialBox: Box.make({
						x: bounds.left + bounds.width / 2,
						y: bounds.top + bounds.height / 2,
						width: bounds.width,
						height: bounds.height,
					}),
				}
			: {}),
		draw: ({
			pose,
			opacity,
			eyeColor,
			box,
			placement,
			thinking,
			reducedMotion,
			startup,
			traveling,
			sideHandoff,
			clipBox,
			renderRegion,
			renderAnchor,
		}) => {
			host.style.color = Option.getOrElse(eyeColor, () => "")
			host.style.opacity = String(opacity)
			const anchor = Option.match(renderAnchor, {
				onNone: () => null,
				onSome: (id) =>
					document.querySelector<HTMLElement>(
						`[data-mascot-anchor-id="${CSS.escape(id)}"]`,
					),
			})
			const region = Option.match(renderRegion, {
				onNone: () => launchParent,
				onSome: (id) =>
					anchor?.closest<HTMLElement>("[data-mascot-boundary]") ??
					(id === "surface" && Option.isSome(renderAnchor)
						? null
						: document.querySelector<HTMLElement>(
								`[data-mascot-boundary="${CSS.escape(id)}"]`,
							)),
			})
			// A closing window owns its character until the region handoff completes.
			const closing = region?.hasAttribute("data-mascot-closing") ?? false
			const parent = (!traveling ? anchor : null) ?? region
			const mountedParent =
				parent ??
				document.querySelector<HTMLElement>('[data-mascot-boundary="main"]') ??
				launchParent
			if (host.parentElement !== mountedParent) mountedParent.append(host)
			host.dataset["mascotRegion"] = Option.getOrElse(
				renderRegion,
				() => "startup",
			)
			host.dataset["mascotAttached"] = String(
				parent === anchor && anchor !== null,
			)
			const titles = Array.from(
				document.querySelectorAll<HTMLElement>("[data-kay-title-slot]"),
				(element) => element.getBoundingClientRect(),
			)
			host.dataset["mascotManaged"] = "true"
			host.dataset["mascotStartup"] = startup
			host.dataset["mascotMoving"] = String(traveling)
			host.dataset["mascotSideHandoff"] = String(sideHandoff)
			host.dataset["mascotPlacement"] = placement
			host.dataset["mascotThinking"] = String(thinking)
			host.dataset["mascotReducedMotion"] = String(reducedMotion)
			Option.match(box, {
				onNone: () => {
					host.style.visibility = "visible"
				},
				onSome: (position) => {
					// An attached drawing follows its element even if a position-only
					// layout change did not notify ResizeObserver.
					const attachedAnchor = !traveling
						? anchor?.getBoundingClientRect()
						: undefined
					const value =
						attachedAnchor === undefined
							? position
							: Box.make({
									x: attachedAnchor.left + attachedAnchor.width / 2,
									y: attachedAnchor.top + attachedAnchor.height / 2,
									width: attachedAnchor.width,
									height: attachedAnchor.height,
								})
					const window = document.defaultView
					const viewport = window?.visualViewport
					const left = viewport?.offsetLeft ?? 0
					const top = viewport?.offsetTop ?? 0
					const viewportWidth =
						viewport?.width ??
						window?.innerWidth ??
						document.documentElement.clientWidth
					const viewportHeight =
						viewport?.height ??
						window?.innerHeight ??
						document.documentElement.clientHeight
					// Attached characters belong to their element, including during
					// keyboard panning or zoom. Only free motion needs viewport clamping.
					const attached = attachedAnchor !== undefined
					const scale = attached
						? 1
						: Math.min(
								1,
								Math.max(1, viewportWidth) / value.width,
								Math.max(1, viewportHeight) / value.height,
							)
					const width = value.width * scale
					const height = value.height * scale
					const x =
						attached || sideHandoff || closing
							? value.x
							: Math.max(
									left + width / 2,
									Math.min(value.x, left + viewportWidth - width / 2),
								)
					const y =
						attached || sideHandoff || closing
							? value.y
							: Math.max(
									top + height / 2,
									Math.min(value.y, top + viewportHeight - height / 2),
								)
					// Keep one mounted node if a source disappears, without a floating exit.
					host.style.visibility = parent === null ? "hidden" : "visible"
					const container =
						host.offsetParent instanceof HTMLElement ? host.offsetParent : null
					const bounds = container?.getBoundingClientRect()
					const scaleX =
						container !== null && container.offsetWidth > 0
							? (bounds?.width ?? container.offsetWidth) / container.offsetWidth
							: 1
					const scaleY =
						container !== null && container.offsetHeight > 0
							? (bounds?.height ?? container.offsetHeight) /
								container.offsetHeight
							: scaleX
					const localX =
						(x - width / 2 - (bounds?.left ?? 0)) / scaleX +
						(container?.scrollLeft ?? 0) -
						(container?.clientLeft ?? 0)
					const localY =
						(y - height / 2 - (bounds?.top ?? 0)) / scaleY +
						(container?.scrollTop ?? 0) -
						(container?.clientTop ?? 0)
					// A scaled 100px layout box can enlarge a 44px slot's scroll range.
					host.style.width = attached ? "100%" : `${width / scaleX}px`
					host.style.height = attached ? "100%" : `${height / scaleY}px`
					host.style.transform = attached
						? "none"
						: `translate3d(${localX}px, ${localY}px, 0)`
					host.style.clipPath = closing
						? "none"
						: Option.match(clipBox, {
								onNone: () => "none",
								onSome: (clip) => {
									const inset = (distance: number, size: number) =>
										`${Math.min(100, Math.max(0, (distance / size) * 100))}%`
									return `inset(${inset(clip.y - clip.height / 2 - (y - height / 2), height)} ${inset(x + width / 2 - (clip.x + clip.width / 2), width)} ${inset(y + height / 2 - (clip.y + clip.height / 2), height)} ${inset(clip.x - clip.width / 2 - (x - width / 2), width)})`
								},
							})
					const overlapsTitle = (
						center: number,
						widthScale: number,
						heightScale: number,
						offset: number,
					) =>
						titles.some(
							(title) =>
								title.width > 0 &&
								title.height > 0 &&
								x + width * (pose.x + center - 0.08 * widthScale) <
									title.right &&
								x + width * (pose.x + center + 0.08 * widthScale) >
									title.left &&
								y + height * (pose.y + offset - 0.1225 * heightScale) <
									title.bottom &&
								y + height * (pose.y + offset + 0.1225 * heightScale) >
									title.top,
						)
					const occupied = String(
						opacity > 0.1 &&
							(overlapsTitle(
								-0.145,
								pose.leftWidth,
								pose.leftHeight,
								pose.leftY,
							) ||
								overlapsTitle(
									0.145,
									pose.rightWidth,
									pose.rightHeight,
									pose.rightY,
								)),
					)
					if (document.documentElement.dataset["kayTitleOccupied"] !== occupied)
						document.documentElement.dataset["kayTitleOccupied"] = occupied
				},
			})
			group.setAttribute(
				"transform",
				`translate(${100 * pose.x} ${100 * pose.y})`,
			)
			const drawEye = (
				eye: SVGRectElement,
				center: number,
				widthScale: number,
				heightScale: number,
				offset: number,
			) => {
				const width = 16 * widthScale,
					height = 24.5 * heightScale
				eye.setAttribute("x", String(center - width / 2))
				eye.setAttribute("y", String(50 + 100 * offset - height / 2))
				eye.setAttribute("width", String(width))
				eye.setAttribute("height", String(height))
				eye.setAttribute("rx", String(Math.min(width, height) / 2))
			}
			drawEye(leftEye, 35.5, pose.leftWidth, pose.leftHeight, pose.leftY)
			drawEye(rightEye, 64.5, pose.rightWidth, pose.rightHeight, pose.rightY)
			if (
				startup === "handoff" &&
				!traveling &&
				document.documentElement.dataset["kayStartup"] === "handoff"
			)
				document.documentElement.dataset["kayStartup"] = "ready"
		},
		dispose: () => {
			presence.disconnect()
			if (existing === null) host.remove()
			else if (launchParent.isConnected) {
				const bounds = host.getBoundingClientRect()
				launchParent.append(host)
				host.style.width = `${bounds.width}px`
				host.style.height = `${bounds.height}px`
				host.style.transform = `translate3d(${bounds.left}px, ${bounds.top}px, 0)`
			}
		},
	}
}
