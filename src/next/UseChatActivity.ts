import type { ChatEvent, ConversationActivity } from "@kaicom/kay-contracts"
import { RequestFailed, type Client } from "@kaicom/kay-contracts/Client"
import { useCallback, useEffect, useRef, useState } from "react"
import {
	acceptActivity,
	activityEventNeedsRead,
	activityNeedsObservation,
	executionActive,
} from "./ActivityModel"

interface Observation {
	readonly scope: string
	readonly activity: ConversationActivity | null
	readonly stale: boolean
	readonly problem: RequestFailed | null
}

/** Observe real execution events, then read the authoritative, permission-checked state. */
export function useChatActivity({
	client,
	owner,
	chatId,
	revision,
	running,
	liveStream = false,
}: {
	readonly client: Client
	readonly owner: string | null
	readonly chatId: string | undefined
	readonly revision: number | undefined
	readonly running: boolean
	readonly liveStream?: boolean
}) {
	const scope =
		owner === null || chatId === undefined ? null : `${owner}:${chatId}`
	const [value, setValue] = useState<Observation | null>(null)
	const latest = useRef(value)
	const [attempt, setAttempt] = useState(0)
	const [reconnect, setReconnect] = useState(0)
	const readCycle = useRef<{
		scope: string
		reading: boolean
		pending: boolean
	} | null>(null)
	const eventHandler = useRef<(event: ChatEvent) => void>(() => {})
	const notify = useCallback(
		(event: ChatEvent) => eventHandler.current(event),
		[],
	)
	useEffect(() => {
		if (scope === null || chatId === undefined) return
		let timer: ReturnType<typeof setTimeout> | undefined
		const seen = new Map<string, number>()
		const handle = (event: ChatEvent) => {
			if (!activityEventNeedsRead({ event, chatId })) return
			if (
				event.executionId !== undefined &&
				event.executionSequence !== undefined
			) {
				if ((seen.get(event.executionId) ?? -1) >= event.executionSequence)
					return
				seen.set(event.executionId, event.executionSequence)
			}
			// A short burst of checkpoints needs one read, not one request per frame.
			timer ??= setTimeout(() => {
				timer = undefined
				if (readCycle.current?.scope === scope && readCycle.current.reading)
					readCycle.current.pending = true
				else setAttempt((current) => current + 1)
			}, 60)
		}
		eventHandler.current = handle
		return () => {
			clearTimeout(timer)
			if (eventHandler.current === handle) eventHandler.current = () => {}
		}
	}, [scope, chatId])
	useEffect(() => {
		if (scope === null || chatId === undefined) return
		if (latest.current?.scope === scope && latest.current.problem !== null)
			return
		const controller = new AbortController()
		const cycle = { scope, reading: false, pending: false }
		readCycle.current = cycle
		const denied = () =>
			latest.current?.scope === scope && latest.current.problem !== null
		let timer: ReturnType<typeof setTimeout> | undefined
		let failures = 0
		let queuedReads = 0
		const read = async () => {
			if (controller.signal.aborted || denied()) return
			cycle.reading = true
			let retry = running
			let delay = 6000
			try {
				const next = await client.chatActivity(chatId, controller.signal)
				if (controller.signal.aborted || denied()) return
				if (next.chatId !== chatId)
					throw new Error("Activity belongs to another conversation")
				const accepted = acceptActivity({
					previous:
						latest.current?.scope === scope ? latest.current.activity : null,
					next,
				})
				const stale = revision !== undefined && accepted.revision < revision
				latest.current = { scope, activity: accepted, stale, problem: null }
				setValue(latest.current)
				failures = 0
				// StepStarted registers intent before sending. Read again soon until the
				// core reports sending/waiting; never label an intent as running.
				queuedReads = accepted.tools.some((tool) => tool.status === "queued")
					? queuedReads + 1
					: 0
				if (queuedReads > 0) delay = Math.min(400 * queuedReads, 6000)
				retry = stale || activityNeedsObservation(accepted)
			} catch (error) {
				if (controller.signal.aborted || denied()) return
				const terminal =
					error instanceof RequestFailed &&
					[401, 403, 404].includes(error.status)
				latest.current = {
					scope,
					activity:
						!terminal && latest.current?.scope === scope
							? latest.current.activity
							: null,
					stale: !terminal,
					problem: terminal ? error : null,
				}
				setValue(latest.current)
				failures += 1
				delay =
					error instanceof RequestFailed && error.status === 409
						? 1200
						: Math.min(6000 * failures, 30000)
				retry = !terminal
			} finally {
				cycle.reading = false
			}
			if (cycle.pending) {
				cycle.pending = false
				retry = true
				delay = 0
			}
			if (retry && !controller.signal.aborted && !denied())
				timer = setTimeout(() => void read(), delay)
		}
		void read()
		return () => {
			controller.abort()
			clearTimeout(timer)
			if (readCycle.current === cycle) readCycle.current = null
		}
	}, [client, scope, chatId, revision, running, attempt])
	const execution =
		value?.scope === scope ? value.activity?.activeExecution : undefined
	const watchId =
		execution !== undefined && executionActive(execution.status)
			? execution.id
			: undefined
	useEffect(() => {
		if (
			scope === null ||
			chatId === undefined ||
			liveStream ||
			watchId === undefined
		)
			return
		const controller = new AbortController()
		let disposed = false
		let retry: ReturnType<typeof setTimeout> | undefined
		let watchdog: ReturnType<typeof setTimeout> | undefined
		const renew = () => {
			clearTimeout(watchdog)
			// Renew a quiet reader as well as a broken one. Aborting observation
			// never cancels the accepted execution or resends its input.
			watchdog = setTimeout(() => controller.abort(), 30_000)
		}
		renew()
		void (async () => {
			let terminal = false
			try {
				for await (const event of client.chatEvents(
					chatId,
					controller.signal,
				)) {
					if (disposed || controller.signal.aborted) return
					if (event.chatId !== chatId)
						throw new Error("Activity belongs to another conversation")
					renew()
					notify(event)
				}
			} catch (error) {
				if (disposed || controller.signal.aborted) return
				terminal =
					error instanceof RequestFailed &&
					[401, 403, 404].includes(error.status)
				if (latest.current?.scope === scope) {
					latest.current = {
						...latest.current,
						activity: terminal ? null : latest.current.activity,
						stale: !terminal,
						problem: terminal ? (error as RequestFailed) : null,
					}
					setValue(latest.current)
				}
			} finally {
				clearTimeout(watchdog)
				if (!disposed && !terminal) {
					setAttempt((current) => current + 1)
					retry = setTimeout(() => setReconnect((current) => current + 1), 1200)
				}
			}
		})()
		return () => {
			disposed = true
			controller.abort()
			clearTimeout(watchdog)
			clearTimeout(retry)
		}
	}, [client, scope, chatId, liveStream, watchId, reconnect, notify])
	return {
		...(value?.scope === scope
			? value
			: { activity: null, stale: false, problem: null }),
		notify,
		refresh: () => {
			if (latest.current?.scope === scope)
				latest.current = { ...latest.current, problem: null }
			setAttempt((current) => current + 1)
		},
	}
}
