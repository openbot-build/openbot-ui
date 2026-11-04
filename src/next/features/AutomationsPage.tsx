import { t } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import {
	CalendarClock,
	ChevronRight,
	Clock3,
	Link2,
	MessageSquare,
	Pause,
	Pencil,
	Play,
	Plus,
	RefreshCw,
	Search,
	Sparkles,
	Trash2,
	ArrowLeft,
	Check,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "../../components/ui/button"
import { PageHeading } from "../Shell"
import {
	decodeAutomation,
	decodeAutomations,
	scheduleDraft,
	scheduleFromDraft,
	type Automation,
	type ScheduleDraft,
	type Cadence,
} from "./AutomationData"
import {
	useWorkspaceWorkflow,
	WorkflowNotice,
	type WorkflowProps,
} from "./Workflow"
import "./AutomationsPage.css"
import { RemindersSection } from "./RemindersSection"

interface AutomationLink {
	readonly chatId: string
	readonly title: string
	readonly automationIds: ReadonlyArray<string>
}
export interface AutomationsPageProps extends WorkflowProps {
	readonly previewAutomations?: ReadonlyArray<Automation> | undefined
	readonly onPreviewAutomationsChange?:
		((items: ReadonlyArray<Automation>) => void) | undefined
	readonly conversationId?: string | undefined
	readonly automationLinks?: ReadonlyArray<AutomationLink> | undefined
	readonly onLinkAutomation?:
		((triggerId: string, chatId: string | null) => Promise<void>) | undefined
	readonly onChanged?: (() => void | Promise<void>) | undefined
}
interface Editor extends ScheduleDraft {
	readonly id: string | null
	readonly revision: number
	readonly prompt: string
	readonly bot: string
	readonly chatId: string
	readonly enabled: boolean
}
const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
const messageOf = (failure: unknown) =>
	failure instanceof Error
		? failure.message
		: t`This request could not be completed.`
const weekdays = () => [
	t`Sunday`,
	t`Monday`,
	t`Tuesday`,
	t`Wednesday`,
	t`Thursday`,
	t`Friday`,
	t`Saturday`,
]
const cadenceLabel = (draft: ScheduleDraft) =>
	draft.cadence === "daily"
		? t`Every day`
		: draft.cadence === "weekdays"
			? t`Weekdays`
			: draft.cadence === "weekly"
				? t`Every ${weekdays()[Number(draft.day)] ?? t`week`}`
				: draft.cadence === "event"
					? t`When an event arrives`
					: t`Custom schedule`
const scheduleLabel = (automation: Automation) => {
	const draft = scheduleDraft(automation.schedule, timeZone())
	return draft.cadence === "custom" || draft.cadence === "event"
		? cadenceLabel(draft)
		: `${cadenceLabel(draft)} · ${draft.time}`
}
export const createPreviewAutomations = (): ReadonlyArray<Automation> => [
	{
		id: "preview-morning",
		bot: "kay",
		prompt: t`Prepare a short morning briefing with my priorities and anything that needs a decision.`,
		schedule: { cron: "0 9 * * 1-5", timeZone: timeZone() },
		webhook: false,
		enabled: true,
		nextRunAt: null,
		lastFiredAt: null,
		revision: 0,
	},
	{
		id: "preview-weekly",
		bot: "kay",
		prompt: t`Review this week's progress and suggest three priorities for the next week.`,
		schedule: { cron: "0 17 * * 5", timeZone: timeZone() },
		webhook: false,
		enabled: true,
		nextRunAt: null,
		lastFiredAt: null,
		revision: 0,
	},
	{
		id: "preview-research",
		bot: "kay",
		prompt: t`Check the topics I am following and collect useful updates with their original sources.`,
		schedule: { cron: "30 10 * * 1", timeZone: timeZone() },
		webhook: false,
		enabled: false,
		nextRunAt: null,
		lastFiredAt: null,
		revision: 0,
	},
]

export function AutomationsPage(props: AutomationsPageProps) {
	const { i18n } = useLingui()
	const workflow = useWorkspaceWorkflow(props)
	const { preview, ready, read, can } = workflow
	const [items, setItems] = useState<ReadonlyArray<Automation>>(() =>
		props.client === undefined
			? (props.previewAutomations ?? createPreviewAutomations())
			: [],
	)
	const [loading, setLoading] = useState(props.client !== undefined)
	const [error, setError] = useState<string | null>(null)
	const [feedback, setFeedback] = useState<string | null>(null)
	const [filter, setFilter] = useState<"all" | "active" | "paused">("all")
	const [search, setSearch] = useState("")
	const [selected, setSelected] = useState<string | null>(null)
	const [editor, setEditor] = useState<Editor | null>(null)
	const [review, setReview] = useState(false)
	const [deleteId, setDeleteId] = useState<string | null>(null)
	const [linkTarget, setLinkTarget] = useState("")
	const [linking, setLinking] = useState(false)
	const [pendingLink, setPendingLink] = useState<{
		id: string
		chatId: string
	} | null>(null)
	const mounted = useRef(true)
	const readGeneration = useRef(0)
	const operationPending = useRef(false)
	const itemsRef = useRef(items)
	itemsRef.current = items
	const links = props.automationLinks ?? []
	const source = links.find((entry) => entry.chatId === props.conversationId)
	const defaultBotId = preview ? "kay" : (props.bootstrap?.defaultBotId ?? "")
	const associated = (id: string) =>
		links.find((entry) => entry.automationIds.includes(id))
	const scoped =
		props.conversationId === undefined
			? items
			: items.filter(
					(entry) =>
						source?.automationIds.includes(entry.id) === true ||
						pendingLink?.id === entry.id,
				)
	const visible = scoped.filter(
		(entry) =>
			(filter === "all" || entry.enabled === (filter === "active")) &&
			entry.prompt.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
	)
	const disabled = workflow.busy || linking
	const dateLabel = (value: number | null) =>
		value === null
			? t`Not yet`
			: new Intl.DateTimeFormat(i18n.locale, {
					dateStyle: "medium",
					timeStyle: "short",
				}).format(value)
	const load = async (signal?: AbortSignal) => {
		if (preview || !can("triggers.listTriggers")) return
		const generation = ++readGeneration.current
		setLoading(true)
		setError(null)
		try {
			const records = decodeAutomations(
				await read("triggers.listTriggers", {}, signal),
			)
			if (mounted.current && generation === readGeneration.current)
				setItems(records)
		} catch (failure) {
			if (
				mounted.current &&
				signal?.aborted !== true &&
				generation === readGeneration.current
			)
				setError(messageOf(failure))
		} finally {
			if (mounted.current && generation === readGeneration.current)
				setLoading(false)
		}
	}
	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
			readGeneration.current++
		}
	}, [])
	useEffect(() => {
		if (preview && props.previewAutomations !== undefined)
			setItems(props.previewAutomations)
	}, [preview, props.previewAutomations])
	useEffect(() => {
		if (!ready) return
		if (preview || !can("triggers.listTriggers")) {
			setLoading(false)
			return
		}
		const controller = new AbortController()
		void load(controller.signal)
		return () => controller.abort()
	}, [ready, preview, read, can])
	useEffect(() => {
		setSelected(null)
		setEditor(null)
		setDeleteId(null)
		setSearch("")
		setFilter("all")
	}, [props.conversationId])
	const start = (prompt = "", cadence: Cadence = "weekdays") => {
		setError(null)
		setFeedback(null)
		setSelected(null)
		setReview(false)
		setEditor({
			id: null,
			revision: 0,
			prompt,
			bot: defaultBotId,
			chatId: props.conversationId ?? "",
			enabled: true,
			cadence,
			time: cadence === "weekly" ? "17:00" : "09:00",
			day: cadence === "weekly" ? "5" : "1",
			timeZone: timeZone(),
			original: null,
		})
	}
	const edit = (automation: Automation) => {
		setReview(false)
		setError(null)
		setEditor({
			...scheduleDraft(automation.schedule, timeZone()),
			id: automation.id,
			revision: automation.revision,
			prompt: automation.prompt,
			bot: automation.bot,
			chatId: associated(automation.id)?.chatId ?? "",
			enabled: automation.enabled,
		})
	}
	const select = (automation: Automation) => {
		setSelected(selected === automation.id ? null : automation.id)
		setDeleteId(null)
		setLinkTarget(
			pendingLink?.id === automation.id
				? pendingLink.chatId
				: (associated(automation.id)?.chatId ?? ""),
		)
		setError(null)
		setFeedback(null)
	}
	const changeItems = (
		update: (previous: ReadonlyArray<Automation>) => ReadonlyArray<Automation>,
	) => {
		const next = update(itemsRef.current)
		itemsRef.current = next
		setItems(next)
		if (preview) props.onPreviewAutomationsChange?.(next)
	}
	const upsert = (automation: Automation) =>
		changeItems((previous) =>
			previous.some((entry) => entry.id === automation.id)
				? previous.map((entry) =>
						entry.id === automation.id ? automation : entry,
					)
				: [automation, ...previous],
		)
	const link = async (automationId: string, chatId: string) => {
		if (props.onLinkAutomation === undefined) return
		setLinking(true)
		setError(null)
		try {
			await props.onLinkAutomation(automationId, chatId || null)
			if (mounted.current) setPendingLink(null)
		} catch {
			if (mounted.current) {
				setPendingLink({ id: automationId, chatId })
				setError(
					t`The automation is saved, but its conversation link was not updated. Select it below to try linking again.`,
				)
			}
		} finally {
			if (mounted.current) setLinking(false)
		}
	}
	const save = async () => {
		if (editor === null || operationPending.current || disabled) return
		operationPending.current = true
		setError(null)
		setFeedback(null)
		const draft = editor
		try {
			const schedule = scheduleFromDraft(draft)
			const automation = preview
				? {
						id: draft.id ?? `preview-${crypto.randomUUID()}`,
						revision: draft.revision + 1,
						prompt: draft.prompt.trim(),
						bot: draft.bot,
						schedule,
						enabled: draft.enabled,
						webhook:
							items.find((entry) => entry.id === draft.id)?.webhook ?? false,
						nextRunAt: null,
						lastFiredAt: null,
					}
				: decodeAutomation(
						await workflow.call(
							draft.id === null
								? "triggers.createTrigger"
								: "triggers.updateTrigger",
							draft.id === null
								? {
										payload: {
											prompt: draft.prompt.trim(),
											bot: draft.bot,
											...(schedule === null ? {} : { schedule }),
											enabled: draft.enabled,
										},
									}
								: {
										params: { triggerId: draft.id },
										payload: {
											expected: draft.revision,
											prompt: draft.prompt.trim(),
											bot: draft.bot,
											schedule,
											enabled: draft.enabled,
										},
									},
						),
					)
			if (!mounted.current) return
			upsert(automation)
			setEditor(null)
			setReview(false)
			setSelected(automation.id)
			setLinkTarget(draft.chatId)
			setFeedback(
				preview
					? t`Saved in this preview. No scheduled task was created.`
					: t`Automation saved.`,
			)
			const previousChat =
				draft.id === null ? "" : (associated(draft.id)?.chatId ?? "")
			if (draft.chatId !== previousChat) await link(automation.id, draft.chatId)
			await props.onChanged?.()
		} catch (failure) {
			if (mounted.current) setError(messageOf(failure))
		} finally {
			operationPending.current = false
		}
	}
	const toggle = async (automation: Automation) => {
		if (disabled || operationPending.current) return
		operationPending.current = true
		setError(null)
		setFeedback(null)
		try {
			const changed = preview
				? {
						...automation,
						enabled: !automation.enabled,
						revision: automation.revision + 1,
					}
				: decodeAutomation(
						await workflow.call("triggers.updateTrigger", {
							params: { triggerId: automation.id },
							payload: {
								expected: automation.revision,
								enabled: !automation.enabled,
							},
						}),
					)
			if (!mounted.current) return
			upsert(changed)
			setFeedback(
				changed.enabled
					? t`Automation resumed.`
					: t`Automation paused. Tasks already running can still finish.`,
			)
			await props.onChanged?.()
		} catch (failure) {
			if (mounted.current) setError(messageOf(failure))
		} finally {
			operationPending.current = false
		}
	}
	const remove = async (automation: Automation) => {
		if (disabled || operationPending.current) return
		operationPending.current = true
		setError(null)
		try {
			if (!preview)
				await workflow.call("triggers.deleteTrigger", {
					params: { triggerId: automation.id },
				})
			if (!mounted.current) return
			changeItems((previous) =>
				previous.filter((entry) => entry.id !== automation.id),
			)
			setSelected(null)
			setDeleteId(null)
			setFeedback(
				preview ? t`Removed from this preview.` : t`Automation deleted.`,
			)
			if (
				associated(automation.id) !== undefined &&
				props.onLinkAutomation !== undefined
			) {
				try {
					await props.onLinkAutomation(automation.id, null)
				} catch {
					if (mounted.current)
						setError(
							t`The automation was deleted, but its conversation shortcut could not be removed. Refresh to check the link.`,
						)
				}
			}
			await props.onChanged?.()
		} catch (failure) {
			if (mounted.current) setError(messageOf(failure))
		} finally {
			operationPending.current = false
		}
	}
	return (
		<section className="workflow-page automation-page">
			<PageHeading
				title={t`Make room for what matters.`}
				description={
					source === undefined
						? t`Keep one-time reminders and recurring tasks together.`
						: t`Reminders and recurring work connected to ${source.title}.`
				}
			>
				{editor === null && can("triggers.createTrigger") && (
					<Button
						onClick={() => start()}
						disabled={!ready || disabled || defaultBotId === ""}
					>
						<Plus size={17} />
						{t`New automation`}
					</Button>
				)}
			</PageHeading>
			<WorkflowNotice workflow={workflow} />
			{error !== null && error !== workflow.error && (
				<p className="feature-error" role="alert">
					{error}
				</p>
			)}
			{feedback !== null && (
				<p className="automation-feedback" role="status">
					<Check size={16} />
					{feedback}
				</p>
			)}
			{editor !== null ? (
				<div className="automation-editor">
					<Button
						variant="ghost"
						disabled={disabled}
						onClick={() => {
							if (review) setReview(false)
							else setEditor(null)
						}}
					>
						<ArrowLeft size={16} />
						{review ? t`Back to editing` : t`Back to automations`}
					</Button>
					<div className="automation-step">
						<span>{review ? "02" : "01"}</span>
						<div>
							<h2>
								{review ? t`One last look.` : t`What should Kay take care of?`}
							</h2>
							<p>
								{review
									? t`Check the task and timing before saving.`
									: t`Describe the result you want. Choose when it should happen.`}
							</p>
						</div>
					</div>
					{review ? (
						<div className="automation-review">
							<p className="automation-prompt">{editor.prompt}</p>
							<dl>
								<div>
									<dt>{t`Schedule`}</dt>
									<dd>
										{cadenceLabel(editor)}
										{editor.cadence !== "custom" && editor.cadence !== "event"
											? ` · ${editor.time}`
											: ""}
									</dd>
								</div>
								<div>
									<dt>{t`Time zone`}</dt>
									<dd>{editor.timeZone}</dd>
								</div>
								{editor.chatId && (
									<div>
										<dt>{t`Source conversation`}</dt>
										<dd>
											{links.find((entry) => entry.chatId === editor.chatId)
												?.title ??
												source?.title ??
												t`Conversation`}
										</dd>
									</div>
								)}
								<div>
									<dt>{t`Status`}</dt>
									<dd>{editor.enabled ? t`Active` : t`Paused`}</dd>
								</div>
							</dl>
							<p className="automation-help">{t`Scheduled work appears in Tasks. Linking a conversation keeps it easy to find; it does not move the results into that conversation.`}</p>
							<Button
								disabled={disabled || workflow.unconfirmed !== null}
								onClick={() => void save()}
							>
								{disabled
									? t`Saving…`
									: preview
										? t`Save preview`
										: t`Save automation`}
							</Button>
						</div>
					) : (
						<form
							onSubmit={(event) => {
								event.preventDefault()
								try {
									scheduleFromDraft(editor)
									setError(null)
									setReview(true)
								} catch {
									setError(
										t`Check the time and enter a valid time zone, such as Asia/Shanghai.`,
									)
								}
							}}
						>
							<label className="automation-field">
								<span>{t`Task`}</span>
								<textarea
									required
									maxLength={20000}
									rows={4}
									placeholder={t`For example, prepare a short briefing before my workday starts…`}
									value={editor.prompt}
									onChange={(event) =>
										setEditor({ ...editor, prompt: event.target.value })
									}
								/>
							</label>
							<div className="automation-form-grid">
								<label className="automation-field">
									<span>{t`Repeat`}</span>
									<select
										value={editor.cadence}
										onChange={(event) => {
											const value = event.target.value
											if (
												value === "daily" ||
												value === "weekdays" ||
												value === "weekly" ||
												value === "custom" ||
												value === "event"
											)
												setEditor({ ...editor, cadence: value })
										}}
									>
										<option value="daily">{t`Every day`}</option>
										<option value="weekdays">{t`Weekdays`}</option>
										<option value="weekly">{t`Every week`}</option>
										{editor.original !== null &&
											scheduleDraft(editor.original, timeZone()).cadence ===
												"custom" && (
												<option value="custom">{t`Keep existing schedule`}</option>
											)}
										{editor.id !== null && editor.original === null && (
											<option value="event">{t`Keep event trigger`}</option>
										)}
									</select>
								</label>
							</div>
							{editor.cadence !== "custom" && editor.cadence !== "event" ? (
								<div className="automation-form-grid">
									{editor.cadence === "weekly" && (
										<label className="automation-field">
											<span>{t`Day`}</span>
											<select
												value={editor.day}
												onChange={(event) =>
													setEditor({ ...editor, day: event.target.value })
												}
											>
												{weekdays().map((day, index) => (
													<option key={day} value={index}>
														{day}
													</option>
												))}
											</select>
										</label>
									)}
									<label className="automation-field">
										<span>{t`Time`}</span>
										<input
											type="time"
											required
											value={editor.time}
											onChange={(event) =>
												setEditor({ ...editor, time: event.target.value })
											}
										/>
									</label>
									<label className="automation-field">
										<span>{t`Time zone`}</span>
										<input
											required
											list="automation-time-zones"
											value={editor.timeZone}
											onChange={(event) =>
												setEditor({ ...editor, timeZone: event.target.value })
											}
										/>
										<datalist id="automation-time-zones">
											{[
												...new Set([
													timeZone(),
													"Asia/Shanghai",
													"Asia/Singapore",
													"Asia/Tokyo",
													"Europe/London",
													"Europe/Berlin",
													"America/New_York",
													"America/Los_Angeles",
													"UTC",
												]),
											].map((zone) => (
												<option key={zone} value={zone} />
											))}
										</datalist>
									</label>
								</div>
							) : (
								<p className="automation-help">{t`The existing timing is preserved. Choose a repeat option above only if you want to replace it.`}</p>
							)}
							{props.onLinkAutomation !== undefined && (
								<label className="automation-field">
									<span>{t`Source conversation`}</span>
									<select
										value={editor.chatId}
										onChange={(event) =>
											setEditor({ ...editor, chatId: event.target.value })
										}
									>
										<option value="">{t`No linked conversation`}</option>
										{links.map((entry) => (
											<option key={entry.chatId} value={entry.chatId}>
												{entry.title}
											</option>
										))}
									</select>
									<small>{t`Keep this automation beside the conversation that inspired it.`}</small>
								</label>
							)}
							<div className="automation-editor-footer">
								<p>{t`You will review everything before saving.`}</p>
								<Button
									type="submit"
									disabled={
										editor.prompt.trim() === "" || editor.bot === "" || disabled
									}
								>
									{t`Review automation`}
									<ChevronRight size={16} />
								</Button>
							</div>
						</form>
					)}
				</div>
			) : (
				<>
					{!preview && (
						<RemindersSection
							key={JSON.stringify([
								props.bootstrap?.identity.organizationId,
								props.bootstrap?.identity.userId,
								props.conversationId,
							])}
							client={props.client}
							conversationId={props.conversationId}
							onOpenChat={props.onOpenChat}
						/>
					)}
					<h2>{t`Recurring automations`}</h2>
					<div className="workflow-toolbar automation-toolbar">
						<div className="workflow-tabs" aria-label={t`Automation status`}>
							{(
								[
									{ id: "all", label: t`All` },
									{ id: "active", label: t`Active` },
									{ id: "paused", label: t`Paused` },
								] as const
							).map((tab) => (
								<button
									key={tab.id}
									aria-pressed={filter === tab.id}
									onClick={() => setFilter(tab.id)}
								>
									{tab.label}
									<span>
										{tab.id === "all"
											? scoped.length
											: scoped.filter(
													(entry) => entry.enabled === (tab.id === "active"),
												).length}
									</span>
								</button>
							))}
						</div>
						<div className="automation-tools">
							<label className="workflow-search">
								<Search size={16} />
								<input
									aria-label={t`Search automations`}
									placeholder={t`Search automations`}
									value={search}
									onChange={(event) => setSearch(event.target.value)}
								/>
							</label>
							{!preview && (
								<Button
									variant="ghost"
									size="icon"
									disabled={!ready || disabled || loading}
									aria-label={t`Refresh automations`}
									onClick={() => void load()}
								>
									<RefreshCw size={17} />
								</Button>
							)}
						</div>
					</div>
					{loading || !ready ? (
						<div
							className="feature-skeleton"
							role="status"
						>{t`Loading automations…`}</div>
					) : !can("triggers.listTriggers") ? (
						<div className="workflow-empty">
							<CalendarClock size={28} />
							<h2>{t`Automations are not available for this account.`}</h2>
						</div>
					) : visible.length === 0 ? (
						<div className="workflow-empty">
							<CalendarClock size={28} />
							<h2>
								{search !== "" || filter !== "all"
									? t`No matching automations.`
									: t`A little less to remember.`}
							</h2>
							<p>
								{search !== "" || filter !== "all"
									? t`Try another search or show all automations.`
									: t`Choose a recurring task below, or describe one of your own.`}
							</p>
							{(search !== "" || filter !== "all") && (
								<Button
									variant="outline"
									onClick={() => {
										setSearch("")
										setFilter("all")
									}}
								>{t`Show all`}</Button>
							)}
						</div>
					) : (
						<div className="automation-list">
							{visible.map((automation) => (
								<article
									key={automation.id}
									className="automation-item"
									data-expanded={selected === automation.id || undefined}
								>
									<button
										className="automation-row"
										aria-expanded={selected === automation.id}
										onClick={() => select(automation)}
									>
										<span
											className="automation-mark"
											data-paused={!automation.enabled || undefined}
										>
											{automation.enabled ? (
												<CalendarClock size={21} />
											) : (
												<Pause size={21} />
											)}
										</span>
										<span className="automation-row-copy">
											<strong>{automation.prompt}</strong>
											<span>
												{scheduleLabel(automation)}
												{associated(automation.id) !== undefined && (
													<>
														<i />
														<Link2 size={12} />
														{associated(automation.id)?.title}
													</>
												)}
											</span>
										</span>
										<span className="automation-row-state">
											{automation.needsAuthorization === true
												? t`Confirmation needed`
												: automation.enabled
													? t`Active`
													: t`Paused`}
										</span>
										<ChevronRight size={17} />
									</button>
									{selected === automation.id && (
										<div className="automation-detail">
											<div className="automation-detail-main">
												<p className="automation-prompt">{automation.prompt}</p>
												<dl>
													<div>
														<dt>
															<Clock3 size={14} />
															{t`Next run`}
														</dt>
														<dd>
															{!automation.enabled
																? t`Paused`
																: automation.nextRunAt === null
																	? automation.webhook
																		? t`Waiting for an event`
																		: preview
																			? t`Not scheduled in preview`
																			: t`Not scheduled`
																	: dateLabel(automation.nextRunAt)}
														</dd>
													</div>
													<div>
														<dt>{t`Last triggered`}</dt>
														<dd>{dateLabel(automation.lastFiredAt)}</dd>
													</div>
													<div>
														<dt>{t`Time zone`}</dt>
														<dd>{automation.schedule?.timeZone ?? "UTC"}</dd>
													</div>
												</dl>
												<p className="automation-help">{t`Trigger times show when work was started. Check Tasks for its progress and results.`}</p>
												{automation.needsAuthorization === true && (
													<p className="automation-help">{t`Review this automation before allowing it to act for your account again. It stays paused until you confirm.`}</p>
												)}
												{automation.webhook && (
													<p className="automation-help">{t`This automation can also start when a connected service sends an event.`}</p>
												)}
												{props.onLinkAutomation !== undefined && (
													<div className="automation-link">
														<label className="automation-field">
															<span>{t`Source conversation`}</span>
															<select
																value={linkTarget}
																disabled={linking}
																onChange={(event) =>
																	setLinkTarget(event.target.value)
																}
															>
																<option value="">{t`No linked conversation`}</option>
																{links.map((entry) => (
																	<option
																		key={entry.chatId}
																		value={entry.chatId}
																	>
																		{entry.title}
																	</option>
																))}
															</select>
														</label>
														<Button
															variant="outline"
															disabled={
																disabled ||
																linkTarget ===
																	(associated(automation.id)?.chatId ?? "")
															}
															onClick={() =>
																void link(automation.id, linkTarget)
															}
														>
															<Link2 size={15} />
															{t`Save link`}
														</Button>
													</div>
												)}
												{associated(automation.id) !== undefined && (
													<Button
														variant="ghost"
														onClick={() =>
															props.onOpenChat(
																associated(automation.id)!.chatId,
															)
														}
													>
														<MessageSquare size={15} />
														{t`Open source conversation`}
													</Button>
												)}
											</div>
											<div className="automation-detail-actions">
												{can("triggers.updateTrigger") && (
													<>
														<Button
															variant="outline"
															disabled={
																disabled || workflow.unconfirmed !== null
															}
															onClick={() => void toggle(automation)}
														>
															{automation.enabled ? (
																<Pause size={15} />
															) : (
																<Play size={15} />
															)}
															{automation.needsAuthorization === true
																? t`Authorize and resume`
																: automation.enabled
																	? t`Pause`
																	: t`Resume`}
														</Button>
														<Button
															variant="ghost"
															disabled={disabled}
															onClick={() => edit(automation)}
														>
															<Pencil size={15} />
															{t`Edit automation`}
														</Button>
													</>
												)}
												{can("triggers.deleteTrigger") && (
													<Button
														variant="ghost"
														disabled={disabled}
														onClick={() => setDeleteId(automation.id)}
													>
														<Trash2 size={15} />
														{t`Delete`}
													</Button>
												)}
											</div>
											{deleteId === automation.id && (
												<div className="automation-delete" role="alert">
													<p>{t`Delete this automation? Future runs will stop. Existing tasks and results stay available.`}</p>
													<div>
														<Button
															variant="outline"
															disabled={disabled}
															onClick={() => setDeleteId(null)}
														>{t`Cancel`}</Button>
														<Button
															variant="destructive"
															disabled={
																disabled || workflow.unconfirmed !== null
															}
															onClick={() => void remove(automation)}
														>{t`Delete automation`}</Button>
													</div>
												</div>
											)}
										</div>
									)}
								</article>
							))}
						</div>
					)}
					{can("triggers.createTrigger") && search === "" && (
						<section className="automation-ideas">
							<div>
								<Sparkles size={17} />
								<h2>{t`Start with something useful.`}</h2>
							</div>
							<div className="automation-idea-grid">
								{[
									{
										title: t`A morning briefing`,
										text: t`Prepare a short morning briefing with my priorities and anything that needs a decision.`,
										cadence: "weekdays" as const,
									},
									{
										title: t`A weekly review`,
										text: t`Review this week's progress and suggest three priorities for the next week.`,
										cadence: "weekly" as const,
									},
									{
										title: t`Follow a topic`,
										text: t`Check the topics I am following and collect useful updates with their original sources.`,
										cadence: "daily" as const,
									},
								].map((idea) => (
									<button
										key={idea.title}
										disabled={disabled || defaultBotId === ""}
										onClick={() => start(idea.text, idea.cadence)}
									>
										<strong>{idea.title}</strong>
										<p>{idea.text}</p>
										<span>
											{t`Make it yours`}
											<ChevronRight size={14} />
										</span>
									</button>
								))}
							</div>
						</section>
					)}
				</>
			)}
		</section>
	)
}
