import { Array, Data, Equal, HashMap, Option } from "effect"
import {
	createContext,
	useContext,
	useLayoutEffect,
	useRef,
	useState,
	type ComponentProps,
	type ReactNode,
} from "react"
import { makeAnchor, makeBrowser } from "./Browser.ts"
import { makeDriver, type Dispose, type Driver, type Input } from "./Driver.ts"
import type { Interface, Placement } from "./Model.ts"
import { makeRenderer } from "./Svg.ts"
import "./Mascot.css"

export { Expression, Placement } from "./Model.ts"
export type { Interface } from "./Model.ts"

interface Binding extends Interface {
	readonly attach: () => Dispose
	readonly setInput: (input: Input) => void
	readonly registerAnchor: (
		placement: Placement,
		element: HTMLElement,
	) => Dispose
}

const makeBinding = (initial: Input): Binding => {
	let input = initial
	let driver = Option.none<Driver>()
	// Anchor records contain browser handles and compare by identity.
	let anchors = HashMap.empty<
		number,
		{
			readonly placement: Placement
			readonly element: HTMLElement
			readonly registration: Option.Option<Dispose>
		}
	>()
	let nextAnchor = 0
	return {
		attach: () => {
			const instance = makeDriver(
				makeBrowser(window, document),
				makeRenderer(document),
				input,
			)
			driver = Option.some(instance)
			const entries = Array.sortWith(
				Array.fromIterable(anchors),
				([, value]) => (value.placement === input.placement ? 0 : 1),
				(a, b) => (a < b ? -1 : a > b ? 1 : 0),
			)
			Array.forEach(entries, ([id, anchor]) => {
				anchors = HashMap.set(
					anchors,
					id,
					Equal.byReference(
						new Data.Class({
							...anchor,
							registration: Option.some(
								instance.registerAnchor(
									anchor.placement,
									makeAnchor(anchor.element),
								),
							),
						}),
					),
				)
			})
			return () => {
				instance.dispose()
				driver = Option.none()
				anchors = HashMap.map(anchors, (anchor) =>
					Equal.byReference(
						new Data.Class({ ...anchor, registration: Option.none<Dispose>() }),
					),
				)
			}
		},
		setInput: (next) => {
			input = next
			Option.match(driver, {
				onNone: () => {},
				onSome: (instance) => instance.setInput(next),
			})
		},
		play: (expression) =>
			Option.match(driver, {
				onNone: () => {},
				onSome: (instance) => instance.play(expression),
			}),
		replayIntro: () =>
			Option.match(driver, {
				onNone: () => {},
				onSome: (instance) => instance.replayIntro(),
			}),
		registerAnchor: (placement, element) => {
			const id = nextAnchor++
			const registration = Option.map(driver, (instance) =>
				instance.registerAnchor(placement, makeAnchor(element)),
			)
			anchors = HashMap.set(
				anchors,
				id,
				Equal.byReference(new Data.Class({ placement, element, registration })),
			)
			return () => {
				Option.match(HashMap.get(anchors, id), {
					onNone: () => {},
					onSome: (anchor) =>
						Option.match(anchor.registration, {
							onNone: () => {},
							onSome: (cleanup) => cleanup(),
						}),
				})
				anchors = HashMap.remove(anchors, id)
			}
		},
	}
}

const MascotContext = createContext<Binding | undefined>(undefined)

export interface ProviderProps {
	readonly children: ReactNode
	readonly placement?: Placement
	readonly startup?: Input["startup"]
	readonly eyeColor?: Input["eyeColor"]
	/** Only current live activity; saved Turn records are not activity. */
	readonly thinking?: boolean
}

/** Mount once above route content, at workbench lifetime. Nested providers share the host. */
export function Provider({
	children,
	placement = "home",
	thinking = false,
	startup = "ready",
	eyeColor,
}: ProviderProps) {
	const parent = useContext(MascotContext)
	const input: Input = {
		placement,
		thinking,
		startup,
		...(eyeColor === undefined ? {} : { eyeColor }),
	}
	const [own] = useState(() => makeBinding(input))
	const binding = parent ?? own
	useLayoutEffect(
		() => (parent !== undefined ? undefined : own.attach()),
		[own, parent],
	)
	useLayoutEffect(() => {
		if (parent === undefined) own.setInput(input)
	}, [own, parent, placement, thinking, startup, eyeColor])
	return (
		<MascotContext.Provider value={binding}>{children}</MascotContext.Provider>
	)
}

export interface AnchorProps extends Omit<
	ComponentProps<"span">,
	"children" | "ref" | "aria-hidden"
> {
	readonly placement: Placement
	/** Keep inactive or historical reply slots out of destination selection. */
	readonly active?: boolean
}

/** A geometry marker only. Put an accessible name on its surrounding control. */
export function Anchor({
	placement,
	active = true,
	className,
	...props
}: AnchorProps) {
	const binding = useContext(MascotContext)
	const element = useRef<HTMLSpanElement>(null)
	useLayoutEffect(() => {
		if (binding === undefined || !active || element.current === null) return
		return binding.registerAnchor(placement, element.current)
	}, [binding, active, placement])
	return (
		<span
			{...props}
			ref={element}
			className={["kay-mascot-anchor", className].filter(Boolean).join(" ")}
			data-mascot-anchor={placement}
			aria-hidden="true"
		/>
	)
}

export function useMascot(): Interface {
	const binding = useContext(MascotContext)
	if (binding === undefined)
		throw new Error("Mascot controls require a Mascot Provider.")
	return binding
}
