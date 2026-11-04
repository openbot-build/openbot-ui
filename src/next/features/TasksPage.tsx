import { t } from "@lingui/core/macro"
import { Match, Schema } from "effect"
import { useCallback, useEffect, useRef, useState } from "react"
import {
	ArrowLeft,
	ArrowUpRight,
	Check,
	CheckCheck,
	ChevronRight,
	Circle,
	CircleAlert,
	Clock3,
	MessageSquare,
	Plus,
	RefreshCw,
	Search,
	ShieldCheck,
	X,
} from "lucide-react"
import { Button } from "../../components/ui/button"
import { PageHeading } from "../Shell"
import { objectOf } from "./SchemaValues"
import { ValueView } from "./ResultView"
import { rowsOf } from "./FeatureData"
import {
	useWorkspaceWorkflow,
	WorkflowNotice,
	type WorkflowProps,
} from "./Workflow"
import {
	approvalInput,
	readTaskChats,
	readTaskRequests,
	readTaskTodos,
	readTaskToolCalls,
	readTaskToolResult,
	taskLane,
	taskOperationState,
	TaskRequest,
	textOf,
	type TaskChat,
	type TaskTodo,
	type TaskToolCall,
} from "./TasksData"
import "./TasksPage.css"

type Filter = "all" | "attention" | "working" | "finished"
type Selection =
	| { readonly type: "request"; readonly id: string }
	| { readonly type: "task"; readonly id: string }
	| null
interface TaskDetails {
	readonly todos: ReadonlyArray<TaskTodo>
	readonly delegations: ReadonlyArray<unknown>
	readonly toolCalls: ReadonlyArray<TaskToolCall>
	readonly appOperations: ReadonlyArray<unknown>
}

const emptyDetails: TaskDetails = {
	todos: [],
	delegations: [],
	toolCalls: [],
	appOperations: [],
}
const statusLabel = (status: string) =>
	Match.value(status).pipe(
		Match.when(
			(value) => value === "Running" || value === "running",
			() => t`In progress`,
		),
		Match.when(
			(value) => value === "Completed" || value === "completed",
			() => t`Completed`,
		),
		Match.when(
			(value) => value === "Failed" || value === "failed",
			() => t`Needs attention`,
		),
		Match.when(
			(value) => value === "Interrupted" || value === "interrupted",
			() => t`Interrupted`,
		),
		Match.when(
			(value) =>
				value === "paused" || value === "InputRequired" || value === "waiting",
			() => t`Waiting for you`,
		),
		Match.when(
			(value) => value === "PendingApproval" || value === "authorizing",
			() => t`Awaiting approval`,
		),
		Match.when("Sending", () => t`Sending`),
		Match.when(
			(value) => value === "OutcomeUnknown" || value === "outcome_unknown",
			() => t`Result not confirmed`,
		),
		Match.when(
			(value) =>
				value === "Cancelled" || value === "cancelled" || value === "Rejected",
			() => t`Stopped`,
		),
		Match.orElse(() => t`Waiting`),
	)

const previewRequests = (): ReadonlyArray<TaskRequest> => [
	{
		id: "preview-review",
		bot: "kay",
		chat: "launch",
		revision: 1,
		status: "pending",
		createdAt: 0,
		expiresAt: 0,
		reason: t`The launch outline is ready. May I save a copy to the team's project folder?`,
		capability: {
			action: "apps.call",
			target: t`Project documents`,
			arguments: { filename: t`Launch outline.md`, folder: t`Product launch` },
		},
		app: {
			source: {
				appName: t`Project documents`,
				connectionName: t`Team workspace`,
			},
			readOnly: false,
		},
	},
]
const previewTasks = (): ReadonlyArray<TaskChat> => [
	{
		chat: {
			id: "welcome",
			bot: "kay",
			title: t`Bring the week into focus`,
			parent: null,
			createdAt: 0,
		},
		status: "Running",
		activity: "active",
	},
	{
		chat: {
			id: "idea",
			bot: "build",
			title: t`Shape the first version`,
			parent: null,
			createdAt: 0,
		},
		status: "Completed",
		activity: "inactive",
	},
	{
		chat: {
			id: "weekend",
			bot: "kay",
			title: t`Find a quieter weekend`,
			parent: null,
			createdAt: 0,
		},
		status: "Completed",
		activity: "inactive",
	},
]
const previewDetails = (completed: boolean): TaskDetails => ({
	todos: [
		{ id: "gather", content: t`Gather the useful context`, status: "done" },
		{
			id: "connect",
			content: t`Connect the ideas and check the sources`,
			status: completed ? "done" : "in_progress",
		},
		{
			id: "prepare",
			content: t`Prepare a result you can use`,
			status: completed ? "done" : "pending",
		},
	],
	delegations: completed
		? [
				{
					id: "preview-result",
					status: "completed",
					task: t`A useful starting point`,
					result: t`The outline and next steps are ready in the original conversation.`,
				},
			]
		: [],
	toolCalls: [],
	appOperations: [],
})

export function TasksPage({
	client,
	bootstrap,
	onOpenChat,
	onStartConversation,
}: WorkflowProps) {
	const workflow = useWorkspaceWorkflow({ client, bootstrap })
	const [requests, setRequests] = useState<ReadonlyArray<TaskRequest>>([])
	const [tasks, setTasks] = useState<ReadonlyArray<TaskChat>>([])
	const [previewDecisions, setPreviewDecisions] = useState<
		ReadonlyArray<string>
	>([])
	const [filter, setFilter] = useState<Filter>("all")
	const [query, setQuery] = useState("")
	const [selection, setSelection] = useState<Selection>(null)
	const [details, setDetails] = useState<TaskDetails>(emptyDetails)
	const [reading, setReading] = useState(false)
	const [detailLoading, setDetailLoading] = useState(false)
	const [notice, setNotice] = useState<string | null>(null)
	const [localError, setLocalError] = useState<string | null>(null)
	const [deciding, setDeciding] = useState(false)
	const decisionController = useRef<AbortController | null>(null)
	useEffect(() => () => decisionController.current?.abort(), [])
	const { ready, preview, can, read } = workflow
	const currentRequests = preview
		? previewRequests().filter(
				(request) => !previewDecisions.includes(request.id),
			)
		: requests
	const currentTasks = preview ? previewTasks() : tasks
	const selectedRequest = Match.value(selection).pipe(
		Match.when({ type: "request" }, ({ id }) =>
			currentRequests.find((request) => request.id === id),
		),
		Match.orElse(() => undefined),
	)
	const selectedTask = Match.value(selection).pipe(
		Match.when({ type: "task" }, ({ id }) =>
			currentTasks.find((task) => task.chat.id === id),
		),
		Match.orElse(() => undefined),
	)
	const taskId = selectedTask?.chat.id
	const selectedDetails = preview
		? previewDetails(selectedTask?.status === "Completed")
		: details
	const attentionCount =
		currentRequests.length +
		currentTasks.filter((task) => taskLane(task.status) === "attention").length
	const workingCount = currentTasks.filter(
		(task) => taskLane(task.status) === "working",
	).length
	const finishedCount = currentTasks.filter(
		(task) => taskLane(task.status) === "finished",
	).length
	const load = useCallback(
		async (signal?: AbortSignal) => {
			if (!ready || preview) return
			setReading(true)
			setLocalError(null)
			try {
				const [nextRequests, nextTasks] = await Promise.all([
					can("requests.listRequests")
						? read(
								"requests.listRequests",
								{ query: { status: "pending" } },
								signal,
							).then(readTaskRequests)
						: Promise.resolve([]),
					can("chats.listChats")
						? read("chats.listChats", { query: { kind: "task" } }, signal).then(
								readTaskChats,
							)
						: Promise.resolve([]),
				])
				if (signal?.aborted !== true) {
					setRequests(nextRequests)
					setTasks(nextTasks)
				}
			} catch (failure) {
				if (signal?.aborted !== true)
					setLocalError(
						failure instanceof Error
							? failure.message
							: t`Tasks could not be loaded.`,
					)
			} finally {
				if (signal?.aborted !== true) setReading(false)
			}
		},
		[ready, preview, can, read],
	)
	useEffect(() => {
		const controller = new AbortController()
		void load(controller.signal)
		return () => controller.abort()
	}, [load])
	useEffect(() => {
		if (preview || taskId === undefined) return
		const controller = new AbortController()
		setDetailLoading(true)
		setDetails(emptyDetails)
		setLocalError(null)
		const input = { params: { chatId: taskId } }
		void Promise.all([
			can("chats.chatTodos")
				? read("chats.chatTodos", input, controller.signal).then(
						(value) => readTaskTodos(value).items,
					)
				: Promise.resolve([]),
			can("chats.chatDelegations")
				? read("chats.chatDelegations", input, controller.signal).then(rowsOf)
				: Promise.resolve([]),
			can("toolCalls.list")
				? read("toolCalls.list", input, controller.signal).then(
						readTaskToolCalls,
					)
				: Promise.resolve([]),
			can("appOperations.list")
				? read("appOperations.list", input, controller.signal).then(rowsOf)
				: Promise.resolve([]),
		])
			.then(([todos, delegations, toolCalls, appOperations]) => {
				if (!controller.signal.aborted)
					setDetails({ todos, delegations, toolCalls, appOperations })
			})
			.catch((failure) => {
				if (!controller.signal.aborted)
					setLocalError(
						failure instanceof Error
							? failure.message
							: t`Task details could not be loaded.`,
					)
			})
			.finally(() => {
				if (!controller.signal.aborted) setDetailLoading(false)
			})
		return () => controller.abort()
	}, [taskId, preview, can, read])
	const decide = async (request: TaskRequest, decision: "allow" | "deny") => {
		if (decisionController.current !== null) return
		setNotice(null)
		setLocalError(null)
		if (preview) {
			setPreviewDecisions((previous) => [...previous, request.id])
			setSelection(null)
			setNotice(t`Preview decision saved. No external action was taken.`)
			return
		}
		const controller = new AbortController()
		decisionController.current = controller
		setDeciding(true)
		try {
			const latest = Schema.decodeUnknownSync(TaskRequest)(
				await read(
					"requests.getRequest",
					{ params: { requestId: request.id } },
					controller.signal,
				),
			)
			if (controller.signal.aborted) return
			const input = approvalInput({ shown: request, current: latest, decision })
			if (input === undefined) {
				await load(controller.signal)
				if (controller.signal.aborted) return
				setNotice(
					t`This request changed. Review its current details before deciding.`,
				)
				return
			}
			await workflow.call("requests.resolveRequest", input)
			if (controller.signal.aborted) return
			setSelection(null)
			setNotice(
				decision === "allow"
					? t`Approved once. Kay can continue this action.`
					: t`Declined. Kay will receive your decision.`,
			)
			await load(controller.signal)
		} catch (failure) {
			if (!controller.signal.aborted)
				setLocalError(
					failure instanceof Error
						? failure.message
						: t`Your decision could not be confirmed.`,
				)
		} finally {
			decisionController.current = null
			if (!controller.signal.aborted) setDeciding(false)
		}
	}
	const searching = query.trim().toLocaleLowerCase()
	const shownRequests = currentRequests.filter(
		(request) =>
			(filter === "all" || filter === "attention") &&
			`${request.reason} ${request.capability.target}`
				.toLocaleLowerCase()
				.includes(searching),
	)
	const shownTasks = currentTasks.filter(
		(task) =>
			(filter === "all" || filter === taskLane(task.status)) &&
			(task.chat.title ?? "").toLocaleLowerCase().includes(searching),
	)
	const hasSelection =
		selectedRequest !== undefined || selectedTask !== undefined
	return (
		<section
			className="workflow-page tasks-page"
			data-detail={hasSelection || undefined}
		>
			<PageHeading
				title={t`Tasks`}
				description={t`See what needs you, follow the progress, and pick up the result.`}
			>
				<Button onClick={() => onStartConversation()}>
					<Plus size={17} />
					{t`New task`}
				</Button>
			</PageHeading>
			<WorkflowNotice workflow={workflow} />
			{localError !== null && localError !== workflow.error && (
				<p className="feature-error" role="alert">
					{localError}
				</p>
			)}
			{notice !== null && (
				<p className="tasks-notice" role="status">
					{notice}
				</p>
			)}
			{currentRequests.length > 0 && (
				<div className="tasks-attention">
					<span className="tasks-attention-icon">
						<ShieldCheck size={22} />
					</span>
					<div>
						<strong>{t`A decision before the next step`}</strong>
						<p>{t`Kay is waiting for your approval. Review the action before it goes ahead.`}</p>
					</div>
					<Button
						variant="outline"
						onClick={() => {
							const request = currentRequests[0]
							if (request !== undefined) {
								setFilter("attention")
								setSelection({ type: "request", id: request.id })
							}
						}}
					>
						{t`Review`}
						<ArrowUpRight size={16} />
					</Button>
				</div>
			)}
			<div className="workflow-toolbar tasks-toolbar">
				<nav className="workflow-tabs" aria-label={t`Task status`}>
					{(
						[
							{
								id: "all",
								label: t`All work`,
								count: currentRequests.length + currentTasks.length,
							},
							{ id: "attention", label: t`Needs you`, count: attentionCount },
							{ id: "working", label: t`In progress`, count: workingCount },
							{ id: "finished", label: t`Finished`, count: finishedCount },
						] satisfies ReadonlyArray<{
							id: Filter
							label: string
							count: number
						}>
					).map((entry) => (
						<button
							key={entry.id}
							aria-current={filter === entry.id ? "page" : undefined}
							onClick={() => {
								setFilter(entry.id)
								setSelection(null)
							}}
						>
							{entry.label}
							<span>{entry.count}</span>
						</button>
					))}
				</nav>
				<div className="tasks-search-tools">
					<label className="workflow-search">
						<Search size={17} />
						<input
							aria-label={t`Find a task`}
							placeholder={t`Find a task`}
							value={query}
							onChange={(event) => setQuery(event.target.value)}
						/>
					</label>
					{!preview && (
						<Button
							variant="ghost"
							size="icon"
							aria-label={t`Refresh tasks`}
							disabled={reading || workflow.busy}
							onClick={() => void load()}
						>
							<RefreshCw size={17} />
						</Button>
					)}
				</div>
			</div>
			<div
				className="workflow-split tasks-split"
				data-detail={hasSelection || undefined}
			>
				<div className="tasks-list">
					{reading && (
						<p
							className="tasks-loading"
							role="status"
						>{t`Updating your tasks…`}</p>
					)}
					{shownRequests.length > 0 && (
						<section aria-label={t`Waiting for your decision`}>
							<h2 className="tasks-section-title">{t`Waiting for your decision`}</h2>
							<div className="workflow-list">
								{shownRequests.map((request) => (
									<button
										key={request.id}
										className="tasks-row"
										data-selected={
											selectedRequest?.id === request.id || undefined
										}
										onClick={() => {
											setSelection({ type: "request", id: request.id })
											setNotice(null)
										}}
									>
										<span className="tasks-row-icon" data-tone="attention">
											<CircleAlert size={19} />
										</span>
										<span className="tasks-row-copy">
											<strong>
												{request.reason || request.capability.target}
											</strong>
											<small>{t`Approval needed`}</small>
										</span>
										<ChevronRight size={17} />
									</button>
								))}
							</div>
						</section>
					)}
					{shownTasks.length > 0 && (
						<section aria-label={t`Your tasks`}>
							<h2 className="tasks-section-title">{t`Your tasks`}</h2>
							<div className="workflow-list">
								{shownTasks.map((task) => (
									<button
										key={task.chat.id}
										className="tasks-row"
										data-selected={
											selectedTask?.chat.id === task.chat.id || undefined
										}
										onClick={() => {
											setSelection({ type: "task", id: task.chat.id })
											setNotice(null)
										}}
									>
										<span
											className="tasks-row-icon"
											data-tone={taskLane(task.status)}
										>
											{task.status === "Completed" ? (
												<CheckCheck size={19} />
											) : taskLane(task.status) === "attention" ? (
												<CircleAlert size={19} />
											) : (
												<Clock3 size={19} />
											)}
										</span>
										<span className="tasks-row-copy">
											<strong>{task.chat.title || t`Untitled task`}</strong>
											<small>{statusLabel(task.status)}</small>
										</span>
										<ChevronRight size={17} />
									</button>
								))}
							</div>
						</section>
					)}
					{!reading &&
						!workflow.loading &&
						shownRequests.length + shownTasks.length === 0 && (
							<div className="workflow-empty">
								<CheckCheck size={28} />
								<h2>
									{searching !== ""
										? t`No matching tasks`
										: filter === "attention"
											? t`Nothing needs your attention`
											: t`Make room for your next idea`}
								</h2>
								<p>
									{searching !== ""
										? t`Try another word or view all work.`
										: t`Start with what you want to achieve. Kay will keep the work and its results together.`}
								</p>
								{searching === "" && (
									<Button
										variant="outline"
										onClick={() => onStartConversation()}
									>
										{t`Start a conversation`}
										<ArrowUpRight size={16} />
									</Button>
								)}
							</div>
						)}
				</div>
				{hasSelection && (
					<section
						className="workflow-detail tasks-detail"
						aria-label={t`Task details`}
					>
						<div className="tasks-detail-top">
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setSelection(null)}
							>
								<ArrowLeft size={16} />
								{t`Back to tasks`}
							</Button>
						</div>
						{selectedRequest !== undefined && (
							<>
								<span className="workflow-kicker">{t`Your decision`}</span>
								<h2>
									{selectedRequest.reason || selectedRequest.capability.target}
								</h2>
								<p className="tasks-detail-description">{t`Only this action will be approved. Future actions may ask again.`}</p>
								<dl className="tasks-context">
									<div>
										<dt>{t`Action`}</dt>
										<dd>{selectedRequest.capability.target}</dd>
									</div>
									{textOf(
										objectOf(objectOf(selectedRequest.app)["source"])[
											"appName"
										],
									) !== "" && (
										<div>
											<dt>{t`App`}</dt>
											<dd>
												{textOf(
													objectOf(objectOf(selectedRequest.app)["source"])[
														"appName"
													],
												)}
											</dd>
										</div>
									)}
								</dl>
								{selectedRequest.capability.arguments !== undefined && (
									<div className="tasks-action-content">
										<h3>{t`What will be sent`}</h3>
										<ValueView value={selectedRequest.capability.arguments} />
									</div>
								)}
								{objectOf(selectedRequest.app)["arguments"] !== undefined && (
									<div className="tasks-action-content">
										<h3>{t`App action details`}</h3>
										<ValueView
											value={objectOf(selectedRequest.app)["arguments"]}
										/>
									</div>
								)}
								{typeof objectOf(selectedRequest.code)["code"] === "string" && (
									<div className="tasks-action-content">
										<h3>{t`Code to run`}</h3>
										<pre>{textOf(objectOf(selectedRequest.code)["code"])}</pre>
									</div>
								)}
								{can("requests.resolveRequest") &&
									can("requests.getRequest") && (
										<div className="workflow-actions tasks-decisions">
											<Button
												disabled={
													deciding ||
													workflow.busy ||
													workflow.unconfirmed !== null
												}
												onClick={() => void decide(selectedRequest, "allow")}
											>
												<Check size={16} />
												{preview ? t`Preview approval` : t`Allow once`}
											</Button>
											<Button
												variant="outline"
												disabled={
													deciding ||
													workflow.busy ||
													workflow.unconfirmed !== null
												}
												onClick={() => void decide(selectedRequest, "deny")}
											>
												<X size={16} />
												{t`Decline`}
											</Button>
										</div>
									)}
								<Button
									variant="ghost"
									onClick={() => onOpenChat(selectedRequest.chat)}
								>
									<MessageSquare size={16} />
									{t`Open conversation`}
									<ArrowUpRight size={15} />
								</Button>
							</>
						)}
						{selectedTask !== undefined && (
							<>
								<span className="workflow-kicker">
									{statusLabel(selectedTask.status)}
								</span>
								<h2>{selectedTask.chat.title || t`Untitled task`}</h2>
								<p className="tasks-detail-description">{t`The work stays connected to the conversation where it began.`}</p>
								{detailLoading && <p role="status">{t`Loading progress…`}</p>}
								{selectedDetails.todos.length > 0 && (
									<section>
										<h3>{t`The next steps`}</h3>
										<ol className="tasks-steps">
											{selectedDetails.todos.map((todo) => (
												<li key={todo.id} data-state={todo.status}>
													{todo.status === "done" ? (
														<Check size={16} />
													) : (
														<Circle size={14} />
													)}
													<span>{todo.content}</span>
													{todo.status === "in_progress" && (
														<small>{t`Now`}</small>
													)}
												</li>
											))}
										</ol>
									</section>
								)}
								{selectedDetails.delegations.length > 0 && (
									<section>
										<h3>{t`Related work`}</h3>
										{selectedDetails.delegations.map((value, index) => {
											const item = objectOf(value)
											return (
												<article
													className="tasks-delegated"
													key={textOf(item["id"]) || index}
												>
													<strong>{textOf(item["task"])}</strong>
													<small>{statusLabel(textOf(item["status"]))}</small>
													{textOf(item["result"]) !== "" && (
														<p>{textOf(item["result"])}</p>
													)}
												</article>
											)
										})}
									</section>
								)}
								{selectedDetails.toolCalls.length +
									selectedDetails.appOperations.length >
									0 && (
									<section>
										<h3>{t`Recent activity`}</h3>
										<ul className="tasks-activity">
											{selectedDetails.toolCalls.map((call) => (
												<ToolCallActivity
													key={call.id}
													call={call}
													chatId={selectedTask.chat.id}
													read={read}
													canRead={can("toolCalls.get")}
												/>
											))}
											{selectedDetails.appOperations.map((value, index) => {
												const item = objectOf(value)
												return (
													<li key={textOf(item["id"]) || index}>
														<span>
															{textOf(item["toolName"]) ||
																textOf(item["tool"]) ||
																textOf(objectOf(item["source"])["appName"]) ||
																t`App action`}
														</span>
														<small>
															{statusLabel(taskOperationState(value))}
														</small>
													</li>
												)
											})}
										</ul>
									</section>
								)}
								{!detailLoading &&
									selectedDetails.todos.length +
										selectedDetails.delegations.length +
										selectedDetails.toolCalls.length +
										selectedDetails.appOperations.length ===
										0 && (
										<p className="tasks-detail-description">{t`The conversation contains the latest progress and any completed results.`}</p>
									)}
								<div className="workflow-actions">
									<Button onClick={() => onOpenChat(selectedTask.chat.id)}>
										<MessageSquare size={16} />
										{selectedTask.status === "Completed"
											? t`Read the result`
											: t`Continue in conversation`}
										<ArrowUpRight size={15} />
									</Button>
									{selectedTask.chat.parent !== null && (
										<Button
											variant="ghost"
											onClick={() => onOpenChat(selectedTask.chat.parent!.chat)}
										>{t`Original conversation`}</Button>
									)}
								</div>
							</>
						)}
					</section>
				)}
			</div>
		</section>
	)
}

function ToolCallActivity({
	call,
	chatId,
	read,
	canRead,
}: {
	readonly call: TaskToolCall
	readonly chatId: string
	readonly read: ReturnType<typeof useWorkspaceWorkflow>["read"]
	readonly canRead: boolean
}) {
	const [open, setOpen] = useState(false)
	const [result, setResult] = useState<ReturnType<
		typeof readTaskToolResult
	> | null>(null)
	const [error, setError] = useState<string | null>(null)
	useEffect(() => {
		setResult(null)
		setError(null)
		if (!open || !canRead) return
		const controller = new AbortController()
		void read(
			"toolCalls.get",
			{ params: { chatId, id: call.id } },
			controller.signal,
		)
			.then((value) => {
				const next = readTaskToolResult({ value, expected: call })
				if (!controller.signal.aborted) setResult(next)
			})
			.catch((failure) => {
				if (!controller.signal.aborted)
					setError(
						failure instanceof Error
							? failure.message
							: t`Task details could not be loaded.`,
					)
			})
		return () => controller.abort()
	}, [open, canRead, chatId, call, read])
	return (
		<li className="tasks-tool-call">
			{canRead ? (
				<details onToggle={(event) => setOpen(event.currentTarget.open)}>
					<summary>
						<span>{call.tool}</span>
						<small>{statusLabel(result?.status ?? call.status)}</small>
					</summary>
					{open && (
						<div className="tasks-tool-result">
							{error !== null ? (
								<p role="alert">{error}</p>
							) : result === null ? (
								<p role="status">{t`Loading…`}</p>
							) : (
								<ValueView value={result.output} />
							)}
						</div>
					)}
				</details>
			) : (
				<>
					<span>{call.tool}</span>
					<small>{statusLabel(call.status)}</small>
				</>
			)}
		</li>
	)
}
