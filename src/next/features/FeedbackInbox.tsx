import { t } from "@lingui/core/macro"
import { useEffect, useState } from "react"
import { ArrowLeft, Check, Inbox, RefreshCw, SearchCheck } from "lucide-react"
import { Match } from "effect"
import type * as Product from "@kaicom/kay-contracts"
import type { Client } from "@kaicom/kay-contracts/Client"
import { Button } from "../../components/ui/button"
import "./FeedbackInbox.css"

const statusLabel = (status: typeof Product.FeedbackStatus.Type) =>
	Match.value(status).pipe(
		Match.when("open", () => t`New`),
		Match.when("triaged", () => t`Investigating`),
		Match.when("resolved", () => t`Resolved`),
		Match.exhaustive,
	)
const severityLabel = (severity: Product.FeedbackInput["severity"]) =>
	Match.value(severity).pipe(
		Match.when("minor", () => t`Minor issue`),
		Match.when("major", () => t`Needs attention`),
		Match.when("blocking", () => t`Task blocked`),
		Match.exhaustive,
	)
export function FeedbackInbox({
	client,
	identity,
}: {
	readonly client: Client
	readonly identity: typeof Product.Identity.Type
}) {
	const [filter, setFilter] =
		useState<typeof Product.FeedbackStatus.Type>("open")
	const [page, setPage] = useState<Product.FeedbackPage | null>(null)
	const [selected, setSelected] = useState<Product.FeedbackReport | null>(null)
	const [busy, setBusy] = useState(false)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [refresh, setRefresh] = useState(0)
	useEffect(() => {
		const abort = new AbortController()
		setPage(null)
		setSelected(null)
		setLoading(true)
		setError(null)
		void client
			.feedbackReports({ status: filter, signal: abort.signal })
			.then((value) => {
				if (!abort.signal.aborted) setPage(value)
			})
			.catch(() => {
				if (!abort.signal.aborted)
					setError(t`Reports could not be loaded. Try refreshing.`)
			})
			.finally(() => {
				if (!abort.signal.aborted) setLoading(false)
			})
		return () => abort.abort()
	}, [client, filter, refresh, identity.userId, identity.organizationId])
	const update = async (status: typeof Product.FeedbackStatus.Type) => {
		if (selected === null || busy) return
		setBusy(true)
		setError(null)
		try {
			const saved = await client.updateFeedback(selected.id, {
				expected: selected.revision,
				status,
			})
			setSelected(saved)
			setPage((current) =>
				current === null
					? null
					: {
							...current,
							items: current.items.filter((item) => item.id !== saved.id),
						},
			)
		} catch {
			// A status write is observed once; read the report instead of repeating it.
			try {
				const current = await client.feedbackReport(selected.id)
				setSelected(current)
				setPage((page) =>
					page === null
						? null
						: {
								...page,
								items: page.items.filter(
									(item) => item.id !== current.id || current.status === filter,
								),
							},
				)
				if (current.status !== status)
					setError(
						t`The report changed. Review its current status before continuing.`,
					)
			} catch {
				setError(
					t`The change could not be confirmed. Refresh to read its status.`,
				)
			}
		} finally {
			setBusy(false)
		}
	}
	const more = async () => {
		if (page?.next == null || busy) return
		setBusy(true)
		try {
			const next = await client.feedbackReports({
				status: filter,
				before: page.next,
			})
			setPage({ items: [...page.items, ...next.items], next: next.next })
		} catch {
			setError(t`More reports could not be loaded.`)
		} finally {
			setBusy(false)
		}
	}
	return (
		<div className="kay-feedback">
			<div className="kay-feedback-toolbar">
				<div>
					<p>{t`Issues reported by Kay, ready for your team to investigate.`}</p>
					<span>{t`Reports contain concise descriptions. Conversations and raw logs are not uploaded.`}</span>
				</div>
				<Button
					variant="ghost"
					onClick={() => setRefresh((value) => value + 1)}
					disabled={busy}
				>
					<RefreshCw size={16} />
					{t`Refresh`}
				</Button>
			</div>
			<nav className="kay-feedback-filters" aria-label={t`Report status`}>
				{(["open", "triaged", "resolved"] as const).map((status) => (
					<button
						key={status}
						disabled={busy}
						aria-pressed={filter === status}
						onClick={() => setFilter(status)}
					>
						{statusLabel(status)}
					</button>
				))}
			</nav>
			{error !== null && (
				<p className="kay-feedback-error" role="alert">
					{error}
				</p>
			)}
			<div className="kay-feedback-layout" data-detail={selected !== null}>
				<div className="kay-feedback-list" aria-label={t`Platform reports`}>
					{loading ? (
						<div
							className="kay-feedback-empty"
							role="status"
						>{t`Loading reports…`}</div>
					) : page?.items.length === 0 ? (
						<div className="kay-feedback-empty">
							<Inbox size={32} />
							<strong>{t`No reports here`}</strong>
							<span>{t`New platform reports will appear here when Kay encounters a problem.`}</span>
						</div>
					) : (
						page?.items.map((report) => (
							<button
								key={report.id}
								className="kay-feedback-row"
								disabled={busy}
								aria-pressed={selected?.id === report.id}
								onClick={() => setSelected(report)}
							>
								<div>
									<span className="kay-feedback-severity">
										{severityLabel(report.content.severity)}
									</span>
									<time>{new Date(report.createdAt).toLocaleDateString()}</time>
								</div>
								<strong>{report.content.title}</strong>
								<p>{report.content.summary}</p>
							</button>
						))
					)}
					{page?.next != null && (
						<Button
							variant="ghost"
							disabled={busy}
							onClick={() => void more()}
						>{t`Load more`}</Button>
					)}
				</div>
				{selected === null ? (
					<div className="kay-feedback-detail kay-feedback-prompt">
						<SearchCheck size={32} />
						<p>{t`Choose a report to review what happened.`}</p>
					</div>
				) : (
					<article className="kay-feedback-detail">
						<Button
							variant="ghost"
							className="kay-feedback-back"
							disabled={busy}
							onClick={() => setSelected(null)}
						>
							<ArrowLeft size={16} />
							{t`All reports`}
						</Button>
						<div className="kay-feedback-detail-meta">
							<span>{severityLabel(selected.content.severity)}</span>
							<span>{statusLabel(selected.status)}</span>
						</div>
						<h3>{selected.content.title}</h3>
						<p>{selected.content.summary}</p>
						<section>
							<h4>{t`What happened`}</h4>
							<p>{selected.content.actual}</p>
						</section>
						<section>
							<h4>{t`Expected behavior`}</h4>
							<p>{selected.content.expected}</p>
						</section>
						{selected.content.steps !== undefined &&
							selected.content.steps.length > 0 && (
								<section>
									<h4>{t`Steps to reproduce`}</h4>
									<ol>
										{selected.content.steps.map((step, index) => (
											<li key={index}>{step}</li>
										))}
									</ol>
								</section>
							)}
						<section className="kay-feedback-context">
							<h4>{t`Report details`}</h4>
							<dl>
								<dt>{t`Received`}</dt>
								<dd>{new Date(selected.createdAt).toLocaleString()}</dd>
								<dt>{t`Account`}</dt>
								<dd>{selected.accountId}</dd>
								<dt>{t`Organization`}</dt>
								<dd>{selected.organizationId}</dd>
								<dt>{t`Conversation`}</dt>
								<dd>{t`Not identified by the reporting connection`}</dd>
								{selected.content.errorId !== undefined && (
									<>
										<dt>{t`Error reference`}</dt>
										<dd>{selected.content.errorId}</dd>
									</>
								)}
								<dt>{t`Report ID`}</dt>
								<dd>{selected.id}</dd>
							</dl>
						</section>
						<div className="kay-feedback-actions">
							{selected.status === "open" && (
								<Button
									variant="outline"
									disabled={busy}
									onClick={() => void update("triaged")}
								>
									<SearchCheck size={16} />
									{t`Start investigating`}
								</Button>
							)}
							{selected.status !== "resolved" && (
								<Button disabled={busy} onClick={() => void update("resolved")}>
									<Check size={16} />
									{t`Mark resolved`}
								</Button>
							)}
							{selected.status === "resolved" && (
								<Button
									variant="outline"
									disabled={busy}
									onClick={() => void update("open")}
								>{t`Reopen report`}</Button>
							)}
						</div>
					</article>
				)}
			</div>
		</div>
	)
}
