import { t } from "@lingui/core/macro"
import { Match, Schema } from "effect"
import { useEffect, useRef, useState } from "react"
import {
	ArrowLeft,
	ArrowUpRight,
	Check,
	ChevronRight,
	Cloud,
	FolderOpen,
	Laptop,
	MessageSquare,
	Monitor,
	Pause,
	Play,
	Plus,
	RefreshCw,
	ShieldCheck,
	TerminalSquare,
	X,
} from "lucide-react"
import { Button } from "../../components/ui/button"
import { PageHeading } from "../Shell"
import { Computer } from "./Computer"
import { ComputerFiles } from "./ComputerFiles"
import { BasicComputeCard, useBasicCompute } from "./BasicCompute"
import { canOpenBasicCompute } from "./BasicComputeState"
import {
	ComputerAccess,
	ComputerPairing,
	ComputerProviders,
	WorkspaceComputer,
	WorkspaceComputers,
	canUseComputer,
} from "./ComputersData"
import {
	useWorkspaceWorkflow,
	WorkflowNotice,
	type WorkflowProps,
} from "./Workflow"
import "./ComputersPage.css"

type View = "files" | "terminal" | "desktop"
type Add = "cloud" | "device" | null
export const computerStateLabel = (state: WorkspaceComputer["state"]) =>
	Match.value(state).pipe(
		Match.when("running", () => t`Ready`),
		Match.when("starting", () => t`Starting`),
		Match.when("paused", () => t`Paused`),
		Match.when("offline", () => t`Offline`),
		Match.when("failed", () => t`Unavailable`),
		Match.exhaustive,
	)

export function ComputersPage(
	props: WorkflowProps & {
		readonly onNavigateFeature: (id: string) => void
		readonly initialComputerId?: string | undefined
		readonly initialComputerManaged?: boolean | undefined
		readonly onBackToDevices?: (() => void) | undefined
	},
) {
	const { client, bootstrap, onStartConversation, onNavigateFeature } = props
	const workflow = useWorkspaceWorkflow(props)
	const basic = useBasicCompute({ client, bootstrap })
	const [computers, setComputers] = useState<ReadonlyArray<WorkspaceComputer>>(
		[],
	)
	const [providers, setProviders] = useState<typeof ComputerProviders.Type>([])
	const [loaded, setLoaded] = useState(false)
	const [loading, setLoading] = useState(false)
	const [selectedId, setSelectedId] = useState<string | null>(
		props.initialComputerId ?? null,
	)
	const [view, setView] = useState<View>("files")
	const [adding, setAdding] = useState<Add>(null)
	const [name, setName] = useState("")
	const [provider, setProvider] = useState("")
	const [pairingCode, setPairingCode] = useState("")
	const [pairing, setPairing] = useState<ComputerPairing | null>(null)
	const [accessByComputer, setAccessByComputer] = useState<
		Readonly<Record<string, boolean>>
	>({})
	const access =
		selectedId === null ? null : (accessByComputer[selectedId] ?? null)
	const [notice, setNotice] = useState<string | null>(null)
	const [readError, setReadError] = useState<string | null>(null)
	const mounted = useRef(true),
		generation = useRef(0),
		pairingGeneration = useRef(0),
		pairingAbort = useRef<AbortController | null>(null)
	const selected = computers.find((computer) => computer.id === selectedId)
	const selectedBasic =
		selected !== undefined &&
		(selected.id === basic.value?.computerId ||
			(selected.id === props.initialComputerId &&
				props.initialComputerManaged === true))
	const otherComputers = computers.filter(
		(computer) => computer.id !== basic.value?.computerId,
	)
	const administrator = bootstrap?.access?.adminConsole === true
	const blocked = workflow.busy || workflow.unconfirmed !== null
	const available =
		selected !== undefined &&
		canUseComputer(selected) &&
		(!selectedBasic || canOpenBasicCompute(basic.value))
	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
			generation.current++
			pairingAbort.current?.abort()
		}
	}, [])
	const refresh = async (signal?: AbortSignal) => {
		if (workflow.preview || !workflow.can("computers.listComputers")) {
			setLoaded(true)
			return
		}
		const version = ++generation.current
		setLoading(true)
		setReadError(null)
		try {
			const result = Schema.decodeUnknownSync(WorkspaceComputers)(
				await workflow.read("computers.listComputers", {}, signal),
			)
			if (
				Boolean(signal?.aborted) ||
				!mounted.current ||
				generation.current !== version
			)
				return
			setComputers(result)
			setLoaded(true)
			if (workflow.can("computerProviders.listComputerProviders")) {
				const choices = Schema.decodeUnknownSync(ComputerProviders)(
					await workflow.read(
						"computerProviders.listComputerProviders",
						{},
						signal,
					),
				)
				if (
					Boolean(signal?.aborted) ||
					!mounted.current ||
					generation.current !== version
				)
					return
				setProviders(choices)
				setProvider((current) =>
					choices.some((choice) => choice.id === current)
						? current
						: (choices[0]?.id ?? ""),
				)
			}
		} catch {
			if (
				signal?.aborted !== true &&
				mounted.current &&
				generation.current === version
			) {
				setReadError(t`Your computers could not be loaded. Try again.`)
				setLoaded(true)
			}
		} finally {
			if (
				signal?.aborted !== true &&
				mounted.current &&
				generation.current === version
			)
				setLoading(false)
		}
	}
	useEffect(() => {
		if (!workflow.ready) return
		const controller = new AbortController()
		void refresh(controller.signal)
		return () => controller.abort()
	}, [workflow.ready, workflow.can, workflow.preview])
	useEffect(() => {
		if (
			selected === undefined ||
			bootstrap?.defaultBotId == null ||
			!workflow.can("computers.listComputerBots")
		)
			return
		const controller = new AbortController()
		void workflow
			.read(
				"computers.listComputerBots",
				{ params: { computerId: selected.id } },
				controller.signal,
			)
			.then((value) => {
				const grants = Schema.decodeUnknownSync(ComputerAccess)(value)
				if (!controller.signal.aborted)
					setAccessByComputer((current) => ({
						...current,
						[selected.id]: grants.some(
							(grant) => grant.bot === bootstrap.defaultBotId,
						),
					}))
			})
			.catch(() => {
				/* The existing error area explains a failed permission check. */
			})
		return () => controller.abort()
	}, [selected?.id, bootstrap?.defaultBotId, workflow.can, workflow.read])
	const select = (computer: WorkspaceComputer) => {
		setSelectedId(computer.id)
		setView("files")
		setNotice(null)
	}
	const openBasic = async (id: string) => {
		try {
			const result = Schema.decodeUnknownSync(WorkspaceComputers)(
				await workflow.read("computers.listComputers", {}),
			)
			if (!mounted.current) return
			setComputers(result)
			const computer = result.find((item) => item.id === id)
			if (computer !== undefined) select(computer)
			else
				setReadError(
					t`Your workspace is still connecting. Please refresh its status in a moment.`,
				)
		} catch {
			if (mounted.current)
				setReadError(
					t`Your workspace could not be opened. Please refresh its status and try again.`,
				)
		}
	}
	const create = async () => {
		if (provider === "" || name.trim() === "" || blocked) return
		try {
			const value = Schema.decodeUnknownSync(WorkspaceComputer)(
				await workflow.call("computers.createComputer", {
					payload: {
						name: name.trim(),
						source: { _tag: "Provider", provider, template: null },
						pauseAfter: 900,
					},
				}),
			)
			if (!mounted.current) return
			setAdding(null)
			setComputers((current) => [...current, value])
			select(value)
			setNotice(t`Computer created.`)
			await refresh()
		} catch {
			/* The saved command result is shown by the workflow. */
		}
	}
	const checkPairing = async () => {
		setPairing(null)
		pairingAbort.current?.abort()
		const request = new AbortController()
		pairingAbort.current = request
		const version = ++pairingGeneration.current
		try {
			const next = Schema.decodeUnknownSync(ComputerPairing)(
				await workflow.read(
					"computers.getComputerPairing",
					{
						params: { code: pairingCode.trim() },
					},
					request.signal,
				),
			)
			if (
				mounted.current &&
				!request.signal.aborted &&
				pairingGeneration.current === version
			) {
				setPairing(next)
				setName(next.hostname)
			}
		} catch {
			/* Keep the code editable after an expired or invalid request. */
		}
	}
	const pair = async () => {
		if (pairing === null || blocked) return
		try {
			const value = Schema.decodeUnknownSync(WorkspaceComputer)(
				await workflow.call("computers.approveComputerPairing", {
					params: { code: pairing.code },
					payload: {
						name: name.trim() === "" ? pairing.hostname : name.trim(),
					},
				}),
			)
			if (!mounted.current) return
			setAdding(null)
			setPairing(null)
			setComputers((current) => [
				...current.filter((item) => item.id !== value.id),
				value,
			])
			select(value)
			setNotice(t`Device connected. Keep the connector running on your device.`)
			await refresh()
		} catch {
			/* Pairing is not retried automatically. */
		}
	}
	const lifecycle = async (action: "pause" | "resume") => {
		if (selected === undefined) return
		try {
			await workflow.call(
				action === "pause"
					? "computers.pauseComputer"
					: "computers.resumeComputer",
				{ params: { computerId: selected.id }, payload: {} },
			)
			await refresh()
		} catch {
			/* Keep the computer visible so its state can be checked. */
		}
	}
	const grant = async (allowed = true) => {
		if (selected === undefined || bootstrap?.defaultBotId == null) return
		try {
			await workflow.call(
				allowed ? "computers.grantComputer" : "computers.revokeComputer",
				{
					params: { computerId: selected.id, botId: bootstrap.defaultBotId },
				},
			)
			if (mounted.current)
				setAccessByComputer((current) => ({
					...current,
					[selected.id]: allowed,
				}))
		} catch {
			/* Never show a grant before the service accepts it. */
		}
	}
	const add = (kind: Add) => {
		pairingGeneration.current++
		pairingAbort.current?.abort()
		setAdding(kind)
		setPairing(null)
		setPairingCode("")
		setName(kind === "cloud" ? t`My workspace` : "")
		setNotice(null)
	}
	if (props.initialComputerId !== undefined && selected === undefined)
		return (
			<section className="next-computers workflow-page">
				<Button variant="ghost" onClick={props.onBackToDevices}>
					<ArrowLeft size={16} />
					{t`All devices`}
				</Button>
				<WorkflowNotice workflow={workflow} />
				<p role={readError === null ? "status" : "alert"}>
					{readError ??
						(loaded
							? t`This computer is no longer available. Refresh the device list.`
							: t`Loading your computer…`)}
				</p>
			</section>
		)
	return (
		<section className="next-computers workflow-page">
			{selected === undefined ? (
				<>
					<PageHeading
						title={t`Computers`}
						description={t`A workspace where Kay can work with files, run code, and prepare results for you.`}
					/>
					<div className="computer-page-actions">
						<Button
							onClick={() => add("cloud")}
							disabled={!workflow.ready || workflow.preview}
						>
							<Plus size={16} />
							{t`New cloud computer`}
						</Button>
						<Button
							variant="outline"
							onClick={() => add("device")}
							disabled={
								!workflow.ready ||
								workflow.preview ||
								!workflow.can("computers.getComputerPairing")
							}
						>
							<Laptop size={16} />
							{t`Connect my device`}
						</Button>
						<Button
							variant="ghost"
							size="icon"
							aria-label={t`Refresh computers`}
							disabled={loading || workflow.loading}
							onClick={() => void refresh()}
						>
							<RefreshCw size={17} />
						</Button>
					</div>
				</>
			) : (
				<>
					<Button
						className="computer-back"
						variant="ghost"
						onClick={() => {
							if (props.onBackToDevices !== undefined) {
								props.onBackToDevices()
								return
							}
							setSelectedId(null)
							setAdding(null)
						}}
					>
						<ArrowLeft size={16} />
						{props.onBackToDevices === undefined
							? t`All computers`
							: t`All devices`}
					</Button>
					<div className="computer-workspace-heading">
						<div>
							<span className="computer-eyebrow">
								{selectedBasic
									? t`Basic task space`
									: selected.source._tag === "Connector"
										? t`Your device`
										: t`Cloud workspace`}
							</span>
							<h1>{selectedBasic ? t`Basic task space` : selected.name}</h1>
							{!selectedBasic && (
								<span className="computer-state" data-state={selected.state}>
									{computerStateLabel(selected.state)}
								</span>
							)}
						</div>
						<div className="computer-page-actions">
							<Button
								variant="ghost"
								size="icon"
								aria-label={t`Refresh computer`}
								disabled={loading}
								onClick={() => void refresh()}
							>
								<RefreshCw size={17} />
							</Button>
							{selected.features.pause && (
								<Button
									variant="outline"
									disabled={
										blocked ||
										selected.state === "starting" ||
										selected.state === "failed"
									}
									onClick={() =>
										void lifecycle(
											selected.state === "paused" ? "resume" : "pause",
										)
									}
								>
									{selected.state === "paused" ? (
										<Play size={16} />
									) : (
										<Pause size={16} />
									)}
									{selected.state === "paused"
										? t`Resume computer`
										: t`Pause computer`}
								</Button>
							)}
						</div>
					</div>
				</>
			)}
			<WorkflowNotice workflow={workflow} />
			{(selected === undefined || selectedBasic) && (
				<BasicComputeCard
					state={basic}
					selected={selectedBasic}
					onOpen={(id) => void openBasic(id)}
					onMembership={() => onNavigateFeature("membership")}
				/>
			)}
			{readError !== null && (
				<p className="workflow-notice" role="alert">
					{readError}
				</p>
			)}
			{notice !== null && (
				<p className="computer-notice" role="status">
					<Check size={16} />
					{notice}
				</p>
			)}
			{adding !== null && (
				<section
					className="computer-add-panel"
					aria-label={
						adding === "cloud" ? t`New cloud computer` : t`Connect my device`
					}
				>
					<div className="computer-panel-heading">
						<h2>
							{adding === "cloud"
								? t`A space for your next task`
								: t`Connect a device you own`}
						</h2>
						<Button
							variant="ghost"
							size="icon"
							aria-label={t`Close`}
							onClick={() => add(null)}
							disabled={blocked}
						>
							<X size={17} />
						</Button>
					</div>
					{adding === "cloud" ? (
						providers.length === 0 ? (
							<>
								<p>
									{workflow.can("computerProviders.listComputerProviders")
										? t`Cloud computers are not available in this workspace yet. Your administrator needs to connect a computer service first.`
										: t`Your administrator provides cloud computers for this workspace. Choose an available computer, or ask your administrator to add one.`}
								</p>
								{administrator && (
									<Button
										variant="outline"
										onClick={() => onNavigateFeature("admin:computers")}
									>
										{t`Set up computer resources`}
										<ArrowUpRight size={16} />
									</Button>
								)}
							</>
						) : (
							<form
								onSubmit={(event) => {
									event.preventDefault()
									void create()
								}}
							>
								<p>{t`Give it a name. Your files stay with this computer, and it pauses after 15 minutes without activity.`}</p>
								<label className="feature-field">
									<span>{t`Computer name`}</span>
									<input
										value={name}
										maxLength={120}
										required
										onChange={(event) => setName(event.target.value)}
									/>
								</label>
								{providers.length > 1 && (
									<label className="feature-field">
										<span>{t`Available service`}</span>
										<select
											value={provider}
											onChange={(event) => setProvider(event.target.value)}
										>
											{providers.map((choice) => (
												<option key={choice.id} value={choice.id}>
													{choice.name}
												</option>
											))}
										</select>
									</label>
								)}
								<Button
									type="submit"
									disabled={
										blocked ||
										name.trim() === "" ||
										!workflow.can("computers.createComputer")
									}
								>
									{workflow.busy
										? t`Preparing your computer…`
										: t`Create computer`}
								</Button>
							</form>
						)
					) : (
						<>
							<p>{t`Start the OpenBot computer connector on your device, then enter the pairing code it shows. You will review the device before connecting it.`}</p>
							<form
								onSubmit={(event) => {
									event.preventDefault()
									void checkPairing()
								}}
							>
								<label className="feature-field">
									<span>{t`Pairing code`}</span>
									<input
										value={pairingCode}
										maxLength={32}
										autoComplete="off"
										onChange={(event) => {
											setPairingCode(event.target.value)
											pairingGeneration.current++
											pairingAbort.current?.abort()
											setPairing(null)
										}}
										placeholder={t`Code shown on your device`}
										required
									/>
								</label>
								<Button
									type="submit"
									variant="outline"
									disabled={pairingCode.trim() === "" || blocked}
								>{t`Find my device`}</Button>
							</form>
							{pairing !== null && (
								<div className="computer-pairing-review">
									<Laptop size={28} />
									<h3>{pairing.hostname}</h3>
									<p>
										{pairing.os} · {pairing.arch}
									</p>
									<p>{t`Only connect a device you recognize. Kay will be able to use it after you give access in its workspace.`}</p>
									<Button
										disabled={blocked || pairing.expiresAt <= Date.now()}
										onClick={() => void pair()}
									>{t`Connect this device`}</Button>
								</div>
							)}
						</>
					)}
				</section>
			)}
			{selected === undefined ? (
				loading || !loaded ? (
					<div
						className="computer-loading"
						role="status"
					>{t`Loading your computers…`}</div>
				) : readError !== null &&
				  otherComputers.length === 0 ? null : otherComputers.length === 0 ? (
					<div className="computer-empty">
						<div className="computer-empty-icon">
							<Monitor size={32} />
						</div>
						<h2>{t`Make room for your next task`}</h2>
						<p>{t`When a computer is connected, Kay can use it to organize files, process data, and create things for you. Your available computers will appear here.`}</p>
						<div className="computer-use-cases">
							<span>
								<FolderOpen size={18} />
								{t`Work with files`}
							</span>
							<span>
								<TerminalSquare size={18} />
								{t`Run calculations and code`}
							</span>
							<span>
								<ShieldCheck size={18} />
								{t`Choose what Kay can access`}
							</span>
						</div>
						{workflow.preview && (
							<p className="computer-panel-description">{t`This preview is not connected to a computer.`}</p>
						)}
					</div>
				) : (
					<div className="computer-grid">
						{otherComputers.map((computer) => (
							<button
								className="computer-card"
								key={computer.id}
								onClick={() => select(computer)}
							>
								<div className="computer-card-top">
									<span className="computer-card-icon">
										{computer.source._tag === "Connector" ? (
											<Laptop size={25} />
										) : (
											<Cloud size={25} />
										)}
									</span>
									<span className="computer-state" data-state={computer.state}>
										{computerStateLabel(computer.state)}
									</span>
								</div>
								<h2>{computer.name}</h2>
								<p>
									{computer.source._tag === "Connector"
										? t`Your connected device`
										: t`Files and work in the cloud`}
								</p>
								<span className="computer-card-open">
									{t`Open workspace`}
									<ChevronRight size={17} />
								</span>
							</button>
						))}
					</div>
				)
			) : (
				<>
					<div className="computer-kay-task">
						<div>
							<h2>{t`Let Kay take it from here`}</h2>
							<p>
								{access === true || selectedBasic
									? t`Describe what you need. Kay can use this computer and bring the result back to your conversation.`
									: t`Give Kay access when you want help with work on this computer.`}
							</p>
						</div>
						{access === true || selectedBasic ? (
							<div className="computer-page-actions">
								<Button
									disabled={!available}
									onClick={() =>
										onStartConversation(
											t`Help me with a task on my computer “${selected.name}”.`,
										)
									}
								>
									<MessageSquare size={16} />
									{t`Start a task`}
								</Button>
								{!selectedBasic && (
									<Button
										variant="ghost"
										disabled={
											blocked || !workflow.can("computers.revokeComputer")
										}
										onClick={() => void grant(false)}
									>{t`Remove Kay access`}</Button>
								)}
							</div>
						) : (
							<Button
								variant="outline"
								disabled={
									access === null ||
									blocked ||
									!workflow.can("computers.grantComputer")
								}
								onClick={() => void grant()}
							>
								<ShieldCheck size={16} />
								{t`Allow Kay to use this computer`}
							</Button>
						)}
					</div>
					{!available && selectedBasic ? null : !available ? (
						<div className="computer-empty computer-unavailable">
							<Monitor size={32} />
							<h2>
								{selected.state === "offline"
									? t`This device is offline`
									: selected.state === "starting"
										? t`Your computer is starting`
										: selected.state === "paused"
											? t`This computer is paused`
											: t`This computer is unavailable`}
							</h2>
							<p>
								{selected.state === "offline"
									? t`Open the connector on your device and keep it running. Refresh here when it has connected.`
									: selected.state === "starting"
										? t`Your files and tools will be available when it is ready.`
										: selected.state === "paused"
											? t`Resume it when you are ready to continue. Opening this page does not start it.`
											: t`Refresh to check its state. Your other computers and conversations are still available.`}
							</p>
						</div>
					) : (
						<>
							<nav
								className="computer-workspace-tabs"
								aria-label={t`Computer workspace`}
							>
								<button
									aria-current={view === "files" ? "page" : undefined}
									onClick={() => setView("files")}
								>
									<FolderOpen size={17} />
									{t`Files`}
								</button>
								<button
									aria-current={view === "terminal" ? "page" : undefined}
									onClick={() => setView("terminal")}
								>
									<TerminalSquare size={17} />
									{t`Terminal`}
								</button>
								{selected.features.desktop && (
									<button
										aria-current={view === "desktop" ? "page" : undefined}
										onClick={() => setView("desktop")}
									>
										<Monitor size={17} />
										{t`Desktop`}
									</button>
								)}
							</nav>
							{client !== undefined &&
								bootstrap !== undefined &&
								(view === "files" ? (
									<ComputerFiles
										key={selected.id}
										client={client}
										computerId={selected.id}
									/>
								) : (
									<Computer
										key={selected.id + view}
										client={client}
										bootstrap={bootstrap}
										selected={selected}
										pane={view}
										interactive={!selectedBasic}
									/>
								))}
						</>
					)}
				</>
			)}
		</section>
	)
}
