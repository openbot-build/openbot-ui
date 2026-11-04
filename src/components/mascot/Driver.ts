import {
	Array,
	Context,
	Data,
	Equal,
	HashMap,
	Match,
	Option,
	Schema,
} from "effect"
import { dual } from "effect/Function"
import { Expression, Placement, type Interface } from "./Model.ts"
import {
	Box,
	BoxKinematics,
	Kinematics,
	Pose,
	durations,
	directTravelLimit,
	idleSleep,
	neutral,
	sampleExpression,
	sampleLaunch,
	sampleIdle,
	sampleHandoff,
	sampleTravel,
	sideEnterDuration,
	sideExitDuration,
	stationary,
	stationaryBox,
	staticExpression,
	travelDistance,
} from "./Motion.ts"

export type Dispose = () => void

/** Browser resources are injected so suspension and disposal can use a deterministic clock. */
export class Browser extends Context.Service<
	Browser,
	{
		readonly now: () => number
		readonly hidden: () => boolean
		readonly reducedMotion: () => boolean
		readonly viewportBox: () => Box
		readonly launchBox: () => Box
		readonly fallbackBox: () => Box
		readonly requestFrame: (callback: () => void) => number
		readonly cancelFrame: (handle: number) => void
		readonly setTimer: (callback: () => void, milliseconds: number) => number
		readonly clearTimer: (handle: number) => void
		readonly onVisibility: (callback: () => void) => Dispose
		readonly onMotion: (callback: () => void) => Dispose
		readonly onLayout: (callback: () => void) => Dispose
	}
>()("@kaicom/e-web/components/mascot/Driver/Browser") {}

export const Boundary = Schema.Struct({
	id: Schema.String,
	box: Box,
	edge: Schema.Literals(["left", "right", "top"]),
})
export type Boundary = typeof Boundary.Type

export interface AnchorSource {
	readonly id: string
	readonly read: () => Option.Option<Box>
	readonly readBoundary: () => Option.Option<Boundary>
	readonly observe: (callback: () => void) => Dispose
}

export const Startup = Schema.Literals([
	"pending",
	"loading",
	"handoff",
	"ready",
	"skip",
])
export type Startup = typeof Startup.Type

export const Snapshot = Schema.Struct({
	startup: Startup,
	eyeColor: Schema.Option(Schema.String),
	traveling: Schema.Boolean,
	opacity: Schema.Finite,
	sideHandoff: Schema.Boolean,
	clipBox: Schema.Option(Box),
	renderRegion: Schema.Option(Schema.String),
	renderAnchor: Schema.Option(Schema.String),
	pose: Pose,
	box: Schema.Option(Box),
	placement: Placement,
	thinking: Schema.Boolean,
	reducedMotion: Schema.Boolean,
})
export type Snapshot = typeof Snapshot.Type

export interface Renderer {
	readonly initialPose?: Pose
	readonly initialBox?: Box
	readonly draw: (snapshot: Snapshot) => void
	readonly dispose: Dispose
}

const Face = Schema.Union([
	Schema.TaggedStruct("Idle", { startedAt: Schema.Finite, start: Kinematics }),
	Schema.TaggedStruct("Expression", {
		startedAt: Schema.Finite,
		start: Kinematics,
		expression: Expression,
	}),
])
type Face = typeof Face.Type

const Travel = Schema.Struct({
	launch: Schema.Boolean,
	startedAt: Schema.Finite,
	start: BoxKinematics,
	target: Box,
})
type Travel = typeof Travel.Type

const Side = Schema.Struct({
	phase: Schema.Literals(["exiting", "entering"]),
	edge: Schema.Literals(["left", "top"]),
	boundary: Box,
	startOpacity: Schema.Finite,
	pose: Pose,
	startedAt: Schema.Finite,
	start: BoxKinematics,
	target: Box,
})
type Side = typeof Side.Type

const Intro = Schema.Union([
	Schema.TaggedStruct("Returning", {}),
	Schema.TaggedStruct("Launching", {
		startedAt: Schema.Finite,
		greeted: Schema.Boolean,
		departed: Schema.Boolean,
	}),
])
type Intro = typeof Intro.Type

const Input = Schema.Struct({
	placement: Placement,
	thinking: Schema.Boolean,
	startup: Schema.optionalKey(Startup),
	eyeColor: Schema.optionalKey(Schema.String),
})
export type Input = typeof Input.Type
export interface Driver extends Interface {
	readonly setInput: (input: Input) => void
	readonly registerAnchor: (
		placement: Placement,
		source: AnchorSource,
	) => Dispose
	readonly dispose: Dispose
}

const idle = (startedAt: number, start = stationary): Face =>
	new Data.Class({ _tag: "Idle", startedAt, start })

const normalizeFace = (face: Face, time: number): Face =>
	Match.value(face).pipe(
		Match.tag("Expression", (run) =>
			time - run.startedAt < durations[run.expression]
				? run
				: normalizeFace(
						idle(
							run.startedAt + durations[run.expression],
							sampleExpression(
								run.expression,
								durations[run.expression],
								run.start,
							),
						),
						time,
					),
		),
		Match.tag("Idle", (run) =>
			time - run.startedAt < 22
				? run
				: normalizeFace(
						idle(run.startedAt + 22, sampleIdle(22, run.start)),
						time,
					),
		),
		Match.exhaustive,
	)
const sampleFace = (face: Face, time: number): Kinematics =>
	Match.value(normalizeFace(face, time)).pipe(
		Match.tag("Expression", (run) =>
			sampleExpression(run.expression, time - run.startedAt, run.start),
		),
		Match.tag("Idle", (run) => sampleIdle(time - run.startedAt, run.start)),
		Match.exhaustive,
	)

const autoSequence: ReadonlyArray<Expression> = [
	"curious",
	"winkLeft",
	"nod",
	"happy",
	"winkRight",
	"thinking",
]
const autoPauses = [7.2, 10.6, 8.3, 12.1, 9.4, 11.3] as const
const greetingTime = 0.3
const flightTime = 0.67

/** A synchronous browser boundary. Every semantic transition replaces an immutable value. */
export const makeDriver = dual<
	(renderer: Renderer, input: Input) => (browser: Browser["Service"]) => Driver,
	(browser: Browser["Service"], renderer: Renderer, input: Input) => Driver
>(3, (browser, renderer, input): Driver => {
	const startup = input.startup ?? "ready"
	const initialBox =
		startup === "loading" || startup === "handoff"
			? browser.launchBox()
			: startup === "skip" && renderer.initialBox !== undefined
				? renderer.initialBox
				: browser.fallbackBox()
	const initialFace = Kinematics.make({
		pose: renderer.initialPose ?? neutral,
		velocity: stationary.velocity,
	})
	let state = new Data.Class({
		time: 0,
		wallTime: browser.now(),
		hidden: browser.hidden(),
		reducedMotion: browser.reducedMotion(),
		disposed: false,
		startup,
		eyeColor: Option.fromUndefinedOr(input.eyeColor),
		restoring: startup === "skip",
		launchPending: startup === "handoff",
		placement: input.placement,
		actualPlacement: input.placement,
		thinking: input.thinking,
		face:
			input.thinking || startup === "loading"
				? new Data.Class<Face>({
						_tag: "Expression",
						expression: input.thinking ? "thinking" : "winkRight",
						startedAt: 0,
						start: initialFace,
					})
				: idle(0, initialFace),
		feedback: Option.none<Expression>(),
		position: Option.some(stationaryBox(initialBox)),
		destination: Option.some(initialBox),
		positionBoundary: Option.none<Boundary>(),
		destinationBoundary: Option.none<Boundary>(),
		positionAnchor: Option.none<string>(),
		destinationAnchor: Option.none<string>(),
		travel: Option.none<Travel>(),
		side: Option.none<Side>(),
		routeOrigin: initialBox,
		intro: Option.none<Intro>(),
		started: startup === "handoff",
		autoIndex: 0,
		nextAutoAt: autoPauses[0] as number,
	})
	let anchors = HashMap.empty<
		number,
		{
			readonly placement: Placement
			readonly source: AnchorSource
			readonly cleanup: Dispose
		}
	>()
	let nextAnchor = 0
	// Only browser resource handles are mutable outside the immutable state.
	let frame = 0
	let timer = 0

	const syncTime = () => {
		const wallTime = browser.now()
		const time =
			state.time +
			(state.hidden || state.reducedMotion
				? 0
				: Math.max(0, wallTime - state.wallTime) / 1000)
		state = new Data.Class({
			...state,
			wallTime,
			time,
			face: normalizeFace(state.face, time),
		})
	}
	const cancel = () => {
		if (frame !== 0) browser.cancelFrame(frame)
		if (timer !== 0) browser.clearTimer(timer)
		frame = timer = 0
	}
	const positionAt = (time: number): Option.Option<BoxKinematics> =>
		Option.match(state.side, {
			onSome: (run) =>
				Option.some(
					sampleHandoff(
						run.start,
						run.target,
						time - run.startedAt,
						run.phase === "exiting" ? sideExitDuration : sideEnterDuration,
					),
				),
			onNone: () =>
				Option.match(state.travel, {
					onSome: (run) =>
						Option.some(
							run.launch
								? sampleLaunch(run.start, run.target, time - run.startedAt)
								: sampleTravel(run.start, run.target, time - run.startedAt),
						),
					onNone: () => state.position,
				}),
		})
	const movementTarget = (): Box =>
		Option.isSome(state.intro) && state.intro.value._tag === "Returning"
			? browser.launchBox()
			: Option.getOrElse(state.destination, browser.fallbackBox)
	const movementBoundary = (): Option.Option<Boundary> =>
		Option.isSome(state.intro) && state.intro.value._tag === "Returning"
			? Option.none()
			: state.destinationBoundary
	const movementAnchor = (): Option.Option<string> =>
		Option.isSome(state.intro) && state.intro.value._tag === "Returning"
			? Option.none()
			: state.destinationAnchor
	const opacityAt = (time: number): number =>
		Option.match(state.side, {
			onNone: () => 1,
			onSome: (run) => {
				const duration =
					run.phase === "exiting" ? sideExitDuration : sideEnterDuration
				const progress = Math.max(
					0,
					Math.min(1, (time - run.startedAt) / duration),
				)
				const eased = progress * progress * (3 - 2 * progress)
				return run.phase === "exiting" ? run.startOpacity * (1 - eased) : eased
			},
		})
	const localEdge = (box: Box): Side["edge"] =>
		Array.some(
			Array.fromIterable(HashMap.values(anchors)),
			(anchor) =>
				anchor.placement === "header" &&
				!Option.exists(
					anchor.source.readBoundary(),
					(boundary) => boundary.id === "surface",
				) &&
				Option.exists(
					anchor.source.read(),
					(header) =>
						Math.abs(box.x - header.x) <= header.width / 2 &&
						Math.abs(box.y - header.y) <= header.height / 2,
				),
		)
			? "top"
			: "left"
	const offset = (box: Box, edge: Side["edge"]): Box =>
		Match.value(edge).pipe(
			Match.when("left", () =>
				Box.make({
					...box,
					x: box.x - 32,
				}),
			),
			Match.when("top", () =>
				Box.make({
					...box,
					y: box.y - 24,
				}),
			),
			Match.exhaustive,
		)
	const beginSideExit = (start: BoxKinematics) => {
		const boundary = Option.match(state.side, {
			onSome: (run) => run.boundary,
			onNone: () =>
				Option.match(state.positionBoundary, {
					onSome: (value) => value.box,
					onNone: browser.viewportBox,
				}),
		})
		const edge =
			Option.isSome(state.side) && state.side.value.phase === "entering"
				? state.side.value.edge
				: localEdge(start.box)
		const startOpacity = opacityAt(state.time)
		const pose = Option.match(state.side, {
			onSome: (run) => run.pose,
			onNone: () => sampleFace(state.face, state.time).pose,
		})
		state = new Data.Class({
			...state,
			position: Option.some(start),
			travel: Option.none(),
			side: Option.some(
				new Data.Class({
					phase: "exiting" as const,
					edge,
					boundary,
					startOpacity,
					pose,
					startedAt: state.time,
					start,
					target: offset(start.box, edge),
				}),
			),
		})
	}
	const moveTo = (target: Box, start: BoxKinematics, launch = false) => {
		if (launch) {
			// The launch identity shrinks directly into the page; ordinary region
			// exits and travel budgets apply only after this handoff settles.
			state = new Data.Class({
				...state,
				position: Option.some(start),
				positionBoundary: Option.none(),
				positionAnchor: Option.none(),
				travel: Option.some(
					new Data.Class({ launch, startedAt: state.time, start, target }),
				),
				side: Option.none(),
			})
			return
		}
		// A departing character finishes its one exit while destinations coalesce.
		if (Option.isSome(state.side) && state.side.value.phase === "exiting")
			return
		const moving = Option.isSome(state.travel) || Option.isSome(state.side)
		const sameRegion =
			Option.getOrUndefined(state.positionBoundary)?.id ===
			Option.getOrUndefined(movementBoundary())?.id
		if (!moving && sameRegion && travelDistance(start.box, target) === 0) {
			settle(target)
			return
		}
		const origin = moving ? state.routeOrigin : start.box
		const entering =
			Option.isSome(state.side) && state.side.value.phase === "entering"
		const safety =
			entering && Option.isSome(state.side)
				? Box.make({
						...start.box,
						...(state.side.value.edge === "top"
							? { y: origin.y }
							: { x: origin.x }),
					})
				: start.box
		const limit = directTravelLimit(browser.viewportBox())
		state = new Data.Class({
			...state,
			routeOrigin: origin,
			position: Option.some(start),
		})
		if (
			!sameRegion ||
			!Equal.equals(state.positionAnchor, movementAnchor()) ||
			travelDistance(safety, target) > limit ||
			travelDistance(origin, target) > limit
		) {
			beginSideExit(start)
		} else if (entering && Option.isSome(state.side)) {
			const boundary = movementBoundary()
			state = new Data.Class({
				...state,
				positionBoundary: boundary,
				positionAnchor: movementAnchor(),
				side: Option.some(
					new Data.Class({
						...state.side.value,
						boundary: Option.match(boundary, {
							onSome: (value) => value.box,
							onNone: browser.viewportBox,
						}),
						startedAt: state.time,
						start,
						target,
					}),
				),
			})
		} else {
			state = new Data.Class({
				...state,
				travel: Option.some(
					new Data.Class({ launch, startedAt: state.time, start, target }),
				),
			})
		}
	}
	const settle = (target: Box) => {
		const face = Option.match(state.side, {
			onNone: () => state.face,
			onSome: (run) => {
				const start = Kinematics.make({
					pose: run.pose,
					velocity: stationary.velocity,
				})
				return state.thinking
					? new Data.Class<Face>({
							_tag: "Expression",
							expression: "thinking",
							startedAt: state.time,
							start,
						})
					: idle(state.time, start)
			},
		})
		state = new Data.Class({
			...state,
			face,
			nextAutoAt: Option.isSome(state.side)
				? Math.max(state.nextAutoAt, state.time + 2)
				: state.nextAutoAt,
			position: Option.some(stationaryBox(target)),
			positionBoundary: movementBoundary(),
			positionAnchor: movementAnchor(),
			travel: Option.none(),
			side: Option.none(),
			routeOrigin: target,
		})
	}
	const followLayout = (previous: Box, target: Box) => {
		if (Option.isSome(state.side) && state.side.value.phase === "exiting")
			return
		if (Option.isNone(state.travel) && Option.isNone(state.side)) {
			settle(target)
			return
		}
		const boundary = Option.match(movementBoundary(), {
			onSome: (value) => value.box,
			onNone: browser.viewportBox,
		})
		const widthScale = target.width / previous.width
		const heightScale = target.height / previous.height
		const box = (value: Box): Box =>
			Box.make({
				x: target.x + value.x - previous.x,
				y: target.y + value.y - previous.y,
				width: value.width * widthScale,
				height: value.height * heightScale,
			})
		const kinematics = (value: BoxKinematics): BoxKinematics =>
			BoxKinematics.make({
				box: box(value.box),
				velocity: Box.make({
					x: value.velocity.x,
					y: value.velocity.y,
					width: value.velocity.width * widthScale,
					height: value.velocity.height * heightScale,
				}),
			})
		// Layout moves the existing journey with its owner, preserving its elapsed time.
		state = new Data.Class({
			...state,
			position: Option.map(state.position, kinematics),
			routeOrigin: box(state.routeOrigin),
			travel: Option.map(
				state.travel,
				(run) =>
					new Data.Class({ ...run, start: kinematics(run.start), target }),
			),
			side: Option.map(
				state.side,
				(run) =>
					new Data.Class({
						...run,
						start: kinematics(run.start),
						target,
						boundary,
					}),
			),
		})
	}
	const updateGeometry = () => {
		const position = positionAt(state.time)
		if (Option.isNone(position)) return
		if (Option.isSome(state.side) && state.side.value.phase === "exiting") {
			const run = state.side.value
			state = new Data.Class({ ...state, position })
			if (state.time - run.startedAt < sideExitDuration) return
			const target = movementTarget()
			const region = movementBoundary()
			const boundary = Option.match(region, {
				onSome: (value) => value.box,
				onNone: browser.viewportBox,
			})
			const edge = localEdge(target)
			const start = stationaryBox(offset(target, edge))
			// Transfer the same node to its destination only while fully transparent.
			state = new Data.Class({
				...state,
				position: Option.some(start),
				positionBoundary: region,
				positionAnchor: movementAnchor(),
				routeOrigin: target,
				side: Option.some(
					new Data.Class({
						phase: "entering" as const,
						edge,
						boundary,
						startOpacity: 0,
						pose: state.thinking ? staticExpression("thinking") : neutral,
						startedAt: state.time,
						start,
						target,
					}),
				),
			})
			return
		}
		if (Option.isSome(state.side)) {
			const run = state.side.value
			state = new Data.Class({ ...state, position })
			if (state.time - run.startedAt >= sideEnterDuration) settle(run.target)
			return
		}
		if (Option.exists(state.travel, (run) => run.launch)) {
			state = new Data.Class({ ...state, position })
			if (
				Option.isSome(state.travel) &&
				state.time - state.travel.value.startedAt >= 1.2
			)
				settle(state.travel.value.target)
			return
		}
		if (
			Option.isSome(state.travel) &&
			travelDistance(state.routeOrigin, position.value.box) >
				directTravelLimit(browser.viewportBox())
		) {
			// Reject momentum beyond the same route budget before that frame is drawn.
			beginSideExit(Option.getOrElse(state.position, () => position.value))
			return
		}
		state = new Data.Class({ ...state, position })
		if (
			Option.isSome(state.travel) &&
			state.time - state.travel.value.startedAt >= 1.2
		)
			settle(state.travel.value.target)
	}
	const playAt = (expression: Expression, time: number) => {
		state = new Data.Class({
			...state,
			face: new Data.Class<Face>({
				_tag: "Expression",
				expression,
				startedAt: time,
				start: sampleFace(state.face, time),
			}),
			feedback: Option.some(expression),
			nextAutoAt: Math.max(state.nextAutoAt, time + durations[expression] + 2),
		})
	}
	const updateIntro = () => {
		if (Option.isNone(state.intro)) return
		const run = state.intro.value
		const moving = Option.isSome(state.travel) || Option.isSome(state.side)
		if (run._tag === "Returning") {
			if (!moving)
				state = new Data.Class({
					...state,
					intro: Option.some(
						new Data.Class({
							_tag: "Launching" as const,
							startedAt: state.time,
							greeted: false,
							departed: false,
						}),
					),
				})
			return
		}
		const elapsed = state.time - run.startedAt
		if (!run.greeted && elapsed >= greetingTime) {
			if (!state.thinking) playAt("winkRight", state.time)
			state = new Data.Class({
				...state,
				intro: Option.some(new Data.Class({ ...run, greeted: true })),
			})
		}
		if (!run.departed && elapsed >= flightTime) {
			state = new Data.Class({
				...state,
				intro: Option.some(
					new Data.Class({ ...run, greeted: true, departed: true }),
				),
			})
			Option.match(state.position, {
				onNone: () => {},
				onSome: (start) => moveTo(movementTarget(), start, true),
			})
		} else if (run.departed && !moving) {
			state = new Data.Class({ ...state, intro: Option.none() })
		}
	}
	const draw = () => {
		const pose = Option.isSome(state.side)
			? state.side.value.pose
			: state.reducedMotion
				? Option.match(state.feedback, {
						onSome: staticExpression,
						onNone: () =>
							state.thinking ? staticExpression("thinking") : neutral,
					})
				: sampleFace(state.face, state.time).pose
		renderer.draw({
			startup: state.startup,
			eyeColor: state.eyeColor,
			opacity: opacityAt(state.time),
			traveling:
				Option.isSome(state.travel) ||
				Option.isSome(state.side) ||
				Option.isSome(state.intro),
			sideHandoff: Option.isSome(state.side),
			clipBox: Option.map(state.side, (run) => run.boundary),
			renderRegion: Option.map(
				state.positionBoundary,
				(boundary) => boundary.id,
			),
			renderAnchor: state.positionAnchor,
			pose,
			box: Option.flatMap(state.destination, () =>
				Option.map(positionAt(state.time), (value) => value.box),
			),
			placement: state.actualPlacement,
			thinking: state.thinking,
			reducedMotion: state.reducedMotion,
		})
	}
	const geometrySleep = (): number => {
		if (Option.isSome(state.travel) || Option.isSome(state.side)) return 0
		if (Option.isNone(state.intro)) return Infinity
		const run = state.intro.value
		if (run._tag === "Returning") return 0
		const elapsed = state.time - run.startedAt
		return Math.max(0, (!run.greeted ? greetingTime : flightTime) - elapsed)
	}
	const schedule = () => {
		cancel()
		if (
			state.disposed ||
			state.hidden ||
			state.reducedMotion ||
			Option.isNone(state.destination)
		)
			return
		const faceSleep = Match.value(state.face).pipe(
			Match.tag("Expression", () => 0),
			Match.tag("Idle", (run) => idleSleep(state.time - run.startedAt)),
			Match.exhaustive,
		)
		const delay = Math.min(
			faceSleep,
			geometrySleep(),
			Math.max(0, state.nextAutoAt - state.time),
		)
		if (delay <= 0)
			frame = browser.requestFrame(() => {
				frame = 0
				cycle()
			})
		else
			timer = browser.setTimer(
				() => {
					timer = 0
					cycle()
				},
				Math.max(1, delay * 1000),
			)
	}
	const cycle = () => {
		if (state.disposed || state.hidden) return
		syncTime()
		updateGeometry()
		updateIntro()
		if (
			!state.reducedMotion &&
			Option.isNone(state.side) &&
			state.time >= state.nextAutoAt
		) {
			const expression = autoSequence[state.autoIndex % autoSequence.length]!
			playAt(expression, state.time)
			const autoIndex = state.autoIndex + 1
			state = new Data.Class({
				...state,
				autoIndex,
				nextAutoAt: state.time + autoPauses[autoIndex % autoPauses.length]!,
			})
		}
		draw()
		schedule()
	}
	const refreshLayout = () => {
		if (state.disposed || state.hidden) return
		syncTime()
		updateGeometry()
		const candidates = Array.flatMap(
			Array.fromIterable(anchors),
			([id, anchor]) =>
				Option.toArray(
					Option.map(
						anchor.source.read(),
						(box) =>
							new Data.Class({
								id,
								anchorId: anchor.source.id,
								placement: anchor.placement,
								box,
								boundary: Option.map(
									anchor.source.readBoundary(),
									(value) => new Data.Class(value),
								),
							}),
					),
				),
		)
		const latest = (placement: Placement) =>
			Array.reduce(
				candidates,
				Option.none<(typeof candidates)[number]>(),
				(best, candidate) =>
					candidate.placement !== placement
						? best
						: Option.match(best, {
								onNone: () => Option.some(candidate),
								onSome: (previous) =>
									candidate.id > previous.id ? Option.some(candidate) : best,
							}),
			)
		const chosen = Option.orElse(latest(state.placement), () =>
			Option.orElse(latest(state.actualPlacement), () => latest("header")),
		)
		const destination = Option.some(
			state.restoring
				? initialBox
				: state.startup === "loading"
					? browser.launchBox()
					: state.startup === "pending"
						? browser.fallbackBox()
						: Option.match(chosen, {
								onNone: () => browser.fallbackBox(),
								onSome: ({ box }) => box,
							}),
		)
		const current = positionAt(state.time)
		const destinationBoundary =
			state.restoring ||
			state.startup === "loading" ||
			state.startup === "pending"
				? Option.none<Boundary>()
				: Option.flatMap(chosen, (value) => value.boundary)
		const destinationAnchor =
			state.restoring ||
			state.startup === "loading" ||
			state.startup === "pending"
				? Option.none<string>()
				: Option.map(chosen, (value) => value.anchorId)
		const previousDestination = state.destination
		const layoutOnly =
			Option.isSome(destinationAnchor) &&
			Equal.equals(destinationAnchor, state.destinationAnchor) &&
			Option.getOrUndefined(destinationBoundary)?.id ===
				Option.getOrUndefined(state.destinationBoundary)?.id &&
			Option.isNone(state.intro)
		const changed =
			!Equal.equals(destinationAnchor, state.destinationAnchor) ||
			!Equal.equals(destinationBoundary, state.destinationBoundary) ||
			!Option.match(destination, {
				onNone: () => Option.isNone(state.destination),
				onSome: (a) =>
					Option.match(state.destination, {
						onNone: () => false,
						onSome: (b) =>
							a.x === b.x &&
							a.y === b.y &&
							a.width === b.width &&
							a.height === b.height,
					}),
			})
		if (changed) {
			state = new Data.Class({
				...state,
				destination,
				destinationBoundary,
				destinationAnchor,
				positionBoundary:
					Option.isNone(state.side) &&
					Option.getOrUndefined(state.positionBoundary)?.id ===
						Option.getOrUndefined(destinationBoundary)?.id
						? destinationBoundary
						: state.positionBoundary,
				position: current,
				actualPlacement: Option.match(chosen, {
					onNone: () => state.actualPlacement,
					onSome: (value) => value.placement,
				}),
				intro: Option.none(),
			})
			Option.match(destination, {
				onNone: () => {},
				onSome: (target) => {
					if (
						state.reducedMotion ||
						state.startup === "pending" ||
						state.startup === "loading" ||
						!state.started
					) {
						state = new Data.Class({
							...state,
							started:
								state.startup !== "pending" && state.startup !== "loading",
							position: Option.some(stationaryBox(target)),
						})
						settle(target)
					} else if (
						Option.isSome(current) &&
						(state.launchPending ||
							Option.exists(state.travel, (run) => run.launch))
					) {
						// A moving launch target retargets from the drawn geometry and
						// velocity instead of shifting the whole in-progress path.
						moveTo(target, current.value, true)
					} else if (layoutOnly && Option.isSome(previousDestination)) {
						followLayout(previousDestination.value, target)
					} else if (Option.isSome(current)) {
						moveTo(target, current.value, state.launchPending)
					} else {
						state = new Data.Class({
							...state,
							position: Option.some(stationaryBox(target)),
						})
					}
				},
			})
		}
		state = new Data.Class({
			...state,
			launchPending: false,
			started:
				state.started ||
				(!state.restoring &&
					state.startup !== "pending" &&
					state.startup !== "loading" &&
					Option.isSome(chosen)),
		})
		cycle()
	}
	const visibilityChanged = () => {
		if (state.disposed) return
		syncTime()
		cancel()
		state = new Data.Class({ ...state, hidden: browser.hidden() })
		if (!state.hidden) refreshLayout()
	}
	const motionChanged = () => {
		if (state.disposed) return
		syncTime()
		cancel()
		const wasReduced = state.reducedMotion
		state = new Data.Class({
			...state,
			reducedMotion: browser.reducedMotion(),
		})
		if (state.reducedMotion) {
			const feedback = Match.value(state.face).pipe(
				Match.tag("Expression", (run) => Option.some(run.expression)),
				Match.tag("Idle", () => Option.none<Expression>()),
				Match.exhaustive,
			)
			state = new Data.Class({
				...state,
				feedback,
				started: Option.isSome(state.destination) || state.started,
				position: Option.map(state.destination, stationaryBox),
				positionBoundary: state.destinationBoundary,
				positionAnchor: state.destinationAnchor,
				travel: Option.none(),
				side: Option.none(),
				intro: Option.none(),
			})
		} else if (wasReduced) {
			const pose = Option.match(state.feedback, {
				onSome: staticExpression,
				onNone: () => (state.thinking ? staticExpression("thinking") : neutral),
			})
			state = new Data.Class({
				...state,
				face: idle(
					state.time,
					Kinematics.make({ pose, velocity: stationary.velocity }),
				),
			})
		}
		refreshLayout()
	}
	const cleanupVisibility = browser.onVisibility(visibilityChanged)
	const cleanupMotion = browser.onMotion(motionChanged)
	const cleanupLayout = browser.onLayout(refreshLayout)
	cycle()

	return {
		play: (expression) => {
			if (state.disposed) return
			syncTime()
			playAt(expression, state.time)
			cycle()
		},
		replayIntro: () => {
			if (state.disposed) return
			syncTime()
			Option.match(positionAt(state.time), {
				onNone: () => {
					state = new Data.Class({ ...state, started: false })
				},
				onSome: (start) => {
					if (!state.reducedMotion) {
						state = new Data.Class({
							...state,
							intro: Option.some(
								new Data.Class<Intro>({
									_tag: "Returning",
								}),
							),
						})
						moveTo(browser.launchBox(), start)
					}
				},
			})
			cycle()
		},
		setInput: (next) => {
			const startup = next.startup ?? "ready"
			const eyeColor = Option.fromUndefinedOr(next.eyeColor)
			if (state.disposed) return
			if (
				next.placement === state.placement &&
				next.thinking === state.thinking &&
				startup === state.startup
			) {
				if (!Equal.equals(eyeColor, state.eyeColor)) {
					state = new Data.Class({ ...state, eyeColor })
					if (!state.hidden) draw()
				}
				return
			}
			syncTime()
			if (next.thinking !== state.thinking) {
				if (next.thinking) playAt("thinking", state.time)
				else {
					state = new Data.Class({
						...state,
						feedback: Option.none(),
						face: Match.value(state.face).pipe(
							Match.tag("Expression", (run) =>
								Match.value(run.expression).pipe(
									Match.when("thinking", () =>
										idle(state.time, sampleFace(state.face, state.time)),
									),
									Match.orElse(() => run),
								),
							),
							Match.tag("Idle", (run) => run),
							Match.exhaustive,
						),
					})
				}
			}
			const launchPending =
				state.startup === "loading" &&
				(startup === "handoff" || startup === "ready")
			const restored = state.startup === "skip" && startup === "ready"
			const initial =
				restored ||
				state.startup === "pending" ||
				(startup === "skip" && state.startup !== "skip")
			state = new Data.Class({
				...state,
				...next,
				startup,
				eyeColor,
				restoring: state.restoring && startup === "skip",
				launchPending,
				started: launchPending || (!initial && state.started),
				...(startup === "skip" && state.startup !== "skip"
					? {
							position: Option.map(state.destination, stationaryBox),
							positionBoundary: state.destinationBoundary,
							positionAnchor: state.destinationAnchor,
							travel: Option.none<Travel>(),
							side: Option.none<Side>(),
							intro: Option.none<Intro>(),
						}
					: {}),
			})
			refreshLayout()
			if (restored || (startup === "skip" && !state.restoring))
				state = new Data.Class({ ...state, started: true })
		},
		registerAnchor: (placement, source) => {
			if (state.disposed) return () => {}
			const id = nextAnchor++
			const cleanup = source.observe(refreshLayout)
			anchors = HashMap.set(anchors, id, { placement, source, cleanup })
			refreshLayout()
			return () => {
				if (!HashMap.has(anchors, id)) return
				cleanup()
				anchors = HashMap.remove(anchors, id)
				refreshLayout()
			}
		},
		dispose: () => {
			if (state.disposed) return
			cancel()
			state = new Data.Class({ ...state, disposed: true })
			cleanupVisibility()
			cleanupMotion()
			cleanupLayout()
			Array.forEach(Array.fromIterable(HashMap.values(anchors)), (anchor) =>
				anchor.cleanup(),
			)
			anchors = HashMap.empty()
			renderer.dispose()
		},
	}
})
