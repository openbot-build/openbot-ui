import { Match } from "effect"
import { ChatTransition } from "./ChatTransition"
import { ActivityView } from "./ActivityView"
import { activityIsland } from "./ActivityPresentation"
import { transcriptActivity } from "./TranscriptActivity"
import { useChatActivity } from "./UseChatActivity"
import { useWorkspaceDrafts } from "./UseWorkspaceDrafts"
import {
	currentTurnActivity,
	earlierActivityPending,
	hasTaskActivity,
	activityNeedsObservation,
} from "./ActivityModel"
import * as Product from "@kaicom/kay-contracts"
import { RequestFailed, type Delivery } from "@kaicom/kay-contracts/Client"
import { t } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { useEffect, useReducer, useRef, useState } from "react"
import { LogOut, Moon, Settings2, ShieldCheck, Sun } from "lucide-react"
import { flushSync } from "react-dom"
import { Button } from "../components/ui/button"
import { Anchor, Provider } from "../components/mascot/Mascot"
import { Language } from "../components/Language"
import { LoadingSkeleton } from "../components/LoadingSkeleton"
import { setAppearance, useAppearance } from "../hooks/UseAppearance"
import {
	draftKey,
	initialView,
	reduceView,
	type ViewAction,
	type ViewState,
	type Attachment,
} from "./Model"
import {
	emptyStream,
	mergeMessages,
	messagesFrom,
	reduceStream,
	workspaceFrom,
	regenerationInput,
	preferencesFrom,
	type StreamState,
} from "./ProductModel"
import { Shell } from "./Shell"
import {
	clearPrivateViewStorage,
	requestSignOut,
	signOutWorkspace,
} from "./SignOut"
import { ChatView } from "./Views"
import { FeatureView, useFeatureNavigation } from "./Features"
import { Management } from "./Management"
import { ChatSettings } from "./ChatSettings"
import { ConnectionSettings } from "../components/ConnectionSettings"
import { objectOf } from "./features/SchemaValues"
import { rowsOf } from "./features/FeatureData"
import { readSavedFile } from "./features/FilesData"
import { saveFileAttachment } from "./features/FileAttachmentRecovery"
import { AppInterface } from "./features/AppInterface"
import { Voice } from "./features/Voice"
import { groupLabel } from "./features/FeatureLabels"
import { canOpenAdmin } from "./features/SettingsData"
import { searchFromView, type RouteSearch } from "./RouteSearch"
import {
	readPendingConversation,
	recoveryKey,
	writePendingConversation,
	type PendingConversation,
} from "./ConversationRecovery"

import {
	messageRecoveryKey,
	messageWasRejected,
	readMessageRecoveries,
	writeMessageRecoveries,
	recoverMessage,
	recoveryDelay,
	type PendingSend,
} from "./MessageRecovery"

import { accountPlanName } from "./AccountPresentation"
import { useMembership } from "./features/MembershipShared"

import { createProductClient } from "../lib/product-client"

const client = createProductClient()
type ChatData = {
	readonly chat: Product.Conversation
	readonly page: typeof Product.MessagePage.Type
	readonly turns: typeof Product.TurnPage.Type
}

/** This container never imports fixtures. A missing service remains a visible error. */
export function Live({
	location,
	onLocation,
}: {
	readonly location: RouteSearch
	readonly onLocation: (search: RouteSearch) => void
}) {
	useLingui()
	const [bootstrap, setBootstrap] = useState<Product.Bootstrap | null>(null)
	const accountMembership = useMembership({
		client: bootstrap === null ? undefined : client,
		bootstrap: bootstrap ?? undefined,
	})
	const [preferences, setPreferences] = useState(() => preferencesFrom({}))
	const [attachments, setAttachments] = useState<
		Readonly<Record<string, ReadonlyArray<Attachment>>>
	>({})
	const [uploading, setUploading] = useState(false)
	const [files, setFiles] = useState<ReadonlyArray<Attachment>>([])
	const [openedApp, setOpenedApp] = useState<unknown>(null)
	const [view, reduceDispatch] = useReducer(
		(state: ViewState, action: ViewAction) => reduceView(state, action),
		{
			...initialView,
			companionId: initialView.companionId,
			destination:
				location.chat !== undefined
					? { kind: "conversation" as const, id: location.chat }
					: location.feature !== undefined
						? {
								kind: "feature" as const,
								id: location.feature,
								title: groupLabel(location.feature),
								...(location.sourceChat === undefined
									? {}
									: { conversationId: location.sourceChat }),
							}
						: location.new === true
							? { kind: "new" as const }
							: { kind: "kay" as const },
		},
	)
	const [data, setData] = useState<Readonly<Record<string, ChatData>>>({})
	const [streams, setStreams] = useState<Readonly<Record<string, StreamState>>>(
		{},
	)
	const [problem, setProblem] = useState<unknown>(null)
	const [readProblems, setReadProblems] = useState<
		Readonly<Record<string, unknown>>
	>({})
	const [signingOut, setSigningOut] = useState(false)
	const [signOutFailed, setSignOutFailed] = useState(false)
	const signOutLock = useRef(false)
	const [busyKeys, setBusyKeys] = useState<ReadonlyArray<string>>([])
	const busy = busyKeys.includes(draftKey(view))
	const [loading, setLoading] = useState(false)
	const [pendingSends, setPendingSends] = useState<ReadonlyArray<PendingSend>>(
		[],
	)
	const [observedSends, setObservedSends] = useState<ReadonlyArray<string>>([])
	const [viewProblems, setViewProblems] = useState<
		Readonly<Record<string, unknown>>
	>({})
	const [pendingOperation, setPendingOperation] =
		useState<PendingConversation | null>(null)
	const [operationResult, setOperationResult] = useState<
		typeof Product.ConversationOperation.Type | null
	>(null)
	const [delivery, setDelivery] = useState<Product.MessageReceipt | null>(null)
	const [branches, setBranches] = useState<
		ReadonlyArray<Product.ConversationSummary>
	>([])
	const [query, setQuery] = useState("")
	const [memoryChoices, setMemoryChoices] = useState<
		Readonly<Record<string, { readonly value: "default" | "off" } | undefined>>
	>({})
	const memoryChoice = memoryChoices[draftKey(view)]
	const memory = memoryChoice?.value ?? "default"
	const drafts = useWorkspaceDrafts()
	const [deviceNames, setDeviceNames] = useState<{
		readonly owner: string
		readonly values: ReadonlyMap<string, string>
	} | null>(null)
	const currentView = useRef(view)
	const appViewRequest = useRef(0)
	currentView.current = view
	const rawDispatch = (action: ViewAction) => {
		if (
			action.type === "navigate" ||
			action.type === "companion" ||
			action.type === "reset" ||
			action.type === "detail"
		)
			appViewRequest.current += 1
		const next = reduceView(currentView.current, action)
		Match.value(action).pipe(
			Match.when({ type: "draft" }, () =>
				drafts.set(draftKey(next), next.drafts[draftKey(next)] ?? ""),
			),
			Match.when({ type: "draftFor" }, (change) =>
				drafts.set(change.key, change.value),
			),
			Match.when({ type: "acknowledge" }, (change) =>
				drafts.acknowledge(change.key, change.sent),
			),
			Match.orElse(() => undefined),
		)
		currentView.current = next
		reduceDispatch(action)
		if (
			(action.type === "navigate" || action.type === "companion") &&
			next.drafts[draftKey(next)] === undefined
		) {
			const restored = {
				type: "draftFor" as const,
				key: draftKey(next),
				value: drafts.read(draftKey(next)),
			}
			currentView.current = reduceView(next, restored)
			reduceDispatch(restored)
		}
	}
	useEffect(() => {
		const current = searchFromView(currentView.current)
		if (
			current.chat === location.chat &&
			current.feature === location.feature &&
			current.sourceChat === location.sourceChat &&
			current.new === location.new &&
			current.bot === location.bot
		)
			return
		if (location.new === true)
			rawDispatch({ type: "navigate", destination: { kind: "new" } })
		else
			rawDispatch({
				type: "navigate",
				destination:
					location.chat !== undefined
						? { kind: "conversation", id: location.chat }
						: location.feature !== undefined
							? {
									kind: "feature",
									id: location.feature,
									title: groupLabel(location.feature),
									...(location.sourceChat === undefined
										? {}
										: { conversationId: location.sourceChat }),
								}
							: location.new === true
								? { kind: "new" }
								: { kind: "kay" },
			})
	}, [
		location.chat,
		location.feature,
		location.new,
		location.bot,
		location.sourceChat,
	])
	const writeLocks = useRef(new Set<string>())
	const owner = useRef<string | null>(null)
	const generation = useRef(0)
	const bootstrapRequest = useRef(0)
	const assistantSetupAttempted = useRef(new Set<string>())
	const requests = useRef(new Set<AbortController>())
	const mounted = useRef(true)
	const sendRecords = useRef<ReadonlyArray<PendingSend>>([])
	const activeSends = useRef(new Set<string>())
	const recoveryJobs = useRef(new Map<string, AbortController>())
	const storeSends = (value: ReadonlyArray<PendingSend>) => {
		sendRecords.current = value
		setPendingSends(value)
		if (owner.current !== null)
			writeMessageRecoveries({
				storage: sessionStorage,
				key: messageRecoveryKey(owner.current),
				value,
			})
	}
	const updateSend = (id: string, patch: Partial<PendingSend> | null) => {
		if (patch === null)
			setObservedSends((current) => current.filter((send) => send !== id))
		storeSends(
			patch === null
				? sendRecords.current.filter((send) => send.id !== id)
				: sendRecords.current.map((send) =>
						send.id === id ? { ...send, ...patch } : send,
					),
		)
	}
	const beginSend = (
		viewKey: string,
		chatId: string | undefined,
		botId: string | null,
	) => {
		const id = crypto.randomUUID()
		activeSends.current.add(id)
		storeSends([
			...sendRecords.current,
			{
				id,
				viewKey,
				commandKey: id,
				chatId: chatId ?? null,
				botId,
				accepted: false,
				turnId: null,
				itemId: null,
			},
		])
		return id
	}
	const finishSend = (id: string, rejected: boolean) => {
		activeSends.current.delete(id)
		updateSend(id, rejected ? null : {})
	}
	const recordOperation = (value: PendingConversation | null) => {
		setPendingOperation(value)
		setOperationResult(null)
		if (owner.current !== null)
			writePendingConversation({
				storage: sessionStorage,
				key: recoveryKey(owner.current),
				value,
			})
	}
	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
			for (const controller of requests.current) controller.abort()
		}
	}, [])
	const { dark } = useAppearance()
	useEffect(() => {
		document.documentElement.classList.toggle("dark", dark)
		document.documentElement.style.colorScheme = dark ? "dark" : "light"
	}, [dark])
	const dispatch = (action: ViewAction) => {
		rawDispatch(action)
		if (action.type === "navigate" || action.type === "companion")
			onLocation(searchFromView(reduceView(currentView.current, action)))
	}
	const loadBootstrap = async (signal?: AbortSignal) => {
		const request = ++bootstrapRequest.current
		let result = await client.bootstrap(signal)
		if (
			!mounted.current ||
			signal?.aborted === true ||
			request !== bootstrapRequest.current
		)
			return
		const identity =
			result.identity.organizationId + ":" + result.identity.userId
		if (owner.current !== null && owner.current !== identity) {
			generation.current += 1
			writeLocks.current.clear()
			setBusyKeys([])
			setUploading(false)
			for (const controller of requests.current) controller.abort()
			setBootstrap(null)
			setData({})
			setAttachments({})
			setFiles([])
			setOpenedApp(null)
			setStreams({})
			setPreferences(preferencesFrom({}))
			sendRecords.current = []
			setPendingSends([])
			setObservedSends([])
			activeSends.current.clear()
			recoveryJobs.current.clear()
			setViewProblems({})
			setReadProblems({})
			setMemoryChoices({})
			setProblem(null)
			setDelivery(null)
			setBranches([])
			rawDispatch({ type: "reset" })
			onLocation({})
		}
		drafts.restore({
			tenantId: result.identity.organizationId,
			userId: result.identity.userId,
		})
		if (owner.current !== identity) {
			const key = draftKey(currentView.current)
			rawDispatch({ type: "draftFor", key, value: drafts.read(key) })
			const pending = readPendingConversation({
				storage: sessionStorage,
				key: recoveryKey(identity),
			})
			setPendingOperation(pending)
			setOperationResult(null)
			const restored = readMessageRecoveries({
				storage: sessionStorage,
				key: messageRecoveryKey(identity),
			})
			sendRecords.current = restored
			setPendingSends(restored)
			try {
				// The old flag had no Chat identity and cannot establish any send outcome.
				sessionStorage.removeItem(recoveryKey(identity) + ":uncertain")
			} catch {
				/* Recovery can still proceed without browser storage. */
			}
		}
		owner.current = identity
		const scope = generation.current
		if (result.defaultBotId === null) {
			let setup: Product.DefaultBotStatus
			if (!assistantSetupAttempted.current.has(identity)) {
				assistantSetupAttempted.current.add(identity)
				try {
					setup = await client.ensureDefaultBot({
						userId: result.identity.userId,
						organizationId: result.identity.organizationId,
					})
				} catch (error) {
					if (
						!(error instanceof RequestFailed) ||
						error.problem.code !== "outcome_unknown"
					)
						throw error
					setup = await client.defaultBotStatus(signal)
				}
			} else setup = await client.defaultBotStatus(signal)
			if (setup.phase !== "ready")
				throw new RequestFailed(503, {
					code: "outcome_unknown",
					message: t`Kay could not confirm that your assistant is ready. Refresh to check its status.`,
				})
			result = await client.bootstrap(signal)
			signal?.throwIfAborted()
			if (
				!mounted.current ||
				request !== bootstrapRequest.current ||
				identity !==
					result.identity.organizationId + ":" + result.identity.userId
			)
				return
		}
		setBootstrap(result)
		void client
			.preferences(signal)
			.then((value) => {
				if (
					mounted.current &&
					signal?.aborted !== true &&
					scope === generation.current
				)
					setPreferences(preferencesFrom(value))
			})
			.catch((error: unknown) => {
				if (
					mounted.current &&
					scope === generation.current &&
					signal?.aborted !== true
				)
					setProblem(error)
			})
		return result
	}
	const readChat = async (id: string, signal?: AbortSignal) => {
		const scope = generation.current
		const [chat, page, turns] = await Promise.all([
			client.conversation(id, signal),
			client.messages(id, undefined, signal),
			client.turns(id, undefined, signal),
		])
		if (
			!mounted.current ||
			signal?.aborted === true ||
			scope !== generation.current
		)
			return
		setData((current) => {
			const previous = current[id]
			if (previous !== undefined && previous.chat.revision > chat.revision)
				return current
			const overlap =
				previous?.page.items.some((item) =>
					page.items.some((next) => next.id === item.id),
				) === true
			const merged =
				previous !== undefined && overlap
					? {
							items: [
								...previous.page.items.filter(
									(item) => !page.items.some((next) => next.id === item.id),
								),
								...page.items,
							],
							next: previous.page.next,
						}
					: page
			return { ...current, [id]: { chat, page: merged, turns } }
		})
		setBootstrap((current) =>
			current === null
				? current
				: {
						...current,
						conversations: current.conversations.map((previous) =>
							previous.id === id && previous.revision <= chat.revision
								? { ...previous, ...chat }
								: previous,
						),
					},
		)
		setReadProblems((current) => ({
			...current,
			["conversation:" + id]: null,
			...(chat.kind === "direct" ? { "direct:kay": null } : {}),
		}))
		setDelivery((current) =>
			current?.chatId === id &&
			chat.queuedInputs === 0 &&
			chat.status !== "Running" &&
			page.items.some((item) => item.sourceItemId === current.itemId)
				? null
				: current,
		)
		// Keep disconnected text visible until its saved item replaces it.
		setStreams((current) =>
			Object.fromEntries(
				Object.entries(current).map(([sendId, stream]) => [
					sendId,
					activeSends.current.has(sendId) || stream.chatId !== id
						? stream
						: {
								...stream,
								messages: stream.messages.filter(
									(message) =>
										!page.items.some((item) => item.id === message.id),
								),
							},
				]),
			),
		)
		return { chat, page, turns }
	}
	useEffect(() => {
		if (bootstrap === null) return
		const scope = generation.current
		for (const pending of pendingSends) {
			if (
				activeSends.current.has(pending.id) ||
				recoveryJobs.current.has(pending.id)
			)
				continue
			if (
				!pending.accepted &&
				pendingSends.some(
					(other) =>
						!other.accepted &&
						recoveryJobs.current.has(other.id) &&
						(other.botId ?? other.chatId ?? other.viewKey) ===
							(pending.botId ?? pending.chatId ?? pending.viewKey),
				)
			)
				continue
			const controller = new AbortController()
			recoveryJobs.current.set(pending.id, controller)
			requests.current.add(controller)
			void recoverMessage({
				pending,
				execution: (id, signal) =>
					client.execution(id, signal, pending.commandKey),
				commandReceipt: (key, signal) => client.commandReceipt(key, signal),
				signal: controller.signal,
				read: async (id, signal) => {
					const snapshot = await readChat(id, signal)
					if (snapshot === undefined)
						throw new DOMException("Recovery ended", "AbortError")
					return snapshot
				},
				turns: (id, cursor, signal) => client.turns(id, cursor, signal),
				findDirect: async (botId, signal) => {
					const current = await loadBootstrap(signal)
					return current?.conversations.find(
						(chat) =>
							chat.botId === botId &&
							chat.kind === "direct" &&
							chat.activity !== "historical",
					)?.id
				},
				wait: (id, revision, signal) => client.wait(id, revision, signal),
				onSnapshot: () => {
					if (
						!mounted.current ||
						controller.signal.aborted ||
						scope !== generation.current
					)
						return
					setObservedSends((current) =>
						current.includes(pending.id) ? current : [...current, pending.id],
					)
				},
				onRetry: (error) => {
					if (
						!mounted.current ||
						controller.signal.aborted ||
						scope !== generation.current
					)
						return
					setObservedSends((current) =>
						current.filter((id) => id !== pending.id),
					)
					setReadProblems((current) => ({
						...current,
						[pending.viewKey]: error,
					}))
				},
			})
				.then(() => {
					if (
						!mounted.current ||
						controller.signal.aborted ||
						scope !== generation.current
					)
						return
					updateSend(pending.id, null)
					setStreams((current) => {
						const next = { ...current }
						delete next[pending.id]
						return next
					})
					recoveryJobs.current.delete(pending.id)
					void loadBootstrap(controller.signal).catch(() => {
						/* The conversation is restored; a list refresh is not a failed send. */
					})
				})
				.catch(async (error: unknown) => {
					if (
						!controller.signal.aborted &&
						mounted.current &&
						scope === generation.current
					)
						setReadProblems((current) => ({
							...current,
							[pending.viewKey]: error,
						}))
					if (!controller.signal.aborted) {
						try {
							await recoveryDelay(15_000, controller.signal)
						} catch {
							/* Account changes end retry. */
						}
					}
				})
				.finally(() => {
					requests.current.delete(controller)
					if (
						!mounted.current ||
						controller.signal.aborted ||
						scope !== generation.current
					)
						return
					recoveryJobs.current.delete(pending.id)
					if (sendRecords.current.some((send) => send.id === pending.id))
						setPendingSends([...sendRecords.current])
				})
		}
	}, [
		pendingSends,
		bootstrap?.identity.userId,
		bootstrap?.identity.organizationId,
	])
	useEffect(() => {
		const controller = new AbortController()
		void loadBootstrap(controller.signal).catch((error: unknown) => {
			if (!controller.signal.aborted) setProblem(error)
		})
		return () => controller.abort()
	}, [])
	const direct = bootstrap?.conversations.find(
		(chat) =>
			chat.kind === "direct" &&
			chat.botId === bootstrap.defaultBotId &&
			chat.activity !== "historical",
	)
	const selectedId =
		view.destination.kind === "conversation"
			? view.destination.id
			: view.destination.kind === "kay"
				? direct?.id
				: undefined
	const selected = selectedId === undefined ? undefined : data[selectedId]
	const activityOwner =
		bootstrap === null
			? null
			: `${bootstrap.identity.organizationId}:${bootstrap.identity.userId}`
	const observedActivity = useChatActivity({
		client,
		owner: activityOwner,
		chatId: selectedId,
		revision: selected?.chat.revision,
		running: selected?.chat.status === "Running",
		liveStream: Object.entries(streams).some(
			([id, state]) =>
				state.chatId === selectedId && activeSends.current.has(id),
		),
	})
	const activity =
		observedActivity?.activity != null &&
		!(
			selected !== undefined &&
			((selected.chat.activeTurnId !== null &&
				selected.chat.activeTurnId !== observedActivity.activity.turnId) ||
				(selected.chat.revision > observedActivity.activity.revision &&
					selected.chat.status !== observedActivity.activity.status))
		)
			? currentTurnActivity(observedActivity.activity)
			: null
	const taskId =
		activity?.turnId == null
			? undefined
			: `${activity.chatId}:${activity.turnId}`
	const hasActivity =
		activity !== null &&
		taskId !== undefined &&
		hasTaskActivity(observedActivity.activity!)
	const island = activityIsland({
		activity,
		chatId: selectedId,
		stale: observedActivity.stale,
	})
	useEffect(() => {
		if (activityOwner === null) return
		const controller = new AbortController()
		void client
			.devices(controller.signal)
			.then((result) => {
				if (!controller.signal.aborted)
					setDeviceNames({
						owner: activityOwner,
						values: new Map(
							result.groups.flatMap((group) =>
								group.devices.map(
									(device) => [device.id, device.name] as const,
								),
							),
						),
					})
			})
			.catch(() => {
				/* Device lookup does not affect saved task activity. */
			})
		return () => controller.abort()
	}, [activityOwner, taskId])

	const selectedSends = pendingSends.filter(
		(send) =>
			(send.chatId !== null && send.chatId === selectedId) ||
			(send.chatId === null && send.viewKey === draftKey(view)) ||
			(selectedId === undefined &&
				view.destination.kind === "kay" &&
				send.viewKey === "direct:kay"),
	)
	const selectedRecoveries = selectedSends.filter(
		(send) => !activeSends.current.has(send.id),
	)
	const restoring = selectedRecoveries.some(
		(send) => !send.accepted || !observedSends.includes(send.id),
	)
	const uncertain = selectedRecoveries.some((send) => !send.accepted)
	const sending = selectedSends.some(
		(send) => !send.accepted && activeSends.current.has(send.id),
	)

	const selectedHasStream = Object.values(streams).some(
		(state) => state.chatId === selectedId,
	)
	const selectedHasPending = pendingSends.some(
		(send) => send.chatId === selectedId,
	)
	const readOnly =
		selected !== undefined &&
		(selected.chat.activity === "historical" ||
			!(
				selected.chat.kind === "conversation" || selected.chat.kind === "direct"
			))
	useEffect(() => {
		setBranches([])
		if (selectedId === undefined) {
			setLoading(false)
			return
		}
		const controller = new AbortController()
		setLoading(true)
		void readChat(selectedId, controller.signal)
			.catch((error: unknown) => {
				if (!controller.signal.aborted)
					setReadProblems((current) => ({
						...current,
						[draftKey(view)]: error,
					}))
			})
			.finally(() => {
				if (!controller.signal.aborted) setLoading(false)
			})
		return () => controller.abort()
	}, [selectedId])
	useEffect(() => {
		if (
			selected === undefined ||
			(selected.chat.status !== "Running" &&
				selected.chat.queuedInputs === 0) ||
			selectedHasStream ||
			selectedHasPending
		)
			return
		const controller = new AbortController()
		const scope = generation.current
		requests.current.add(controller)
		// The same read-only loop also follows queued and accepted inputs after a reload.
		void recoverMessage({
			pending: {
				id: "observe:" + selected.chat.id,
				viewKey: draftKey(view),
				chatId: selected.chat.id,
				botId: null,
				accepted: false,
				turnId: null,
				itemId: null,
			},
			signal: controller.signal,
			read: async (id, signal) => {
				await client.wait(id, selected.chat.revision, signal)
				const snapshot = await readChat(id, signal)
				if (snapshot === undefined)
					throw new DOMException("Observation ended", "AbortError")
				return snapshot
			},
			turns: (id, cursor, signal) => client.turns(id, cursor, signal),
			findDirect: async () => undefined,
			wait: (id, revision, signal) => client.wait(id, revision, signal),
		})
			.catch((error: unknown) => {
				if (
					!controller.signal.aborted &&
					mounted.current &&
					scope === generation.current
				)
					setReadProblems((current) => ({
						...current,
						[draftKey(view)]: error,
					}))
			})
			.finally(() => requests.current.delete(controller))
		return () => controller.abort()
	}, [
		selected?.chat.id,
		selected?.chat.revision,
		selected?.chat.status,
		selected?.chat.queuedInputs,
		selectedHasStream,
		selectedHasPending,
	])

	const refresh = async () => {
		observedActivity.refresh()
		const scope = generation.current
		const key = draftKey(currentView.current)
		setLoading(true)
		setProblem(null)
		setViewProblems((current) => ({ ...current, [key]: null }))
		try {
			await loadBootstrap()
			if (scope !== generation.current || !mounted.current) return
			if (selectedId !== undefined) await readChat(selectedId)
		} catch (error) {
			if (scope === generation.current && mounted.current)
				setReadProblems((current) => ({ ...current, [key]: error }))
		} finally {
			if (
				scope === generation.current &&
				mounted.current &&
				key === draftKey(currentView.current)
			)
				setLoading(false)
		}
	}

	const featureNavigation = useFeatureNavigation({
		conversationId:
			selectedId ??
			(view.destination.kind === "feature"
				? view.destination.conversationId
				: undefined),
		client,
		bootstrap,
		view,
		dispatch,
	})
	const feature = (id: string, title: string) =>
		dispatch({
			type: "navigate",
			destination: {
				kind: "feature",
				id,
				title,
				...(id === "files" && selectedId !== undefined
					? { conversationId: selectedId }
					: {}),
			},
		})
	const action = async (work: () => Promise<unknown>) => {
		const key = draftKey(currentView.current)
		if (writeLocks.current.has(key)) return
		const scope = generation.current
		writeLocks.current.add(key)
		setBusyKeys((current) => [...current, key])
		setViewProblems((current) => ({ ...current, [key]: null }))
		try {
			await work()
		} catch (error) {
			if (scope !== generation.current || !mounted.current) return
			setViewProblems((current) => ({ ...current, [key]: error }))
		} finally {
			if (scope === generation.current) {
				writeLocks.current.delete(key)
				if (mounted.current)
					setBusyKeys((current) => current.filter((item) => item !== key))
			}
		}
	}

	const downloadAttachment = async (fileId: string) => {
		const key = draftKey(currentView.current)
		const scope = generation.current
		const controller = new AbortController()
		requests.current.add(controller)
		try {
			const saved = await readSavedFile({
				client,
				fileId,
				signal: controller.signal,
			})
			if (!mounted.current || scope !== generation.current)
				throw new DOMException(
					"The account changed before download completed.",
					"AbortError",
				)
			return saved
		} catch (error) {
			if (
				mounted.current &&
				scope === generation.current &&
				error instanceof RequestFailed &&
				error.status === 401
			)
				setViewProblems((current) => ({ ...current, [key]: error }))
			throw error
		} finally {
			requests.current.delete(controller)
		}
	}
	const upload = (file: File) => {
		const key = draftKey(currentView.current),
			scope = generation.current
		void action(async () => {
			const controller = new AbortController()
			requests.current.add(controller)
			setUploading(true)
			try {
				const result = objectOf(
					await client.featureUpload(
						"files.uploadFile",
						file,
						{},
						controller.signal,
					),
				)
				if (typeof result["id"] !== "string" || result["status"] !== "ready")
					throw new RequestFailed(502, {
						code: "outcome_unknown",
						message: t`The file upload could not be confirmed. Check your saved files before uploading again.`,
					})
				if (!mounted.current || scope !== generation.current) return
				const attachment: Attachment = {
					fileId: result["id"],
					name:
						typeof result["filename"] === "string"
							? result["filename"]
							: file.name,
					type:
						typeof result["mediaType"] === "string" &&
						result["mediaType"].startsWith("image/")
							? "image"
							: "file",
				}
				setAttachments((current) => ({
					...current,
					[key]: [...(current[key] ?? []), attachment],
				}))
			} finally {
				requests.current.delete(controller)
				if (mounted.current && scope === generation.current) setUploading(false)
			}
		})
	}
	const readForCurrentView = async <A,>(
		read: () => Promise<A>,
		accept: (value: A) => void,
	) => {
		const scope = generation.current
		const key = draftKey(currentView.current)
		try {
			const value = await read()
			if (
				mounted.current &&
				scope === generation.current &&
				key === draftKey(currentView.current)
			)
				accept(value)
		} catch (error) {
			if (mounted.current && scope === generation.current)
				setReadProblems((current) => ({ ...current, [key]: error }))
		}
	}
	const savedFiles = () => {
		dispatch({ type: "detail", id: "saved-files" })
		const scope = generation.current
		const key = draftKey(view)
		void client
			.featureCall("files.listFiles")
			.then((result) => {
				if (scope !== generation.current || !mounted.current) return
				setFiles(
					rowsOf(result).flatMap((item) => {
						const row = objectOf(item)
						return typeof row["id"] === "string" && row["status"] === "ready"
							? [
									{
										fileId: row["id"],
										name:
											typeof row["filename"] === "string"
												? row["filename"]
												: row["id"],
										type:
											typeof row["mediaType"] === "string" &&
											row["mediaType"].startsWith("image/")
												? ("image" as const)
												: ("file" as const),
									},
								]
							: []
					}),
				)
			})
			.catch((error: unknown) => {
				if (scope === generation.current && mounted.current)
					setReadProblems((current) => ({ ...current, [key]: error }))
			})
	}
	const observe = async ({
		result,
		controller,
		initialId,
		sendId,
		onAccepted,
	}: {
		readonly result: Delivery
		readonly controller: AbortController
		readonly initialId: string | undefined
		readonly sendId: string
		readonly onAccepted: () => void
	}) => {
		const scope = generation.current
		// Both a JSON receipt and SSE headers acknowledge durable input acceptance.
		if (
			result.kind === "receipt" &&
			result.receipt.commandKey !== undefined &&
			result.receipt.commandKey !== sendId
		) {
			finishSend(sendId, false)
			throw new RequestFailed(0, {
				code: "outcome_unknown",
				message:
					"The receipt belongs to another command. Kay will read the original command.",
			})
		}
		updateSend(
			sendId,
			result.kind === "receipt"
				? {
						accepted: true,
						chatId: result.receipt.chatId,
						turnId: result.receipt.turnId,
						itemId: result.receipt.itemId,
						...(result.receipt.executionId === undefined
							? {}
							: { executionId: result.receipt.executionId }),
						...(result.receipt.commandKey === undefined
							? {}
							: { commandKey: result.receipt.commandKey }),
					}
				: { accepted: true },
		)
		onAccepted()
		if (result.kind === "receipt") {
			setDelivery(result.receipt)
			requests.current.delete(controller)
			finishSend(sendId, false)
			return
		}
		const streamId = sendId
		setStreams((current) => ({
			...current,
			[streamId]: { ...emptyStream, chatId: initialId ?? null },
		}))
		const consume = async () => {
			let state = emptyStream
			// Proxies can leave a dead SSE connection open. Only stop this reader;
			// the accepted execution continues and is restored from saved state.
			let stalled = setTimeout(() => controller.abort(), 15_000)
			try {
				for await (const event of result.events) {
					clearTimeout(stalled)
					stalled = setTimeout(() => controller.abort(), 15_000)
					if (
						!mounted.current ||
						controller.signal.aborted ||
						scope !== generation.current
					)
						return
					if (initialId !== undefined && event.chatId !== initialId)
						throw new Error("The response belongs to a different conversation.")
					const savedSend = sendRecords.current.find(
						(send) => send.id === sendId,
					)
					const expectedTurn = savedSend?.turnId
					if (event.commandKey !== undefined && event.commandKey !== sendId)
						throw new Error("The response belongs to another command.")
					if (
						expectedTurn != null &&
						event.turnId !== null &&
						expectedTurn !== event.turnId
					)
						throw new Error("The response belongs to a different turn.")
					if (
						(event.executionId !== undefined &&
							event.executionId !== savedSend?.executionId) ||
						(event.turnId !== null && event.turnId !== savedSend?.turnId)
					)
						updateSend(sendId, {
							...(event.executionId === undefined
								? {}
								: { executionId: event.executionId }),
							...(event.commandKey === undefined
								? {}
								: { commandKey: event.commandKey }),
							...(event.turnId === null ? {} : { turnId: event.turnId }),
						})
					if (state.sequence < 0) {
						updateSend(sendId, { chatId: event.chatId, turnId: event.turnId })
						if (initialId === undefined)
							void loadBootstrap(controller.signal).catch(() => {
								/* Recovery also resolves the direct Chat. */
							})
						void readChat(event.chatId, controller.signal).catch(() => {
							/* Recovery reads the committed history when the stream ends. */
						})
					}
					observedActivity.notify(event)
					state = reduceStream(state, event)
					setStreams((current) => ({ ...current, [streamId]: state }))
				}
			} catch {
				// Transport errors do not undo acceptance or permit replaying the input.
			} finally {
				clearTimeout(stalled)
				requests.current.delete(controller)
				if (mounted.current && scope === generation.current) {
					finishSend(sendId, false)
				}
			}
		}
		void consume()
	}

	const send = () => {
		if (bootstrap === null || sending || pendingOperation !== null || readOnly)
			return
		const key = draftKey(view),
			text = (view.drafts[key] ?? "").trim()
		const sentFiles = attachments[key] ?? []
		if (text === "" && sentFiles.length === 0) return
		void action(async () => {
			const scope = generation.current
			let id = selectedId
			let accepted = false
			const captured = view.destination.kind
			const botId = bootstrap.defaultBotId
			if (botId === null)
				throw new Error(t`Kay Bot is not ready for this account yet.`)
			if (captured === "new") {
				const requestId = crypto.randomUUID()
				recordOperation({ requestId, kind: "create" })
				let created
				try {
					created = await client.create({ botId, requestId })
				} catch (error) {
					if (scope !== generation.current) return
					if (
						error instanceof RequestFailed &&
						error.status >= 400 &&
						error.status < 500 &&
						error.problem.code !== "outcome_unknown"
					)
						recordOperation(null)
					throw error
				}
				if (scope !== generation.current || !mounted.current) return
				recordOperation(null)
				id = created.id
				setBootstrap((current) =>
					current === null
						? current
						: {
								...current,
								conversations: [created, ...current.conversations],
							},
				)
				rawDispatch({
					type: "draftFor",
					key: "conversation:" + id,
					value: text,
				})
				const destinationKey = "conversation:" + id
				setAttachments((current) => ({
					...current,
					[destinationKey]: sentFiles,
				}))
				if (draftKey(currentView.current) === key)
					dispatch({
						type: "navigate",
						destination: { kind: "conversation", id },
					})
			}
			setDelivery(null)
			const input: Product.SendMessage = {
				input:
					sentFiles.length === 0
						? text
						: [
								...(text === "" ? [] : [{ type: "text" as const, text }]),
								...sentFiles.map((file) => ({
									type: file.type,
									fileId: file.fileId,
								})),
							],
				stream: true,
				...(memory === "off" ? { memory: { read: false, write: false } } : {}),
			}
			const controller = new AbortController()
			requests.current.add(controller)
			const sendId = beginSend(
				captured === "new" && id !== undefined ? "conversation:" + id : key,
				id,
				captured === "kay" ? botId : null,
			)
			let result
			const admissionTimeout = setTimeout(() => controller.abort(), 30_000)
			try {
				result =
					captured === "kay"
						? await client.sendToBot(
								botId,
								{ ...input, commandKey: sendId },
								controller.signal,
							)
						: await client.send(
								id!,
								{ ...input, commandKey: sendId },
								controller.signal,
							)
			} catch (error) {
				if (scope !== generation.current || !mounted.current) return
				finishSend(sendId, messageWasRejected(error))
				requests.current.delete(controller)
				if (!messageWasRejected(error)) return
				throw error
			} finally {
				clearTimeout(admissionTimeout)
			}
			if (scope !== generation.current || !mounted.current) {
				controller.abort()
				return
			}
			const acknowledge = () => {
				if (accepted) return
				accepted = true
				setMemoryChoices((current) =>
					current[key] === memoryChoice
						? { ...current, [key]: undefined }
						: current,
				)
				setAttachments((current) => {
					const keys =
						captured === "new" && id !== undefined
							? [key, "conversation:" + id]
							: [key]
					return {
						...current,
						...Object.fromEntries(
							keys.map((item) => [
								item,
								(current[item] ?? []).filter(
									(file) =>
										!sentFiles.some((sent) => sent.fileId === file.fileId),
								),
							]),
						),
					}
				})
				rawDispatch({ type: "acknowledge", key, sent: text })
				if (captured === "new" && id !== undefined)
					rawDispatch({
						type: "acknowledge",
						key: "conversation:" + id,
						sent: text,
					})
			}
			await observe({
				result,
				controller,
				initialId: id,
				sendId,
				onAccepted: acknowledge,
			})
		})
	}
	const openChat = (id: string) => {
		dispatch({ type: "navigate", destination: { kind: "conversation", id } })
	}
	const loadEarlier = () => {
		if (selected === undefined || selected.page.next === null) return
		const scope = generation.current
		const key = draftKey(view)
		setLoading(true)
		void client
			.messages(selected.chat.id, selected.page.next)
			.then((page) => {
				if (scope !== generation.current || !mounted.current) return
				setData((current) => {
					const saved = current[selected.chat.id]
					if (saved === undefined) return current
					const items = [
						...page.items.filter(
							(item) =>
								!saved.page.items.some((existing) => existing.id === item.id),
						),
						...saved.page.items,
					]
					return {
						...current,
						[selected.chat.id]: { ...saved, page: { items, next: page.next } },
					}
				})
			})
			.catch((error: unknown) => {
				if (scope === generation.current && mounted.current)
					setReadProblems((current) => ({ ...current, [key]: error }))
			})
			.finally(() => {
				if (
					scope === generation.current &&
					mounted.current &&
					key === draftKey(currentView.current)
				)
					setLoading(false)
			})
	}
	const fork = (reason: "fork" | "regenerate", turnId?: string) => {
		if (selected === undefined || pendingOperation !== null || sending) return
		void action(async () => {
			const scope = generation.current
			let original: Product.SendMessage["input"] | undefined
			if (reason === "regenerate") {
				const turn = selected.turns.items.find((item) => item.id === turnId)
				if (turn === undefined)
					throw new Error(t`The original turn is not available.`)
				let page = selected.page
				while (
					!turn.inputItemIds.every((id) =>
						page.items.some((item) => item.sourceItemId === id),
					) &&
					page.next !== null
				) {
					const older = await client.messages(selected.chat.id, page.next)
					page = {
						items: [
							...older.items.filter(
								(item) => !page.items.some((known) => known.id === item.id),
							),
							...page.items,
						],
						next: older.next,
					}
				}
				original = regenerationInput({ turn, page })
			}
			const requestId = crypto.randomUUID()
			recordOperation({ requestId, kind: "fork" })
			let next
			try {
				next = await client.fork(selected.chat.id, {
					expected: selected.chat.revision,
					requestId,
					reason,
					...(turnId === undefined
						? {}
						: {
								through: {
									turnId,
									edge: reason === "regenerate" ? "before" : "after",
								},
							}),
				})
			} catch (error) {
				if (scope !== generation.current || !mounted.current) return
				if (
					error instanceof RequestFailed &&
					error.status >= 400 &&
					error.status < 500 &&
					error.problem.code !== "outcome_unknown"
				)
					recordOperation(null)
				throw error
			}
			if (scope !== generation.current || !mounted.current) return
			recordOperation(null)
			await loadBootstrap()
			if (scope !== generation.current || !mounted.current) return
			openChat(next.id)
			if (original !== undefined) {
				const key = "conversation:" + next.id
				const originalText =
					typeof original === "string"
						? original
						: original
								.flatMap((part) => (part.type === "text" ? [part.text] : []))
								.join("\n")
				const originalFiles: ReadonlyArray<Attachment> =
					typeof original === "string"
						? []
						: original.flatMap((part) =>
								part.type === "text"
									? []
									: [
											{
												fileId: part.fileId,
												name: part.fileId,
												type: part.type,
											},
										],
							)
				rawDispatch({ type: "draftFor", key, value: originalText })
				setAttachments((current) => ({ ...current, [key]: originalFiles }))
				let accepted = false
				const controller = new AbortController()
				requests.current.add(controller)
				const sendId = beginSend(key, next.id, null)
				const admissionTimeout = setTimeout(() => controller.abort(), 30_000)
				try {
					const result = await client.send(
						next.id,
						{ input: original, stream: true, commandKey: sendId },
						controller.signal,
					)
					if (scope !== generation.current || !mounted.current) {
						controller.abort()
						return
					}
					await observe({
						result,
						controller,
						initialId: next.id,
						sendId,
						onAccepted: () => {
							if (accepted) return
							accepted = true
							rawDispatch({
								type: "acknowledge",
								key,
								sent: originalText.trim(),
							})
							setAttachments((current) => ({
								...current,
								[key]: (current[key] ?? []).filter(
									(part) =>
										!originalFiles.some((sent) => sent.fileId === part.fileId),
								),
							}))
						},
					})
				} catch (error) {
					if (scope !== generation.current || !mounted.current) return
					finishSend(sendId, messageWasRejected(error))
					requests.current.delete(controller)
					if (!messageWasRejected(error)) return
					throw error
				} finally {
					clearTimeout(admissionTimeout)
				}
			}
		})
	}
	const inspectOperation = (reconcile: boolean) => {
		if (pendingOperation === null) return
		const requestId = pendingOperation.requestId
		void action(async () => {
			const scope = generation.current
			const result = reconcile
				? await client.reconcileConversationOperation(requestId)
				: await client.conversationOperation(requestId)
			if (scope !== generation.current || !mounted.current) return
			setOperationResult(result)
			if (result.phase === "Completed" && result.chatId !== null) {
				await loadBootstrap()
				if (scope !== generation.current || !mounted.current) return
				await readChat(result.chatId)
				recordOperation(null)
				openChat(result.chatId)
			}
		})
	}
	const signOut = async () => {
		if (signOutLock.current) return
		signOutLock.current = true
		setSigningOut(true)
		setSignOutFailed(false)
		try {
			await signOutWorkspace({
				request: () => requestSignOut(window.location.origin),
				clear: () => {
					drafts.clear()
					mounted.current = false
					generation.current++
					bootstrapRequest.current++
					for (const controller of requests.current) controller.abort()
					requests.current.clear()
					flushSync(() => {
						setBootstrap(null)
						setData({})
						setStreams({})
						setAttachments({})
						setFiles([])
						setOpenedApp(null)
						setPreferences(preferencesFrom({}))
						setBranches([])
						setDelivery(null)
						setOperationResult(null)
						setQuery("")
						rawDispatch({ type: "reset" })
					})
					try {
						clearPrivateViewStorage(window.sessionStorage)
					} catch {
						// Browsers may deny access to session storage entirely.
					}
				},
				navigate: () => window.location.replace("/"),
			})
		} catch {
			if (mounted.current) {
				setSignOutFailed(true)
				rawDispatch({ type: "navigation", open: false })
				rawDispatch({ type: "detail", id: null })
			}
		} finally {
			signOutLock.current = false
			if (mounted.current) setSigningOut(false)
		}
	}
	const visibleProblem =
		readProblems[draftKey(view)] ??
		viewProblems[draftKey(view)] ??
		observedActivity.problem ??
		problem
	const errorMessage =
		visibleProblem instanceof RequestFailed
			? visibleProblem.problem.message
			: visibleProblem instanceof Error
				? visibleProblem.message
				: t`Kay could not finish this request.`
	const error =
		visibleProblem === null ? null : (
			<div className="next-live-error" role="alert">
				<p>{errorMessage}</p>
				{visibleProblem instanceof RequestFailed &&
				visibleProblem.status === 401 ? (
					<a
						href={`/sign-in?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`}
					>{t`Sign in`}</a>
				) : (
					<Button
						variant="outline"
						disabled={loading}
						onClick={() => {
							void refresh()
						}}
					>{t`Refresh`}</Button>
				)}
				<ConnectionSettings />
			</div>
		)
	if (bootstrap === null)
		return (
			<Provider placement="home" startup="ready">
				<div className="boot">
					<Anchor placement="home" className="next-home-mascot" />
					<h1>Kay</h1>
					{error ?? <LoadingSkeleton />}
					<a href="/">{t`Open your conversations`}</a>
				</div>
			</Provider>
		)
	const baseWorkspace = workspaceFrom(bootstrap)
	const workspace = {
		...baseWorkspace,
		account: {
			...baseWorkspace.account,
			planName:
				accountMembership.value === null
					? accountMembership.error === null
						? t`Loading membership…`
						: t`Membership unavailable`
					: accountPlanName(accountMembership.value),
		},
		conversations: baseWorkspace.conversations.map((chat) => ({
			...chat,
			pinned: preferences.pinned.includes(chat.id),
		})),
	}
	const onStartConversation = (prompt?: string) => {
		const next = reduceView(view, {
			type: "navigate",
			destination: { kind: "new" },
		})
		dispatch({ type: "navigate", destination: { kind: "new" } })
		if (prompt !== undefined)
			rawDispatch({ type: "draftFor", key: draftKey(next), value: prompt })
	}
	const onUseFile = (file: Attachment) => {
		const key = draftKey(
			reduceView(view, { type: "navigate", destination: { kind: "new" } }),
		)
		setAttachments((previous) => ({
			...previous,
			[key]: [
				...(previous[key] ?? []).filter((item) => item.fileId !== file.fileId),
				file,
			],
		}))
		onStartConversation()
	}
	const onAttachFile = async (
		file: Attachment,
		chatId: string,
		signal: AbortSignal,
	) => {
		const scope = generation.current
		const key = "attach:" + chatId
		if (writeLocks.current.has(key)) return
		writeLocks.current.add(key)
		const controller = new AbortController()
		requests.current.add(controller)
		const abort = () => controller.abort(signal.reason)
		signal.addEventListener("abort", abort, { once: true })
		if (signal.aborted) abort()
		try {
			await saveFileAttachment({
				storage: sessionStorage,
				identity: bootstrap.identity,
				client,
				chatId,
				fileId: file.fileId,
				requestId: crypto.randomUUID(),
				signal: controller.signal,
			})
			if (!mounted.current || scope !== generation.current) return
			await readChat(chatId, controller.signal)
			if (!mounted.current || scope !== generation.current) return
			const destination = currentView.current.destination
			if (
				destination.kind === "feature" &&
				destination.id === "files" &&
				destination.conversationId === chatId
			)
				openChat(chatId)
		} finally {
			signal.removeEventListener("abort", abort)
			requests.current.delete(controller)
			if (scope === generation.current) writeLocks.current.delete(key)
		}
	}
	const onConversationAutomations = (conversationId: string) =>
		dispatch({
			type: "navigate",
			destination: {
				kind: "feature",
				id: "automations",
				title: t`Automations`,
				conversationId,
			},
		})
	const automationLinks = workspace.conversations.map((chat) => ({
		chatId: chat.id,
		title: chat.title,
		automationIds: chat.automationIds ?? [],
	}))
	const onLinkAutomation = async (triggerId: string, chatId: string | null) => {
		const scope = generation.current
		const expectedChatId =
			automationLinks.find((link) => link.automationIds.includes(triggerId))
				?.chatId ?? null
		let saved
		try {
			saved = await client.linkAutomation(triggerId, { chatId, expectedChatId })
		} catch (failure) {
			if (!(
				failure instanceof RequestFailed &&
				failure.problem.code === "outcome_unknown"
			))
				throw failure
			const observed = await client.automationLink(triggerId)
			if (observed.chatId !== chatId) throw failure
			saved = observed
		}
		if (scope !== generation.current || !mounted.current) return
		setBootstrap((previous) =>
			previous === null
				? null
				: {
						...previous,
						metadata: [
							...(previous.metadata ?? []).filter(
								(item) =>
									!saved.metadata.some(
										(changed) => changed.chatId === item.chatId,
									),
							),
							...saved.metadata,
						],
					},
		)
	}
	const companion =
		workspace.companions.find(
			(bot) =>
				bot.id ===
				(view.destination.kind === "new"
					? view.companionId
					: (selected?.chat.botId ?? bootstrap.defaultBotId)),
		) ??
		workspace.companions.find((bot) => bot.isDefault) ??
		workspace.companions[0]
	const effectiveView =
		view.companionId === "kay" && bootstrap.defaultBotId !== null
			? { ...view, companionId: bootstrap.defaultBotId }
			: view
	const transcript =
		selected === undefined
			? null
			: transcriptActivity({
					page: selected.page,
					activity: observedActivity.stale ? null : observedActivity.activity,
				})
	const committed = transcript === null ? [] : messagesFrom(transcript.page)
	const streaming = Object.entries(streams)
		.filter(
			([key, state]) =>
				state.chatId === selectedId ||
				(view.destination.kind === "kay" &&
					selectedId === undefined &&
					pendingSends.some(
						(send) => send.id === key && send.viewKey === "direct:kay",
					)),
		)
		.flatMap(([, state]) => state.messages)
	const chatMessages = mergeMessages(committed, streaming)
	const detail =
		view.detailId === "app-interface" && openedApp !== null ? (
			<AppInterface
				client={client}
				owner={
					bootstrap.identity.organizationId + ":" + bootstrap.identity.userId
				}
				opened={openedApp}
				onChanged={refresh}
				onClose={() => {
					setOpenedApp(null)
					dispatch({ type: "detail", id: null })
				}}
			/>
		) : view.detailId === "voice" ? (
			<div className="next-voice-detail">
				<p className="feature-help">{t`Voice currently uses a separate conversation. Your text conversation and draft stay here.`}</p>
				<Voice client={client} bootstrap={bootstrap} onOpenChat={openChat} />
			</div>
		) : view.detailId === "saved-files" ? (
			<div className="next-detail">
				<Button variant="outline" onClick={savedFiles}>{t`Refresh`}</Button>
				{files.map((file) => (
					<Button
						key={file.fileId}
						variant="ghost"
						onClick={() => {
							const key = draftKey(currentView.current)
							setAttachments((current) => ({
								...current,
								[key]: [
									...(current[key] ?? []).filter(
										(item) => item.fileId !== file.fileId,
									),
									file,
								],
							}))
							dispatch({ type: "detail", id: null })
						}}
					>
						{file.name}
					</Button>
				))}
			</div>
		) : view.detailId === "account" ? (
			<div className="next-detail">
				<p>{bootstrap.identity.displayName}</p>
				<Language />
				<Button
					variant="outline"
					onClick={() => setAppearance(dark ? "light" : "dark")}
				>
					{dark ? <Sun size={16} /> : <Moon size={16} />}{" "}
					{dark ? t`Light appearance` : t`Dark appearance`}
				</Button>
				<h3>{t`Archived conversations`}</h3>
				{workspace.conversations
					.filter((chat) => chat.archived === true)
					.map((chat) => (
						<Button
							key={chat.id}
							variant="ghost"
							onClick={() => openChat(chat.id)}
						>
							{chat.title}
						</Button>
					))}
			</div>
		) : view.detailId === "search" ? (
			<div className="next-detail">
				<label htmlFor="next-live-search">{t`Search conversations`}</label>
				<input
					id="next-live-search"
					className="next-search-input"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
				/>
				{workspace.conversations
					.filter((chat) =>
						chat.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
					)
					.map((chat) => (
						<Button
							key={chat.id}
							variant="ghost"
							onClick={() =>
								chat.kind === "direct"
									? dispatch({ type: "navigate", destination: { kind: "kay" } })
									: openChat(chat.id)
							}
						>
							{chat.title}
						</Button>
					))}
			</div>
		) : (
			<div className="next-detail">
				{selected !== undefined ? (
					<>
						<p>
							{selected.chat.status} · {t`Queued inputs`}:{" "}
							{selected.chat.queuedInputs}
						</p>
						<ChatSettings
							key={selected.chat.id}
							client={client}
							chat={selected.chat}
							disabled={
								busy ||
								sending ||
								selected.chat.status === "Running" ||
								selected.chat.openWork.approvals > 0
							}
							onChanged={() => readChat(selected.chat.id)}
						/>
						{selected.chat.kind === "conversation" && (
							<>
								<Button
									variant="outline"
									disabled={
										busy ||
										sending ||
										selected.chat.status === "Running" ||
										selected.chat.queuedInputs > 0 ||
										selected.chat.openWork.approvals > 0 ||
										selected.chat.openWork.tasks > 0 ||
										selected.chat.openWork.reminders > 0
									}
									onClick={() => fork("fork")}
								>{t`Fork conversation`}</Button>
								<Button
									variant="ghost"
									onClick={() => {
										void readForCurrentView(
											() => client.branches(selected.chat.id),
											setBranches,
										)
									}}
								>{t`View branches`}</Button>
								{branches.map((branch) => (
									<Button
										key={branch.id}
										variant="ghost"
										onClick={() => openChat(branch.id)}
									>
										{branch.title ?? branch.id}
									</Button>
								))}
							</>
						)}
						<h3>{t`Memory defaults`}</h3>
						{(["read", "write"] as const).map((key) => (
							<label key={key} className="next-live-option">
								<input
									type="checkbox"
									checked={selected.chat.memory[key]}
									disabled={busy || sending}
									onChange={(event) => {
										const checked = event.target.checked
										void action(async () => {
											await client.update(selected.chat.id, {
												expected: selected.chat.revision,
												memory: { ...selected.chat.memory, [key]: checked },
											})
											await readChat(selected.chat.id)
										})
									}}
								/>
								{key === "read" ? t`Read memory` : t`Write memory`}
							</label>
						))}
						<Button
							variant="outline"
							onClick={() => feature("requests", t`Approvals`)}
						>
							{t`Approvals`} · {selected.chat.openWork.approvals}
						</Button>
						<h3>{t`Turns`}</h3>
						{selected.turns.items.map((turn) => (
							<div key={turn.id} className="next-live-turn">
								<span>
									{new Date(turn.startedAt).toLocaleString()} · {turn.status}
								</span>
								{selected.chat.kind === "conversation" &&
									turn.status !== "Running" && (
										<Button
											variant="ghost"
											disabled={busy || sending}
											onClick={() => fork("regenerate", turn.id)}
										>{t`Regenerate`}</Button>
									)}
							</div>
						))}
						{selected.turns.next !== null && (
							<Button
								variant="ghost"
								disabled={loading}
								onClick={() => {
									void readForCurrentView(
										() =>
											client.turns(
												selected.chat.id,
												selected.turns.next ?? undefined,
											),
										(page) =>
											setData((current) => {
												const saved = current[selected.chat.id]
												return saved === undefined
													? current
													: {
															...current,
															[selected.chat.id]: {
																...saved,
																turns: {
																	items: [
																		...saved.turns.items,
																		...page.items.filter(
																			(item) =>
																				!saved.turns.items.some(
																					(known) => known.id === item.id,
																				),
																		),
																	],
																	next: page.next,
																},
															},
														}
											}),
									)
								}}
							>{t`Load earlier turns`}</Button>
						)}
						{selected.chat.kind === "conversation" && (
							<Management
								key={selected.chat.id}
								client={client}
								chat={selected.chat}
								title={
									workspace.conversations.find(
										(chat) => chat.id === selected.chat.id,
									)?.title ??
									selected.chat.title ??
									t`Conversation`
								}
								preferences={preferences}
								onPreferences={setPreferences}
								onChanged={loadBootstrap}
								onDeleted={() =>
									dispatch({ type: "navigate", destination: { kind: "kay" } })
								}
							/>
						)}
					</>
				) : (
					<p>{t`Start a conversation to see its details.`}</p>
				)}
			</div>
		)
	const status = (
		<>
			{error}
			{selected?.chat.status === "Failed" && (
				<div className="next-live-error" role="alert">
					<p>{t`This turn could not be completed. Your saved messages are still available.`}</p>
					<Button
						variant="ghost"
						onClick={() => dispatch({ type: "detail", id: "conversation" })}
					>{t`Conversation details`}</Button>
				</div>
			)}
			{selected?.chat.status === "Interrupted" && (
				<p
					className="next-composer-note"
					role="status"
				>{t`Execution stopped. Committed work is preserved.`}</p>
			)}
			{selected?.chat.status === "Running" && !hasActivity && (
				<p className="next-composer-note" role="status">{t`Working…`}</p>
			)}
			{selected !== undefined && selected.chat.openWork.approvals > 0 && (
				<Button
					variant="outline"
					onClick={() => feature("requests", t`Approvals`)}
				>{t`Waiting for your approval`}</Button>
			)}
			{readOnly && (
				<p className="next-composer-note">{t`This conversation is read-only.`}</p>
			)}
			{loading && (
				<p className="next-composer-note" role="status">{t`Loading…`}</p>
			)}
			{delivery !== null && delivery.chatId === selectedId && (
				<p className="next-composer-note" role="status">
					{delivery.delivery === "queued"
						? t`Your message is queued.`
						: delivery.delivery === "steered"
							? t`Your message was added to the current turn.`
							: t`Your message was accepted.`}
				</p>
			)}
			{pendingOperation !== null && !busy && (
				<div className="next-live-error" role="status">
					<p>{t`The conversation change is not confirmed. Check its saved result before continuing.`}</p>
					<p>
						<code>{pendingOperation.requestId}</code>
						{operationResult === null ? null : ` · ${operationResult.phase}`}
					</p>
					<Button
						variant="outline"
						disabled={busy}
						onClick={() => inspectOperation(false)}
					>{t`Check conversation change`}</Button>
					{operationResult?.phase === "Applied" && (
						<Button
							variant="outline"
							disabled={busy}
							onClick={() => inspectOperation(true)}
						>{t`Finish conversation organization`}</Button>
					)}
					<p>{t`Recovery opens the saved conversation. It does not send or regenerate a message.`}</p>
				</div>
			)}
			{restoring && (
				<p className="next-composer-note" role="status">
					{uncertain
						? t`The last message could not be confirmed. Saved progress is syncing; your message will not be sent again automatically.`
						: t`Restoring the conversation… Saved progress will appear automatically.`}
				</p>
			)}
			<label className="next-live-memory">
				{t`This message`}
				<select
					value={memory}
					onChange={(event) =>
						setMemoryChoices((current) => ({
							...current,
							[draftKey(view)]: {
								value: event.target.value === "off" ? "off" : "default",
							},
						}))
					}
				>
					<option value="default">{t`Use conversation memory defaults`}</option>
					<option value="off">{t`Do not read or write memory`}</option>
				</select>
			</label>
		</>
	)
	return (
		<Shell
			workspace={workspace}
			replyActive={activity?.status === "Running"}
			thinking={
				activity?.status === "Running" && observedActivity?.stale !== true
			}
			view={effectiveView}
			dispatch={dispatch}
			navigationItems={featureNavigation}
			onConversationAutomations={onConversationAutomations}
			accountItems={[
				{
					id: "settings",
					label: t`Settings`,
					icon: Settings2,
					onSelect: () => feature("settings", t`Settings`),
				},
				...(canOpenAdmin(bootstrap.access)
					? [
							{
								id: "admin",
								label: t`Administrator console`,
								icon: ShieldCheck,
								onSelect: () => feature("admin", t`Administrator console`),
							},
						]
					: []),
				{
					id: "sign-out",
					label: signingOut ? t`Signing out…` : t`Sign out`,
					icon: LogOut,
					disabled: signingOut,
					onSelect: () => void signOut(),
				},
			]}
			onConversationMenu={(id) => {
				openChat(id)
				rawDispatch({ type: "detail", id: "conversation" })
			}}
			onMembership={() => feature("membership", "Treasure")}
			onAccount={() => feature("settings", t`Settings`)}
			onSearch={() => dispatch({ type: "detail", id: "search" })}
			onDetails={() => dispatch({ type: "detail", id: "conversation" })}
			detail={detail}
			detailTitle={
				view.detailId === "account"
					? t`Your account`
					: view.detailId === "search"
						? t`Search conversations`
						: view.detailId === "voice"
							? t`Voice conversation`
							: t`Conversation details`
			}
		>
			{signOutFailed && (
				<div className="next-live-error" role="alert">
					<p>{t`Kay could not finish this request.`}</p>
					<Button
						variant="outline"
						disabled={signingOut}
						onClick={() => void signOut()}
					>
						{signingOut ? t`Signing out…` : t`Sign out`}
					</Button>
				</div>
			)}
			{view.destination.kind === "feature" ? (
				<FeatureView
					id={view.destination.id}
					client={client}
					authorization={location.authorization}
					developerTest={location.developerTest}
					bootstrap={bootstrap}
					onOpenChat={openChat}
					onStartConversation={onStartConversation}
					onUseFile={onUseFile}
					onAttachFile={onAttachFile}
					onNavigateFeature={(id) => feature(id, groupLabel(id))}
					conversationId={view.destination.conversationId}
					automationLinks={automationLinks}
					onLinkAutomation={onLinkAutomation}
					onBackToConversation={() =>
						dispatch({ type: "navigate", destination: { kind: "kay" } })
					}
					onChanged={async () => {
						await Promise.all([loadBootstrap(), accountMembership.reload()])
					}}
				/>
			) : companion === undefined ? (
				<div className="next-page">
					<Anchor placement="home" className="next-home-mascot" />
					<p>{t`Kay Bot is not ready for this account yet.`}</p>
					<Button onClick={() => void refresh()}>{t`Refresh`}</Button>
				</div>
			) : (
				<ChatTransition
					kind={
						view.destination.kind === "conversation"
							? "conversation"
							: view.destination.kind === "new"
								? "new"
								: "kay"
					}
					enabled
				>
					<ChatView
						kind={
							view.destination.kind === "conversation"
								? "conversation"
								: view.destination.kind === "new"
									? "new"
									: "kay"
						}
						title={selected?.chat.title ?? "Kay"}
						messages={chatMessages}
						draft={view.drafts[draftKey(view)] ?? ""}
						onDraft={(value) => dispatch({ type: "draft", value })}
						onSubmit={send}
						onDetail={(id) =>
							id === "voice"
								? dispatch({ type: "detail", id: "voice" })
								: id === "saved-files"
									? savedFiles()
									: id === "attach"
										? feature("files", t`Files`)
										: dispatch({ type: "detail", id })
						}
						preview={false}
						conversationKey={
							bootstrap.identity.userId + ":" + (selectedId ?? draftKey(view))
						}
						historyReady={selected !== undefined || selectedId === undefined}
						busy={
							busy ||
							loading ||
							sending ||
							pendingOperation !== null ||
							uploading ||
							readOnly
						}
						attachments={attachments[draftKey(view)] ?? []}
						onUpload={upload}
						onDownloadAttachment={downloadAttachment}
						onAppView={({ operationId, itemId }) => {
							if (selectedId === undefined) return
							const scope = generation.current
							const request = ++appViewRequest.current
							void action(async () => {
								const opened = await client.featureCall("appViews.open", {
									params: { operationId },
									payload: { chatId: selectedId, itemId },
								})
								if (
									scope !== generation.current ||
									!mounted.current ||
									request !== appViewRequest.current
								)
									return
								setOpenedApp(opened)
								dispatch({ type: "detail", id: "app-interface" })
							})
						}}
						onRemoveAttachment={(id) => {
							const key = draftKey(view)
							setAttachments((current) => ({
								...current,
								[key]: (current[key] ?? []).filter(
									(item) => item.fileId !== id,
								),
							}))
						}}
						activityActive={hasActivity && activityNeedsObservation(activity)}
						activityInDock={island !== null}
						activity={
							hasActivity ? (
								<ActivityView
									key={taskId}
									island={island}
									records={transcript?.records ?? []}
									historyPending={
										observedActivity?.activity != null &&
										earlierActivityPending(observedActivity.activity)
									}
									activity={activity}
									history={observedActivity.activity!}
									stale={observedActivity?.stale ?? false}
									approvals={selected?.chat.openWork.approvals ?? 0}
									devices={
										deviceNames?.owner === activityOwner
											? deviceNames.values
											: new Map()
									}
									onApprovals={() => feature("requests", t`Approvals`)}
									onFiles={() => feature("files", t`Files`)}
								/>
							) : undefined
						}
						status={status}
						{...(selected !== undefined && selected.page.next !== null
							? { onEarlier: loadEarlier }
							: {})}
						{...(selected?.chat.status === "Running"
							? {
									onStop: () => {
										void action(async () => {
											await client.interrupt(selected.chat.id)
											await readChat(selected.chat.id)
										})
									},
								}
							: {})}
					/>
				</ChatTransition>
			)}
		</Shell>
	)
}
