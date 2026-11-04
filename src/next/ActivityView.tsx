import type { ConversationActivity } from "@kaicom/kay-contracts"
import { t } from "@lingui/core/macro"
import { Match } from "effect"
import { useEffect, useId, useRef, useState } from "react"
import {
	Check,
	ChevronRight,
	Circle,
	CircleAlert,
	ListChecks,
	Monitor,
	Wrench,
} from "lucide-react"
import { activityNeedsObservation, activityPlan } from "./ActivityModel"
import {
	activityHistoryIssues,
	activityPresentation,
	type ActivityPresentation,
} from "./ActivityPresentation"
import { toolCategory, toolLabel } from "./ToolLabel"
import type { TranscriptToolRecord } from "./TranscriptActivity"
import "./ActivityView.css"

type Tool = ConversationActivity["tools"][number]

function toolStatus(status: Tool["status"]) {
	return Match.value(status).pipe(
		Match.when("queued", () => t`Queued`),
		Match.when("running", () => t`In progress`),
		Match.when("waiting", () => t`Waiting`),
		Match.when("cancelling", () => t`Stopping…`),
		Match.when("completed", () => t`Completed`),
		Match.when("failed", () => t`Failed`),
		Match.when("cancelled", () => t`Cancelled`),
		Match.when("interrupted", () => t`Interrupted`),
		Match.when("outcome_unknown", () => t`Result not yet confirmed`),
		Match.exhaustive,
	)
}

export function ActivityView({
	activity,
	island = null,
	history = activity,
	stale = false,
	approvals = 0,
	devices,
	onApprovals,
	onFiles,
	historyPending = false,
	records = [],
}: {
	readonly history?: ConversationActivity
	readonly activity: ConversationActivity
	readonly island?: ActivityPresentation | null
	readonly stale?: boolean
	readonly approvals?: number
	readonly devices: ReadonlyMap<string, string>
	readonly onApprovals: () => void
	readonly onFiles: () => void
	readonly historyPending?: boolean
	readonly records?: ReadonlyArray<TranscriptToolRecord>
}) {
	const current = island ?? activityPresentation(activity, stale)
	const docked = island !== null
	const disclosure = useRef<HTMLDetailsElement>(null)
	const summaryId = useId()
	const [expanded, setExpanded] = useState(false)
	useEffect(() => {
		if (!docked || !expanded) return
		const dismiss = (event: MouseEvent) => {
			const element = disclosure.current
			const target = event.target
			if (
				element === null ||
				!(target instanceof Element) ||
				element.closest(".next-composer-wrap")?.contains(target) === true ||
				target.closest(".next-chat") === null ||
				window.getSelection()?.isCollapsed === false
			)
				return
			element.open = false
		}
		document.addEventListener("click", dismiss)
		return () => document.removeEventListener("click", dismiss)
	}, [expanded, docked])
	const active = activityNeedsObservation(activity)
	const { items: steps, progress } = activityPlan(activity)
	const tool = current.tool ?? current.operation
	const computer =
		current.tool != null &&
		(current.tool.computerId !== null ||
			current.tool.name.startsWith("openbot_computer_"))
	const device =
		current.tool?.computerId == null
			? undefined
			: devices.get(current.tool.computerId)
	const heading = Match.value(current.status).pipe(
		Match.when("stale", () => t`Reconnecting to activity…`),
		Match.when("running", () =>
			computer
				? t`Using a computer`
				: tool?.appName !== undefined && tool.appName !== ""
					? t`Using ${tool.appName}`
					: tool != null
						? t`Calling a tool`
						: t`Background work is running`,
		),
		Match.when("waiting", () =>
			island !== null && tool == null && approvals === 0
				? t`Waiting`
				: t`Waiting for input or approval`,
		),
		Match.when("queued", () => t`Waiting to run`),
		Match.when("cancelling", () => t`Stopping…`),
		Match.when("outcome_unknown", () => t`Checking the operation result`),
		Match.when("working", () => t`Working…`),
		Match.when("completed", () => t`Execution history`),
		Match.when("idle", () => t`Execution history`),
		Match.when("failed", () => t`Execution failed`),
		Match.when("interrupted", () => t`Execution stopped`),
		Match.exhaustive,
	)
	const latest = activity.updates.at(-1)?.text
	const task =
		tool == null
			? activity.delegations.findLast(
					(entry) => entry.executionStatus === current.status,
				)?.task
			: undefined
	const { currentFailed, earlierFailed, unconfirmed } = activityHistoryIssues({
		activity,
		history,
	})
	const issues = (
		<>
			{!active && current.status === "failed" && (
				<span className="conversation-activity-warning">{t`Execution failed`}</span>
			)}
			{currentFailed > 0 && (
				<span className="conversation-activity-warning">{t`${currentFailed} failed attempts in this turn`}</span>
			)}
			{earlierFailed > 0 && (
				<span>{t`${earlierFailed} failed attempts in earlier turns`}</span>
			)}
			{unconfirmed > 0 && (
				<span className="conversation-activity-warning">{t`${unconfirmed} unconfirmed`}</span>
			)}
		</>
	)
	const actions = (
		<>
			{approvals > 0 && (
				<button
					type="button"
					className="conversation-activity-link"
					onClick={onApprovals}
				>
					{t`Review approvals`} · {approvals}
				</button>
			)}
			{historyPending && (
				<button
					type="button"
					className="conversation-activity-link"
					onClick={onApprovals}
				>
					{t`Earlier background work is still pending.`} {t`View all tasks`}
				</button>
			)}
		</>
	)
	return (
		<section
			className={
				island === null
					? "conversation-activity"
					: "conversation-activity conversation-activity-island"
			}
			aria-label={t`Activity`}
			data-status={current.status}
		>
			{island === null && (active || stale) && (
				<div className="conversation-activity-current">
					{computer ? (
						<Monitor size={18} aria-hidden="true" />
					) : (
						<Wrench size={17} aria-hidden="true" />
					)}
					<div>
						<span
							className="conversation-activity-heading"
							data-busy={current.busy}
							role="status"
						>
							{heading}
						</span>
						{tool != null && (
							<p className="conversation-activity-detail">
								{device !== undefined && <span>{device}</span>}
								<span>{toolCategory(tool.name, tool)}</span>
								<strong>{toolLabel(tool.name, tool)}</strong>
							</p>
						)}
						{tool == null && latest !== undefined && (
							<p className="conversation-activity-update">{latest}</p>
						)}
					</div>
				</div>
			)}
			<details
				ref={disclosure}
				className="conversation-activity-history"
				onToggle={(event) => setExpanded(event.currentTarget.open)}
				onKeyDown={(event) => {
					if (
						island === null ||
						event.key !== "Escape" ||
						!event.currentTarget.open ||
						event.nativeEvent.isComposing
					)
						return
					event.preventDefault()
					event.currentTarget.open = false
					event.currentTarget
						.querySelector("summary")
						?.focus({ preventScroll: true })
				}}
			>
				{island !== null ? (
					<summary
						className="conversation-island-toggle"
						aria-labelledby={summaryId}
						aria-describedby={
							progress === null ? undefined : `${summaryId}-steps`
						}
						onPointerDown={(event) => {
							if (
								event.button === 0 &&
								document.activeElement?.closest(".next-composer") != null
							)
								event.preventDefault()
						}}
					>
						{computer ? (
							<Monitor size={18} aria-hidden="true" />
						) : task !== undefined ? (
							<ListChecks size={18} aria-hidden="true" />
						) : (
							<Wrench size={17} aria-hidden="true" />
						)}
						<span
							id={summaryId}
							className="conversation-island-copy"
							role="status"
							aria-atomic="true"
						>
							<span
								className="conversation-activity-heading"
								data-busy={current.busy}
							>
								{heading}
							</span>
							{(tool != null || task !== undefined) && (
								<span className="conversation-island-action">
									{device !== undefined && <span>{device} · </span>}
									{tool != null ? toolLabel(tool.name, tool) : task}
								</span>
							)}
						</span>
						{progress !== null && (
							<span
								id={`${summaryId}-steps`}
								className="conversation-island-count"
								aria-label={t`${progress.completed} of ${progress.total} steps`}
							>
								{progress.completed}/{progress.total}
							</span>
						)}
						<ChevronRight
							size={15}
							className="conversation-activity-chevron"
							aria-hidden="true"
						/>
					</summary>
				) : (
					<summary>
						<ChevronRight
							size={15}
							className="conversation-activity-chevron"
							aria-hidden="true"
						/>
						<span>{t`Execution history`}</span>
						{progress !== null && (
							<span>{t`${progress.completed} of ${progress.total} steps`}</span>
						)}
						{issues}
					</summary>
				)}
				<div className="conversation-activity-history-body">
					{island !== null && (
						<div className="conversation-island-history-heading">
							<strong>{t`Execution history`}</strong>
							{issues}
						</div>
					)}
					{currentFailed + earlierFailed > 0 && (
						<p className="conversation-activity-note">{t`Failed calls stay in history even when a later retry succeeds.`}</p>
					)}
					{!active && current.status === "interrupted" && (
						<p>{t`Execution stopped`}</p>
					)}
					{progress !== null && (
						<div className="conversation-activity-plan">
							<div className="conversation-activity-plan-header">
								<strong>{t`Execution plan`}</strong>
								<span>
									{progress.completed}/{progress.total}
								</span>
							</div>
							<progress
								value={progress.completed}
								max={progress.total}
								aria-label={t`Plan progress`}
							/>
							<ol>
								{steps.map((step) => (
									<li key={step.id} data-status={step.status}>
										{step.status === "done" ? (
											<Check size={15} aria-label={t`Completed`} />
										) : (
											<Circle
												size={13}
												aria-label={
													step.status === "in_progress"
														? t`In progress`
														: t`Pending`
												}
											/>
										)}
										<span>{step.content}</span>
									</li>
								))}
							</ol>
						</div>
					)}
					{history.tools.length > 0 && (
						<ol className="conversation-activity-tools">
							{history.tools.map((entry) => (
								<li key={entry.id}>
									<details>
										<summary>
											{entry.status === "completed" ? (
												<Check size={15} />
											) : entry.status === "failed" ? (
												<CircleAlert size={15} />
											) : (
												<Circle size={13} />
											)}
											<span className="conversation-activity-tool-name">
												<span>{toolCategory(entry.name, entry)}</span>
												{toolLabel(entry.name, entry)}
											</span>
											<small data-status={entry.status}>
												{toolStatus(entry.status)}
											</small>
											<ChevronRight
												size={13}
												className="conversation-activity-chevron"
												aria-hidden="true"
											/>
										</summary>
										<div className="conversation-activity-record">
											<code>{entry.name}</code>
											{entry.status === "failed" && (
												<p>
													{entry.turnId === activity.turnId
														? t`Failed call in this turn`
														: t`Failed call in an earlier turn`}
												</p>
											)}
											{entry.status === "failed" &&
												!records.some(
													(record) => record.toolId === entry.id,
												) && (
													<p>{t`Error details could not be matched to this call. The original record stays in the conversation.`}</p>
												)}
											{entry.computerId !== null &&
												devices.has(entry.computerId) && (
													<p>{devices.get(entry.computerId)}</p>
												)}
											{records
												.filter((record) => record.toolId === entry.id)
												.flatMap((record) =>
													record.parts.map((part) => (
														<pre key={part.id}>
															{JSON.stringify(part.value, null, 2)}
														</pre>
													)),
												)}
										</div>
									</details>
								</li>
							))}
						</ol>
					)}
					{history.updates.length > 0 && (
						<details className="conversation-activity-notes">
							<summary>{t`Activity updates`}</summary>
							{history.updates.map((update) => (
								<p key={update.id}>{update.text}</p>
							))}
						</details>
					)}
					{history.delegations.length > 0 && (
						<div className="conversation-activity-section">
							<strong>{t`Delegated tasks`}</strong>
							{history.delegations.map((delegation) => (
								<div key={delegation.id}>
									<p>
										{delegation.task} · {toolStatus(delegation.executionStatus)}
									</p>
									{delegation.result !== null && <p>{delegation.result}</p>}
								</div>
							))}
						</div>
					)}
					{history.appOperations.length > 0 && (
						<details className="conversation-activity-notes">
							<summary>{t`App operations`}</summary>
							{history.appOperations.map((operation) => (
								<p key={operation.id}>
									{toolCategory(operation.name, operation)} ·{" "}
									{toolLabel(operation.name, operation)} ·{" "}
									{toolStatus(operation.status)}
								</p>
							))}
						</details>
					)}
					{!history.history.complete && (
						<p className="conversation-activity-note">{t`Showing recent activity. Earlier records remain in the conversation.`}</p>
					)}
					{history.tools.some((entry) => entry.fileIds.length > 0) && (
						<button
							type="button"
							className="conversation-activity-link"
							onClick={onFiles}
						>{t`Saved files`}</button>
					)}
					{island !== null && actions}
				</div>
			</details>
			{island === null && actions}
		</section>
	)
}
