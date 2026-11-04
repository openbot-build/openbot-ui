import { Schema } from "effect"

export const Expression = Schema.Literals([
	"winkLeft",
	"winkRight",
	"happy",
	"curious",
	"surprised",
	"thinking",
	"nod",
	"sleepy",
])
export type Expression = typeof Expression.Type

export const Placement = Schema.Literals(["home", "reply", "header", "sidebar"])
export type Placement = typeof Placement.Type

/** Explicit feedback only; reading history must not call these methods. */
export interface Interface {
	readonly play: (expression: Expression) => void
	readonly replayIntro: () => void
}
