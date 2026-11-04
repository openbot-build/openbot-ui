import { Array, Data, HashSet, Match, Schema } from "effect"
import { dual } from "effect/Function"
import type { Expression } from "./Model.ts"

// Ported from kay-web/mascot.js and kay-app/KAI/MascotMotion.swift.
export const channels = [
	"leftHeight",
	"rightHeight",
	"leftWidth",
	"rightWidth",
	"x",
	"y",
	"leftY",
	"rightY",
] as const
type Channel = (typeof channels)[number]
const dimensions: HashSet.HashSet<Channel> = HashSet.fromIterable<Channel>([
	"leftHeight",
	"rightHeight",
	"leftWidth",
	"rightWidth",
])

export class Pose extends Schema.Class<Pose>("MascotPose")({
	leftHeight: Schema.Finite,
	rightHeight: Schema.Finite,
	leftWidth: Schema.Finite,
	rightWidth: Schema.Finite,
	x: Schema.Finite,
	y: Schema.Finite,
	leftY: Schema.Finite,
	rightY: Schema.Finite,
}) {}

const poseFrom = (f: (channel: Channel) => number): Pose =>
	Pose.make({
		leftHeight: f("leftHeight"),
		rightHeight: f("rightHeight"),
		leftWidth: f("leftWidth"),
		rightWidth: f("rightWidth"),
		x: f("x"),
		y: f("y"),
		leftY: f("leftY"),
		rightY: f("rightY"),
	})

export const neutral = poseFrom((key) => (HashSet.has(dimensions, key) ? 1 : 0))
export const zero = poseFrom(() => 0)

export class Kinematics extends Schema.Class<Kinematics>("MascotKinematics")({
	pose: Pose,
	velocity: Pose,
}) {}

export const stationary = Kinematics.make({ pose: neutral, velocity: zero })

export class Scalar extends Schema.Class<Scalar>("MascotScalar")({
	value: Schema.Finite,
	velocity: Schema.Finite,
}) {}

/** Analytic spring integration retains velocity across every target change. */
export const advance: {
	(
		time: number,
		target: number,
		response: number,
		damping: number,
	): (state: Scalar) => Scalar
	(
		state: Scalar,
		time: number,
		target: number,
		response: number,
		damping: number,
	): Scalar
} = dual(
	5,
	(
		state: Scalar,
		time: number,
		target: number,
		response: number,
		damping: number,
	): Scalar => {
		if (time <= 0) return state
		const omega = (2 * Math.PI) / response
		const delta = state.value - target
		if (damping >= 1) {
			const b = state.velocity + omega * delta
			const decay = Math.exp(-omega * time)
			return Scalar.make({
				value: target + (delta + b * time) * decay,
				velocity: (b - omega * (delta + b * time)) * decay,
			})
		}
		const decayRate = damping * omega
		const frequency = omega * Math.sqrt(1 - damping * damping)
		const b = (state.velocity + decayRate * delta) / frequency
		const decay = Math.exp(-decayRate * time)
		const cosine = Math.cos(frequency * time)
		const sine = Math.sin(frequency * time)
		return Scalar.make({
			value: target + decay * (delta * cosine + b * sine),
			velocity:
				decay *
				((b * frequency - decayRate * delta) * cosine -
					(delta * frequency + decayRate * b) * sine),
		})
	},
)

const Cue = Schema.Tuple([
	Schema.Finite,
	Schema.Finite,
	Schema.Finite,
	Schema.Finite,
])
type Cue = typeof Cue.Type
type Tracks = Readonly<Partial<Record<Channel, ReadonlyArray<Cue>>>>
const shift = (cues: ReadonlyArray<Cue>, delay: number): ReadonlyArray<Cue> =>
	Array.map(cues, ([time, value, response, damping]) => [
		time + delay,
		value,
		response,
		damping,
	])

export const durations = new Data.Class({
	winkLeft: 1.45,
	winkRight: 1.45,
	happy: 1.85,
	curious: 2.65,
	surprised: 1.75,
	thinking: 2.85,
	nod: 1.6,
	sleepy: 3.35,
})
export const representative = new Data.Class({
	winkLeft: 0.27,
	winkRight: 0.27,
	happy: 0.38,
	curious: 0.46,
	surprised: 0.36,
	thinking: 0.75,
	nod: 0.34,
	sleepy: 1.55,
})

const wink = (left: boolean): Tracks => {
	const closed: ReadonlyArray<Cue> = [
		[0, 1.025, 0.2, 0.95],
		[0.1, 0.075, 0.14, 1],
		[0.3, 1, 0.3, 0.79],
	]
	const open: ReadonlyArray<Cue> = [
		[0.145, 0.89, 0.25, 0.94],
		[0.34, 1, 0.33, 0.84],
	]
	const width: ReadonlyArray<Cue> = [
		[0.14, 1.045, 0.2, 0.95],
		[0.34, 1, 0.36, 0.82],
	]
	const direction = left ? -1 : 1
	return new Data.Class({
		leftHeight: left ? closed : open,
		rightHeight: left ? open : closed,
		leftWidth: left ? width : [],
		rightWidth: left ? [] : width,
		x: [
			[0, -direction * 0.008, 0.22, 1],
			[0.15, direction * 0.025, 0.22, 0.68],
			[0.46, 0, 0.44, 0.78],
		],
		y: [
			[0, 0.012, 0.2, 1],
			[0.15, -0.019, 0.26, 0.65],
			[0.43, 0, 0.43, 0.78],
		],
	})
}

const expressionTracks = (expression: Expression): Tracks =>
	Match.value(expression).pipe(
		Match.when("winkLeft", () => wink(true)),
		Match.when("winkRight", () => wink(false)),
		Match.when("happy", (): Tracks => {
			const height: ReadonlyArray<Cue> = [
				[0, 0.72, 0.21, 1],
				[0.12, 0.29, 0.2, 1],
				[0.52, 0.4, 0.2, 0.9],
				[0.68, 0.27, 0.19, 1],
				[0.98, 1, 0.4, 0.85],
			]
			const width: ReadonlyArray<Cue> = [
				[0.045, 1.045, 0.22, 0.85],
				[1.02, 1, 0.36, 0.88],
			]
			const eyeY: ReadonlyArray<Cue> = [
				[0.135, -0.005, 0.24, 0.7],
				[0.42, 0, 0.3, 0.8],
			]
			return new Data.Class({
				leftHeight: height,
				rightHeight: shift(height, 0.032),
				leftWidth: width,
				rightWidth: shift(width, 0.028),
				y: [
					[0, 0.024, 0.2, 1],
					[0.12, -0.066, 0.26, 0.6],
					[0.41, 0.009, 0.25, 0.8],
					[0.6, -0.038, 0.23, 0.68],
					[0.85, 0, 0.35, 0.77],
				],
				leftY: eyeY,
				rightY: shift(eyeY, 0.038),
			})
		}),
		Match.when(
			"curious",
			(): Tracks =>
				new Data.Class({
					x: [
						[0, 0.008, 0.18, 1],
						[0.09, -0.066, 0.23, 0.7],
						[0.54, 0.072, 0.2, 0.73],
						[1.27, 0.06, 0.3, 0.92],
						[1.58, 0, 0.54, 0.92],
					],
					y: [
						[0.135, -0.012, 0.32, 0.88],
						[0.585, -0.02, 0.27, 0.84],
						[1.63, 0, 0.52, 0.95],
					],
					leftHeight: [
						[0.14, 0.86, 0.3, 0.92],
						[0.59, 1.025, 0.25, 0.9],
						[1.61, 1, 0.38, 0.94],
					],
					rightHeight: [
						[0.175, 1.025, 0.27, 0.9],
						[0.625, 0.86, 0.27, 0.92],
						[1.65, 1, 0.36, 0.9],
					],
				}),
		),
		Match.when("surprised", (): Tracks => {
			const height: ReadonlyArray<Cue> = [
				[0, 0.68, 0.18, 1],
				[0.115, 1.09, 0.22, 0.86],
				[0.61, 1.02, 0.28, 0.88],
				[0.9, 1, 0.4, 0.95],
			]
			const width: ReadonlyArray<Cue> = [
				[0.13, 1.09, 0.25, 0.83],
				[0.65, 1, 0.4, 0.9],
			]
			return new Data.Class({
				leftHeight: height,
				rightHeight: shift(height, 0.022),
				leftWidth: width,
				rightWidth: shift(width, 0.018),
				y: [
					[0, 0.012, 0.18, 1],
					[0.135, -0.045, 0.25, 0.62],
					[0.56, 0, 0.5, 0.85],
				],
			})
		}),
		Match.when("thinking", (): Tracks => {
			const height: ReadonlyArray<Cue> = [
				[0.17, 0.79, 0.34, 0.98],
				[1.03, 0.11, 0.1, 1],
				[1.14, 0.79, 0.2, 0.86],
				[1.83, 1, 0.34, 0.88],
			]
			return new Data.Class({
				x: [
					[0.11, 0.032, 0.24, 0.78],
					[0.91, 0.018, 0.25, 0.86],
					[1.36, 0.039, 0.24, 0.78],
					[1.85, 0, 0.5, 0.92],
				],
				y: [
					[0.06, -0.038, 0.3, 0.82],
					[1.41, -0.029, 0.3, 0.9],
					[1.88, 0, 0.5, 0.93],
				],
				leftHeight: height,
				rightHeight: shift(height, 0.035),
			})
		}),
		Match.when("nod", (): Tracks => {
			const height: ReadonlyArray<Cue> = [
				[0.165, 0.68, 0.19, 1],
				[0.37, 1, 0.25, 0.84],
				[0.6, 0.81, 0.18, 1],
				[0.78, 1, 0.3, 0.88],
			]
			return new Data.Class({
				y: [
					[0, -0.015, 0.18, 0.94],
					[0.12, 0.057, 0.21, 0.78],
					[0.32, -0.013, 0.26, 0.67],
					[0.55, 0.032, 0.19, 0.83],
					[0.74, 0, 0.36, 0.8],
				],
				leftHeight: height,
				rightHeight: shift(height, 0.024),
			})
		}),
		Match.when("sleepy", (): Tracks => {
			const height: ReadonlyArray<Cue> = [
				[0.05, 0.56, 0.85, 1],
				[0.63, 0.35, 0.6, 1],
				[1.09, 0.075, 0.7, 1],
				[1.91, 1.07, 0.2, 0.91],
				[2.17, 1, 0.5, 0.95],
			]
			return new Data.Class({
				leftHeight: height,
				rightHeight: shift(height, 0.065),
				y: [
					[0.1, 0.012, 0.85, 1],
					[1.14, 0.037, 0.65, 1],
					[1.94, -0.034, 0.23, 0.65],
					[2.2, 0, 0.45, 0.85],
				],
			})
		}),
		Match.exhaustive,
	)

const blinks = Array.flatMap(
	[4.1, 10.2, 10.55, 16.4],
	(time): ReadonlyArray<Cue> => [
		[time, 0.1, 0.095, 1],
		[time + 0.1, 1, 0.18, 0.88],
	],
)
const idleTracks: Tracks = new Data.Class({
	leftHeight: blinks,
	rightHeight: Array.flatMap(
		[4.1, 10.2, 10.55, 16.4],
		(time): ReadonlyArray<Cue> => [
			[time + 0.018, 0.1, 0.095, 1],
			[time + 0.12, 1, 0.18, 0.88],
		],
	),
	x: [
		[2.3, 0.014, 0.25, 0.92],
		[3.4, 0, 0.65, 1],
		[7.1, -0.012, 0.3, 0.95],
		[8.6, 0, 0.8, 1],
		[13.9, 0.009, 0.3, 0.9],
		[15.1, 0, 0.7, 1],
	],
	y: [
		[2.34, -0.004, 0.36, 0.95],
		[3.5, 0, 0.8, 1],
		[13.95, -0.005, 0.4, 1],
		[15.2, 0, 0.8, 1],
	],
})

const sample = (
	tracks: Tracks,
	elapsed: number,
	start: Kinematics,
): Kinematics => {
	if (elapsed <= 0) return start
	const channel = (key: Channel): Scalar => {
		const dimension = HashSet.has(dimensions, key)
		const initial = start.pose[key]
		const beginning = new Data.Class({
			scalar: Scalar.make({
				value: dimension ? Math.log(initial) : initial,
				velocity: dimension
					? start.velocity[key] / initial
					: start.velocity[key],
			}),
			target: 0,
			response: 0.28,
			damping: 0.9,
			previous: 0,
		})
		const segment = Array.reduce(
			tracks[key] ?? [],
			beginning,
			(current, cue) =>
				cue[0] > elapsed
					? current
					: new Data.Class({
							scalar: advance(
								current.scalar,
								cue[0] - current.previous,
								current.target,
								current.response,
								current.damping,
							),
							target: dimension ? Math.log(cue[1]) : cue[1],
							response: cue[2],
							damping: cue[3],
							previous: cue[0],
						}),
		)
		const result = advance(
			segment.scalar,
			elapsed - segment.previous,
			segment.target,
			segment.response,
			segment.damping,
		)
		const value = dimension ? Math.exp(result.value) : result.value
		return Scalar.make({
			value,
			velocity: dimension ? value * result.velocity : result.velocity,
		})
	}
	// Sample once per channel; dimensions and their derivatives share the same solution.
	const values = new Data.Class({
		leftHeight: channel("leftHeight"),
		rightHeight: channel("rightHeight"),
		leftWidth: channel("leftWidth"),
		rightWidth: channel("rightWidth"),
		x: channel("x"),
		y: channel("y"),
		leftY: channel("leftY"),
		rightY: channel("rightY"),
	})
	return Kinematics.make({
		pose: poseFrom((key) => values[key].value),
		velocity: poseFrom((key) => values[key].velocity),
	})
}

export const sampleExpression: {
	(elapsed: number, start?: Kinematics): (expression: Expression) => Kinematics
	(expression: Expression, elapsed: number, start?: Kinematics): Kinematics
} = dual(
	(args) => typeof args[0] === "string",
	(expression: Expression, elapsed: number, start = stationary): Kinematics =>
		sample(expressionTracks(expression), elapsed, start),
)
export const sampleIdle: {
	(start?: Kinematics): (elapsed: number) => Kinematics
	(elapsed: number, start?: Kinematics): Kinematics
} = dual(
	(args) => typeof args[0] === "number",
	(elapsed: number, start = stationary): Kinematics =>
		sample(idleTracks, elapsed, start),
)
export const staticExpression = (expression: Expression): Pose =>
	sampleExpression(expression, representative[expression]).pose

export class Box extends Schema.Class<Box>("MascotBox")({
	x: Schema.Finite,
	y: Schema.Finite,
	width: Schema.Finite,
	height: Schema.Finite,
}) {}
export class BoxKinematics extends Schema.Class<BoxKinematics>(
	"MascotBoxKinematics",
)({
	box: Box,
	velocity: Box,
}) {}
export const stationaryBox = (box: Box): BoxKinematics =>
	BoxKinematics.make({
		box,
		velocity: Box.make({ x: 0, y: 0, width: 0, height: 0 }),
	})

/** Autonomous motion stays below half of the shortest viewport edge. */
export const directTravelLimit = (viewport: Box): number =>
	Math.min(180, Math.min(viewport.width, viewport.height) * 0.45)

export const travelDistance: {
	(to: Box): (from: Box) => number
	(from: Box, to: Box): number
} = dual(
	2,
	(from: Box, to: Box): number =>
		Math.hypot(to.x - from.x, to.y - from.y) +
		Math.max(
			Math.abs(to.width - from.width),
			Math.abs(to.height - from.height),
		) /
			2,
)

export const sideExitDuration = 0.18
export const sideEnterDuration = 0.22

/** A bounded slide keeps its perpendicular lane fixed while opacity changes. */
export const sampleHandoff: {
	(
		target: Box,
		elapsed: number,
		duration: number,
	): (start: BoxKinematics) => BoxKinematics
	(
		start: BoxKinematics,
		target: Box,
		elapsed: number,
		duration: number,
	): BoxKinematics
} = dual(
	4,
	(
		start: BoxKinematics,
		target: Box,
		elapsed: number,
		duration: number,
	): BoxKinematics => {
		const t = Math.max(0, Math.min(1, elapsed / duration))
		const axis = target.y === start.box.y ? "x" : "y"
		const delta = target[axis] - start.box[axis]
		const direction = Math.sign(delta)
		const velocity =
			direction *
			Math.min(
				Math.max(0, start.velocity[axis] * direction),
				(Math.abs(delta) * 3) / duration,
			)
		const position =
			(2 * t ** 3 - 3 * t ** 2 + 1) * start.box[axis] +
			(t ** 3 - 2 * t ** 2 + t) * duration * velocity +
			(-2 * t ** 3 + 3 * t ** 2) * target[axis]
		const speed =
			((6 * t ** 2 - 6 * t) * start.box[axis] +
				(3 * t ** 2 - 4 * t + 1) * duration * velocity +
				(-6 * t ** 2 + 6 * t) * target[axis]) /
			duration
		return BoxKinematics.make({
			box: Box.make({ ...start.box, [axis]: position }),
			velocity: Box.make({ x: 0, y: 0, width: 0, height: 0, [axis]: speed }),
		})
	},
)

export const sampleTravel: {
	(target: Box, elapsed: number): (start: BoxKinematics) => BoxKinematics
	(start: BoxKinematics, target: Box, elapsed: number): BoxKinematics
} = dual(
	3,
	(start: BoxKinematics, target: Box, elapsed: number): BoxKinematics => {
		if (elapsed <= 0) return start
		const scalar = (
			key: "x" | "y" | "width" | "height",
			dimension: boolean,
		): Scalar => {
			const initial = start.box[key]
			const result = advance(
				Scalar.make({
					value: dimension ? Math.log(initial) : initial,
					velocity: dimension
						? start.velocity[key] / initial
						: start.velocity[key],
				}),
				elapsed,
				dimension ? Math.log(target[key]) : target[key],
				0.48,
				0.88,
			)
			const value = dimension ? Math.exp(result.value) : result.value
			return Scalar.make({
				value,
				velocity: dimension ? value * result.velocity : result.velocity,
			})
		}
		const x = scalar("x", false),
			y = scalar("y", false)
		const width = scalar("width", true),
			height = scalar("height", true)
		return BoxKinematics.make({
			box: Box.make({
				x: x.value,
				y: y.value,
				width: width.value,
				height: height.value,
			}),
			velocity: Box.make({
				x: x.velocity,
				y: y.velocity,
				width: width.velocity,
				height: height.velocity,
			}),
		})
	},
)

/** Startup uses one critically damped translation and scale, without an arc or overshoot. */
export const sampleLaunch: {
	(target: Box, elapsed: number): (start: BoxKinematics) => BoxKinematics
	(start: BoxKinematics, target: Box, elapsed: number): BoxKinematics
} = dual(
	3,
	(start: BoxKinematics, target: Box, elapsed: number): BoxKinematics => {
		if (elapsed <= 0) return start
		const scalar = (key: "x" | "y" | "width" | "height") =>
			advance(
				Scalar.make({ value: start.box[key], velocity: start.velocity[key] }),
				elapsed,
				target[key],
				0.72,
				1,
			)
		const x = scalar("x"),
			y = scalar("y")
		const width = scalar("width"),
			height = scalar("height")
		return BoxKinematics.make({
			box: Box.make({
				x: x.value,
				y: y.value,
				width: width.value,
				height: height.value,
			}),
			velocity: Box.make({
				x: x.velocity,
				y: y.velocity,
				width: width.velocity,
				height: height.velocity,
			}),
		})
	},
)

const idleIntervals = [
	[2.3, 5.3],
	[7.1, 10.0],
	[10.2, 11.7],
	[13.9, 18.0],
] as const
export const idleSleep = (phase: number): number => {
	if (
		phase < 0.8 ||
		Array.some(idleIntervals, ([start, end]) => phase >= start && phase <= end)
	)
		return 0
	return (
		Array.findFirst(idleIntervals, ([start]) => start > phase).pipe(
			// The next cycle starts moving at 22 + 2.3 seconds.
			Match.value,
			Match.tag("Some", ({ value }) => value[0]),
			Match.tag("None", () => 24.3),
			Match.exhaustive,
		) - phase
	)
}
