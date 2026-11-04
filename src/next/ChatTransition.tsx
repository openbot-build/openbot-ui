import { Component, createRef, type ReactNode } from "react"

interface Props {
	readonly kind: "kay" | "new" | "conversation"
	readonly enabled: boolean
	readonly children: ReactNode
}

interface Snapshot {
	readonly mascot: DOMRect | undefined
	readonly composer: DOMRect | undefined
	readonly outgoing: HTMLElement
	readonly scrollTop: number
}

const contentSelector =
	".next-welcome-copy, .next-context-strip, .next-transcript, .next-starter-list"

/** Capture layout before React changes it, including an interrupted animation. */
export class ChatTransition extends Component<Props, object, Snapshot | null> {
	private readonly root = createRef<HTMLDivElement>()
	private animations: Animation[] = []
	private moving: HTMLElement[] = []
	private outgoing: HTMLElement | undefined
	private generation = 0

	override getSnapshotBeforeUpdate(previous: Props): Snapshot | null {
		const root = this.root.current
		if (
			root === null ||
			!this.props.enabled ||
			previous.kind === this.props.kind ||
			previous.kind === "conversation" ||
			this.props.kind === "conversation" ||
			window.matchMedia("(prefers-reduced-motion: reduce)").matches
		)
			return null
		const chat = root.querySelector<HTMLElement>(".next-chat")
		const scroller = chat?.querySelector<HTMLElement>(".next-chat-scroller")
		if (
			chat === null ||
			chat === undefined ||
			scroller === null ||
			scroller === undefined
		)
			return null
		const bounds = root.getBoundingClientRect()
		const scrollBounds = scroller.getBoundingClientRect()
		const outgoing = chat.cloneNode(false) as HTMLElement
		const copy = scroller.cloneNode(true) as HTMLElement
		outgoing.classList.add("next-chat-outgoing")
		outgoing.setAttribute("aria-hidden", "true")
		outgoing.inert = true
		outgoing.removeAttribute("data-chat-transition")
		// The retiring layer contains only presentation. Kay and the input remain live.
		copy
			.querySelectorAll<HTMLElement>("[data-mascot-anchor]")
			.forEach((anchor) => {
				const source = scroller.querySelector<HTMLElement>(
					`[data-mascot-anchor="${anchor.dataset["mascotAnchor"]}"]`,
				)
				if (source !== null) {
					const style = getComputedStyle(source)
					Object.assign(anchor.style, {
						width: style.width,
						height: style.height,
						margin: style.margin,
						display: style.display,
					})
				}
				anchor.replaceChildren()
				anchor.removeAttribute("data-mascot-anchor")
				anchor.removeAttribute("data-mascot-anchor-id")
			})
		copy.querySelectorAll("[data-mascot-host], [id]").forEach((node) => {
			if (node.hasAttribute("data-mascot-host")) node.remove()
			else node.removeAttribute("id")
		})
		const sources = scroller.querySelectorAll<HTMLElement>(contentSelector)
		copy
			.querySelectorAll<HTMLElement>(contentSelector)
			.forEach((node, index) => {
				const source = sources[index]
				if (source === undefined) return
				const style = getComputedStyle(source)
				node.style.opacity = style.opacity
				node.style.transform = style.transform
				node.style.transition = "none"
			})
		Object.assign(copy.style, {
			position: "absolute",
			left: `${scrollBounds.left - bounds.left}px`,
			top: `${scrollBounds.top - bounds.top}px`,
			width: `${scrollBounds.width}px`,
			height: `${scrollBounds.height}px`,
		})
		outgoing.append(copy)
		const anchor = chat.querySelector<HTMLElement>(".next-home-mascot")
		const anchorBounds = anchor?.getBoundingClientRect()
		const visibleMascot =
			anchor?.querySelector("[data-mascot-host]") !== null &&
			anchorBounds !== undefined &&
			anchorBounds.bottom > bounds.top &&
			anchorBounds.top < bounds.bottom
		return {
			mascot: visibleMascot ? anchorBounds : undefined,
			composer: chat
				.querySelector(".next-composer-wrap")
				?.getBoundingClientRect(),
			outgoing,
			scrollTop: scroller.querySelector(".next-chat-scroll")?.scrollTop ?? 0,
		}
	}

	override componentDidUpdate(
		previous: Props,
		_state: object,
		snapshot: Snapshot | null,
	) {
		if (previous.kind === this.props.kind) return
		this.clear()
		const root = this.root.current
		if (root === null || snapshot === null) return
		const chat = root.querySelector<HTMLElement>(".next-chat")
		if (chat === null) return
		const viewport = chat.querySelector<HTMLElement>(".next-chat-scroll")
		if (viewport !== null) {
			chat.style.setProperty(
				"--chat-scrollbar-width",
				`${viewport.offsetWidth - viewport.clientWidth}px`,
			)
			viewport.scrollTop = 0
		}
		chat.dataset["chatTransition"] = this.props.kind
		this.outgoing = snapshot.outgoing
		root.append(snapshot.outgoing)
		const copiedViewport = snapshot.outgoing.querySelector(".next-chat-scroll")
		if (copiedViewport !== null) copiedViewport.scrollTop = snapshot.scrollTop
		const direction = this.props.kind === "new" ? 1 : -1
		const animate = (
			element: HTMLElement,
			frames: Keyframe[],
			options: KeyframeAnimationOptions,
		) => {
			const animation = element.animate(frames, { fill: "both", ...options })
			this.animations.push(animation)
			return animation
		}
		const move = (
			selector: string,
			before: DOMRect | undefined,
			delay: number,
		) => {
			const element = chat.querySelector<HTMLElement>(selector)
			if (element === null || before === undefined) return
			const after = element.getBoundingClientRect()
			element.style.setProperty(
				"--chat-move-x",
				`${before.left - after.left}px`,
			)
			element.style.setProperty("--chat-move-y", `${before.top - after.top}px`)
			// CSS animation events keep the mascot driver's live geometry in sync.
			element.style.animation = `next-chat-move ${620 - delay}ms cubic-bezier(.22, 1, .36, 1) ${delay}ms both`
			this.moving.push(element)
			this.animations.push(...element.getAnimations())
		}
		move(".next-home-mascot", snapshot.mascot, 0)
		move(".next-composer-wrap", snapshot.composer, 40)
		animate(
			snapshot.outgoing,
			[
				{ opacity: 1, transform: "translateY(0px)" },
				{ opacity: 0, transform: `translateY(${-direction * 18}px)` },
			],
			{ duration: 170, easing: "ease-out" },
		)
		chat
			.querySelectorAll<HTMLElement>(contentSelector)
			.forEach((element, index) => {
				animate(
					element,
					[
						{
							opacity: 0,
							transform: `translateY(${index === 0 ? -direction * 18 : 18}px)`,
						},
						{ opacity: 1, transform: "translateY(0px)" },
					],
					{
						duration: 280,
						delay: 190 + index * 55,
						easing: "cubic-bezier(.22, 1, .36, 1)",
					},
				)
			})
		const generation = this.generation
		void Promise.allSettled(
			this.animations.map((animation) => animation.finished),
		).then(() => {
			if (this.generation === generation) this.clear()
		})
	}

	override componentWillUnmount() {
		this.clear()
	}

	private clear() {
		this.generation++
		this.animations.forEach((animation) => animation.cancel())
		this.animations = []
		this.moving.forEach((element) => {
			element.style.removeProperty("animation")
			element.style.removeProperty("--chat-move-x")
			element.style.removeProperty("--chat-move-y")
		})
		this.moving = []
		this.outgoing?.remove()
		this.outgoing = undefined
		const chat = this.root.current?.querySelector<HTMLElement>(".next-chat")
		if (chat !== null && chat !== undefined) {
			delete chat.dataset["chatTransition"]
			chat.style.removeProperty("--chat-scrollbar-width")
		}
	}

	override render() {
		return (
			<div className="next-chat-stage" ref={this.root}>
				{this.props.children}
			</div>
		)
	}
}
