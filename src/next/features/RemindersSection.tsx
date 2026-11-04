import { t } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { useEffect, useState, useSyncExternalStore } from "react"
import { Bell, ChevronRight, MessageSquare, RefreshCw, X } from "lucide-react"
import { Button } from "../../components/ui/button"
import type { WorkflowProps } from "./Workflow"
import { makeRemindersState } from "./RemindersState"

/** One-time reminders use the saved core schedule, separately from recurring triggers. */
export function RemindersSection({
	client,
	conversationId,
	onOpenChat,
}: Pick<WorkflowProps, "client" | "onOpenChat"> & {
	readonly conversationId?: string | undefined
}) {
	const { i18n } = useLingui()
	const [model] = useState(makeRemindersState)
	const { items, next, loading, error, selected, confirm, pending } =
		useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot)
	const load = model.load
	useEffect(() => {
		model.activate({ client, conversationId })
		void model.load()
		const refresh = () => {
			if (document.visibilityState === "visible") {
				if (model.getSnapshot().pending === null) void model.load()
				else void model.check()
			}
		}
		window.addEventListener("online", refresh)
		return () => {
			model.close()
			window.removeEventListener("online", refresh)
		}
	}, [client, conversationId, model])
	useEffect(() => {
		if (pending === null) return
		const timer = window.setInterval(() => {
			if (document.visibilityState === "visible") void model.check()
		}, 2500)
		return () => window.clearInterval(timer)
	}, [pending, client, conversationId, model])
	const dateLabel = (dueAt: number) =>
		new Intl.DateTimeFormat(i18n.locale, {
			dateStyle: "medium",
			timeStyle: "short",
		}).format(dueAt)
	return (
		<section aria-label={t`Reminders`}>
			<div className="workflow-toolbar automation-toolbar">
				<div>
					<h2>{t`Reminders`}</h2>
					<p className="automation-help">{t`One-time reminders you asked Kay to send. They return to the conversation where you set them.`}</p>
				</div>
				<Button
					variant="ghost"
					size="icon"
					disabled={loading}
					aria-label={t`Refresh reminders`}
					onClick={() => void (pending === null ? load() : model.check())}
				>
					<RefreshCw size={17} />
				</Button>
			</div>
			{error !== null && (
				<p role="alert" className="feature-error">
					{error === "cancel"
						? t`This reminder could not be cancelled. Please refresh its status.`
						: t`Your reminders could not be loaded. Please refresh to try again.`}
				</p>
			)}
			{pending !== null && (
				<p
					role="status"
					className="automation-help"
				>{t`Checking cancellation. The request will not be sent again.`}</p>
			)}
			{loading && items.length === 0 ? (
				<p role="status">{t`Loading reminders…`}</p>
			) : items.length === 0 ? (
				<p className="automation-help">{t`No reminders here yet. Ask Kay to remind you in a conversation.`}</p>
			) : (
				<div className="automation-list">
					{items.map((reminder) => (
						<article
							key={reminder.id}
							className="automation-item"
							data-expanded={selected === reminder.id || undefined}
						>
							<button
								className="automation-row"
								aria-expanded={selected === reminder.id}
								onClick={() => {
									model.select(selected === reminder.id ? null : reminder.id)
								}}
							>
								<span
									className="automation-mark"
									data-paused={reminder.status !== "waiting" || undefined}
								>
									<Bell size={21} />
								</span>
								<span className="automation-row-copy">
									<strong>{reminder.note}</strong>
									<span>{dateLabel(reminder.dueAt)}</span>
								</span>
								<span className="automation-row-state">
									{reminder.status === "waiting"
										? t`Scheduled`
										: reminder.status === "done"
											? t`Triggered`
											: t`Cancelled`}
								</span>
								<ChevronRight size={17} />
							</button>
							{selected === reminder.id && (
								<div className="automation-detail">
									<div className="automation-detail-main">
										<p className="automation-prompt">{reminder.note}</p>
										<p>{dateLabel(reminder.dueAt)}</p>
										{reminder.status === "done" && (
											<p className="automation-help">{t`This reminder has fired. Open its conversation to see the follow-up.`}</p>
										)}
										<Button
											variant="ghost"
											onClick={() => onOpenChat(reminder.chatId)}
										>
											<MessageSquare size={15} />
											{t`Open source conversation`}
										</Button>
									</div>
									{reminder.status === "waiting" &&
										reminder.executionId !== null && (
											<div className="automation-detail-actions">
												<Button
													variant="outline"
													disabled={pending !== null}
													onClick={() => model.confirm(reminder.id)}
												>
													<X size={15} />
													{t`Cancel reminder`}
												</Button>
											</div>
										)}
									{confirm === reminder.id && (
										<div className="automation-delete" role="alert">
											<p>{t`Cancel this reminder? Kay will not send it later.`}</p>
											<div>
												<Button
													variant="outline"
													onClick={() => model.confirm(null)}
												>{t`Keep reminder`}</Button>
												<Button
													variant="destructive"
													disabled={pending !== null}
													onClick={() => void model.cancel(reminder.id)}
												>{t`Cancel reminder`}</Button>
											</div>
										</div>
									)}
								</div>
							)}
						</article>
					))}
				</div>
			)}
			{next !== null && (
				<Button
					variant="ghost"
					disabled={loading}
					onClick={() => void load(next)}
				>
					{loading ? t`Loading…` : t`Load more reminders`}
				</Button>
			)}
		</section>
	)
}
