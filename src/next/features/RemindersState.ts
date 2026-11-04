import type * as Product from "@kaicom/kay-contracts"
import type { Client } from "@kaicom/kay-contracts/Client"
import { messageWasRejected } from "../MessageRecovery.ts"

export interface RemindersState {
	readonly items: ReadonlyArray<Product.Reminder>
	readonly next: string | null
	readonly loading: boolean
	readonly error: "load" | "cancel" | null
	readonly selected: string | null
	readonly confirm: string | null
	readonly pending: string | null
}
const empty = (): RemindersState => ({
	items: [],
	next: null,
	loading: true,
	error: null,
	selected: null,
	confirm: null,
	pending: null,
})

/** One view owns its reads; cancellation recovery reads the exact saved reminder. */
export const makeRemindersState = () => {
	let state = empty()
	let generation = 0
	let loadGeneration = 0
	let active = false
	let client:
		Pick<Client, "reminders" | "reminder" | "cancelReminder"> | undefined
	let conversationId: string | undefined
	let reading: AbortController | null = null
	let checking: AbortController | null = null
	let changing: AbortController | null = null
	const listeners = new Set<() => void>()
	const update = (patch: Partial<RemindersState>) => {
		state = { ...state, ...patch }
		for (const listener of listeners) listener()
	}
	const close = () => {
		active = false
		generation++
		reading?.abort()
		checking?.abort()
		changing?.abort()
		reading = checking = changing = null
		update(empty())
	}
	const current = (scope: number, signal: AbortSignal) =>
		active && generation === scope && !signal.aborted
	const load = async (after?: string) => {
		if (!active || client === undefined) return
		reading?.abort()
		const controller = new AbortController()
		reading = controller
		const scope = generation
		const version = ++loadGeneration
		update({ loading: true, error: null })
		try {
			const page = await client.reminders({
				...(conversationId === undefined ? {} : { chatId: conversationId }),
				...(after === undefined ? {} : { after }),
				signal: controller.signal,
			})
			if (!current(scope, controller.signal) || version !== loadGeneration)
				return
			update({
				items:
					after === undefined
						? page.items
						: [
								...state.items.filter(
									(item) => !page.items.some((next) => next.id === item.id),
								),
								...page.items,
							],
				next: page.next,
			})
		} catch {
			if (current(scope, controller.signal) && version === loadGeneration)
				update({ error: "load" })
		} finally {
			if (current(scope, controller.signal) && version === loadGeneration)
				update({ loading: false })
			if (reading === controller) reading = null
		}
	}
	const check = async () => {
		if (
			!active ||
			client === undefined ||
			state.pending === null ||
			checking !== null ||
			changing !== null
		)
			return
		const id = state.pending
		const scope = generation
		const controller = new AbortController()
		checking = controller
		try {
			const reminder = await client.reminder(id, controller.signal)
			if (!current(scope, controller.signal) || state.pending !== id) return
			if (
				reminder.id !== id ||
				(conversationId !== undefined && reminder.chatId !== conversationId)
			)
				throw new Error("The reminder does not belong to this view.")
			update({
				items: state.items.map((item) => (item.id === id ? reminder : item)),
				error: null,
				...(reminder.status === "waiting" ? {} : { pending: null }),
			})
		} catch {
			if (current(scope, controller.signal) && state.pending === id)
				update({ error: "load" })
		} finally {
			if (checking === controller) checking = null
		}
	}
	const cancel = async (id: string) => {
		if (!active || client === undefined || state.pending !== null) return
		const reminder = state.items.find((item) => item.id === id)
		if (reminder?.status !== "waiting" || reminder.executionId === null) return
		const scope = generation
		const controller = new AbortController()
		changing = controller
		update({ pending: id, confirm: null, error: null })
		try {
			await client.cancelReminder(id, controller.signal)
		} catch (error) {
			if (!current(scope, controller.signal)) return
			if (messageWasRejected(error)) update({ pending: null, error: "cancel" })
		} finally {
			if (changing === controller) changing = null
		}
		if (current(scope, controller.signal)) await check()
	}
	return {
		getSnapshot: () => state,
		subscribe: (listener: () => void) => {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		activate: (input: {
			readonly client: typeof client
			readonly conversationId?: string | undefined
		}) => {
			close()
			client = input.client
			conversationId = input.conversationId
			active = true
			if (client === undefined) update({ loading: false })
		},
		close,
		load,
		check,
		cancel,
		select: (id: string | null) => update({ selected: id, confirm: null }),
		confirm: (id: string | null) => update({ confirm: id }),
	}
}
