import { setTimeout as delay } from "node:timers/promises"
import { Session } from "@kaicom/e-core"
import { SessionView } from "@kaicom/e-platform-api"
import { Schema } from "effect"
import * as Approvals from "./Approvals.ts"
import * as Projection from "./Projection.ts"

const hostKey = "@openbot-build/openbot/session-host"
const Host = Schema.Struct({
	agent: Schema.NonEmptyString,
	kind: Schema.Literals(["direct", "delegated", "review"]),
	parent: Schema.optionalKey(
		Schema.Struct({
			session: Schema.String,
			turn: Schema.String,
			toolCallId: Schema.String,
		}),
	),
	chain: Schema.Struct({
		organizationId: Schema.NonEmptyString,
		userId: Schema.NonEmptyString,
		tokenId: Schema.optionalKey(Schema.String),
		agents: Schema.Array(Schema.String),
		sessions: Schema.Array(Schema.String),
	}),
})
const Delegation = Schema.Struct({
	id: Schema.String,
	parent: Schema.Struct({
		session: Schema.String,
		turn: Schema.String,
		toolCallId: Schema.String,
		callOccurrence: Schema.Natural,
	}),
	agent: Schema.String,
	child: Schema.NullOr(
		Schema.Struct({
			session: Schema.String,
			turn: Schema.NullOr(Schema.String),
		}),
	),
	status: Schema.Literals([
		"authorizing",
		"queued",
		"running",
		"completed",
		"failed",
		"cancelled",
	]),
})
export type Read = (path: string) => Promise<Projection.Json>
const node = (value: Projection.Json) => {
	const raw = Projection.object(value)
	const view = Schema.decodeUnknownSync(SessionView)(
		Projection.sessionView(value),
	)
	const host = Schema.decodeUnknownSync(Host)(
		Projection.object(Projection.object(raw["session"])["business"])[hostKey],
	)
	return { raw, view, host, turn: Session.currentTurn(view.session) }
}
const path = (id: string) => "/v1/sessions/" + encodeURIComponent(id)
const same = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) =>
	a.length === b.length && a.every((value, index) => value === b[index])
export interface RequestTarget {
	readonly id: string
	readonly session: string
	readonly turn: string
	readonly revision: number
}
export interface Inspection {
	/** The native view with only activity adapted. Session revisions remain authoritative. */
	readonly view: Projection.ObjectValue
	readonly descendants: ReadonlyArray<Projection.ObjectValue>
	readonly approvals: ReadonlyArray<Projection.Json>
	readonly requestTargets: ReadonlyArray<RequestTarget>
}

/** Read only the native, current delegation tree. No synthetic Session or execution state is stored. */
export const inspect = async ({
	view,
	read,
}: {
	readonly view: Projection.Json
	readonly read: Read
}): Promise<Inspection> => {
	const raw = Projection.object(view),
		turns = Projection.object(raw["session"])["turns"]
	const latest = Array.isArray(turns) ? turns.at(-1) : undefined
	if (
		Projection.object(Projection.object(latest)["status"])["_tag"] !== "Waiting"
	)
		return {
			view: raw,
			descendants: [],
			approvals: [],
			requestTargets: [],
		}
	const root = node(view)
	let nodes = [root]
	let childReads = 0
	let delegated = false
	for (let index = 0; index < nodes.length; index++) {
		const parent = nodes[index]!
		if (parent.turn?.status._tag !== "WaitingApproval") continue
		const links = Schema.decodeUnknownSync(Schema.Array(Delegation))(
			await read(path(parent.view.session.id) + "/delegations"),
		)
		for (const link of links) {
			if (link.parent.session !== parent.view.session.id)
				throw new Error("A delegation belongs to another parent Session.")
			if (
				link.parent.turn !== parent.turn.id ||
				!["authorizing", "queued", "running"].includes(link.status)
			)
				continue
			if (
				!Session.pendingApprovals(parent.view).some(
					(wait) =>
						wait.toolCallId === link.parent.toolCallId &&
						wait.occurrence === link.parent.callOccurrence,
				)
			)
				continue
			delegated = true
			if (link.child === null) continue
			if (
				parent.host.chain.sessions.includes(link.child.session) ||
				link.child.session === parent.view.session.id
			)
				throw new Error("The delegation chain contains a cycle.")
			const existing = nodes.find(
				(candidate) => candidate.view.session.id === link.child?.session,
			)
			if (parent.host.chain.sessions.length >= 8)
				throw new Error(
					"The delegation chain exceeds the compatibility depth limit.",
				)
			if (existing === undefined && ++childReads >= 64)
				throw new Error(
					"The delegation graph exceeds the compatibility read limit.",
				)
			const child = existing ?? node(await read(path(link.child.session)))
			if (
				child.view.session.id !== link.child.session ||
				child.host.kind !== "delegated" ||
				child.host.agent !== link.agent ||
				child.host.parent?.session !== parent.view.session.id ||
				child.host.chain.organizationId !== root.host.chain.organizationId ||
				child.host.chain.userId !== root.host.chain.userId ||
				child.host.chain.tokenId !== root.host.chain.tokenId ||
				!same(child.host.chain.sessions, [
					...parent.host.chain.sessions,
					parent.view.session.id,
				]) ||
				!same(child.host.chain.agents, [
					...parent.host.chain.agents,
					child.host.agent,
				])
			)
				throw new Error(
					"The delegated Session does not belong to this authenticated ancestor chain.",
				)
			// A reused child keeps its original host.parent.turn. The current link owns this Turn.
			if (link.child.turn === null || child.turn?.id !== link.child.turn)
				continue
			if (existing === undefined) {
				if (nodes.length >= 64)
					throw new Error(
						"The delegation graph exceeds the compatibility read limit.",
					)
				nodes = [...nodes, child]
			}
		}
	}
	const requests = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(
		await read("/v1/requests?status=pending"),
	)
	let rootApprovals: ReadonlyArray<Projection.ObjectValue> = []
	let approvals: ReadonlyArray<Projection.Json> = [],
		requestTargets: ReadonlyArray<RequestTarget> = []
	for (const current of nodes) {
		const pending = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(
			Approvals.list(current.raw, requests),
		)
		if (current === root) rootApprovals = pending
		approvals = [
			...approvals,
			...pending.map((item) => ({ ...item, turn: root.turn!.id })),
		]
		requestTargets = [
			...requestTargets,
			...pending.map((item) => ({
				id: String(item["approvalId"]),
				session: current.view.session.id,
				turn: current.turn!.id,
				revision: current.view.session.revision,
			})),
		]
	}
	const waits = Session.pendingApprovals(root.view)
	const automatic =
		waits.length === 0 ||
		waits.some(
			(wait) =>
				!rootApprovals.some((item) => {
					const request = requests.find(
						(row) => row["id"] === item["approvalId"],
					)
					return (
						request?.["toolCallId"] === wait.toolCallId &&
						request["callOccurrence"] === wait.occurrence
					)
				}),
		)
	return {
		view:
			delegated || automatic ? { ...root.raw, activity: "active" } : root.raw,
		descendants: nodes.slice(1).map((current) => current.raw),
		approvals,
		requestTargets,
	}
}

/** Keep a legacy observer subscribed while native child work or a review may change. */
export const wait = async ({
	sessionId,
	after,
	afterActivity,
	timeoutMs,
	read,
}: {
	readonly sessionId: string
	readonly after: number
	readonly afterActivity?: string
	readonly timeoutMs: number
	readonly read: Read
}): Promise<Inspection> => {
	const started = performance.now()
	const current = node(await read(path(sessionId)))
	const inspection = await inspect({ view: current.raw, read })
	const projectedActivity = inspection.view["activity"]
	const waiting =
		current.turn?.status._tag === "WaitingApproval" &&
		projectedActivity === "active"
	if (
		current.view.session.revision !== after ||
		(afterActivity !== undefined && afterActivity !== projectedActivity)
	)
		return inspection
	const bounded = Math.max(0, Math.min(timeoutMs, waiting ? 1000 : 30000))
	const query = new URLSearchParams({
		after: String(after),
		timeoutMs: String(bounded),
	})
	// Projected active must not be sent as the native wait cursor when native work is inactive.
	if (current.view.activity !== undefined)
		query.set("afterActivity", current.view.activity)
	const next = await read(path(sessionId) + "/wait?" + query)
	const latest = node(next)
	if (
		waiting &&
		latest.view.session.revision === after &&
		latest.view.activity === current.view.activity
	) {
		const remaining = Math.min(250, bounded) - (performance.now() - started)
		if (remaining > 0) await delay(remaining)
	}
	return inspect({ view: next, read })
}
