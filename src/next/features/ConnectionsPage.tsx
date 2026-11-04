import { t } from "@lingui/core/macro"
import { Match, Schema } from "effect"
import { useEffect, useRef, useState } from "react"
import {
	ArrowLeft,
	ArrowUpRight,
	Check,
	Link2,
	Plus,
	RefreshCw,
	Search,
	X,
} from "lucide-react"
import { Button } from "../../components/ui/button"
import { PageHeading } from "../Shell"
import { connectionAddress, type CatalogEntry } from "../../experience/Catalog"
import { CloudCatalog } from "./CloudCatalog"
import { ConnectionTransfer } from "./ConnectionTransfer"
import {
	AppConnection,
	AppConnections,
	authorizationNeeded,
	connectionSummary,
	connectionUrl,
} from "./ConnectionsData"
import { objectOf } from "./SchemaValues"
import { safeLink } from "./FeatureData"
import {
	useWorkspaceWorkflow,
	WorkflowNotice,
	type WorkflowProps,
} from "./Workflow"
import "./ConnectionsPage.css"
import "./Features.css"

interface ConnectionDraft {
	readonly name: string
	readonly url: string
	readonly headers: ReadonlyArray<{
		readonly name: string
		readonly label: string
		readonly value: string
		readonly required: boolean
	}>
}
const statusLabel = (connection: AppConnection) =>
	Match.value(connectionSummary(connection)).pipe(
		Match.when("ready", () => t`Connected`),
		Match.when("paused", () => t`Paused`),
		Match.when("authorization", () => t`Sign-in needed`),
		Match.when("configuration", () => t`Setup needed`),
		Match.when("restricted", () => t`Not available in this workspace`),
		Match.when("unavailable", () => t`Check connection`),
		Match.exhaustive,
	)

export function ConnectionsPage(
	props: WorkflowProps & {
		readonly initialConnected?: boolean
		readonly authorization?: string | undefined
		readonly onChanged?: (() => void | Promise<void>) | undefined
	},
) {
	const workflow = useWorkspaceWorkflow(props)
	const [section, setSection] = useState(
		props.initialConnected === true ? "connected" : "discover",
	)
	const [connections, setConnections] = useState<ReadonlyArray<AppConnection>>(
		[],
	)
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const [draft, setDraft] = useState<ConnectionDraft | null>(null)
	const [query, setQuery] = useState("")
	const [loaded, setLoaded] = useState(false)
	const [loading, setLoading] = useState(false)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [notice, setNotice] = useState<string | null>(null)
	const [removing, setRemoving] = useState(false)
	const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null)
	const [issuers, setIssuers] = useState<ReadonlyArray<string>>([])
	const alive = useRef(true),
		sequence = useRef(0),
		returned = useRef<string | null>(null),
		saveLock = useRef(false),
		addPanel = useRef<HTMLElement | null>(null)
	const selected = connections.find(
		(connection) => connection.id === selectedId,
	)
	const blocked = saving || workflow.busy || workflow.unconfirmed !== null
	useEffect(() => {
		if (draft !== null) addPanel.current?.scrollIntoView({ block: "nearest" })
	}, [draft !== null])
	useEffect(() => {
		alive.current = true
		return () => {
			alive.current = false
			sequence.current++
		}
	}, [])
	const refresh = async (signal?: AbortSignal) => {
		if (workflow.preview || !workflow.can("connections.listConnections")) {
			setLoaded(true)
			return []
		}
		const generation = ++sequence.current
		setLoading(true)
		setError(null)
		try {
			const rows = Schema.decodeUnknownSync(AppConnections)(
				await workflow.read("connections.listConnections", {}, signal),
			)
			if (
				alive.current &&
				signal?.aborted !== true &&
				sequence.current === generation
			) {
				setConnections(rows)
				setLoaded(true)
			}
			return rows
		} catch (failure) {
			if (
				alive.current &&
				signal?.aborted !== true &&
				sequence.current === generation
			) {
				setError(t`Your connected apps could not be loaded. Try again.`)
				setLoaded(true)
			}
			throw failure
		} finally {
			if (
				alive.current &&
				signal?.aborted !== true &&
				sequence.current === generation
			)
				setLoading(false)
		}
	}
	useEffect(() => {
		if (!workflow.ready) return
		const controller = new AbortController()
		void refresh(controller.signal).catch(() => {})
		return () => controller.abort()
	}, [workflow.ready, workflow.can])
	useEffect(() => {
		const flowId = props.authorization
		if (!workflow.ready || flowId === undefined || returned.current === flowId)
			return
		returned.current = flowId
		setSection("connected")
		void (async () => {
			try {
				let flow = objectOf(
					await workflow.read("appAuthorization.getAppAuthorization", {
						params: { flowId },
					}),
				)
				if (flow["status"] === "Received")
					flow = objectOf(
						await workflow.call("appAuthorization.completeAppAuthorization", {
							params: { flowId },
							payload: {},
						}),
					)
				if (!alive.current) return
				if (typeof flow["connectionId"] === "string")
					setSelectedId(flow["connectionId"])
				setNotice(
					flow["status"] === "Succeeded"
						? t`Your App account is connected.`
						: t`Your sign-in has returned. Check the connection below.`,
				)
				await refresh()
			} catch {
				/* The authorization response remains available to retry by its flow. */
			}
		})()
	}, [props.authorization, workflow.ready])
	const select = (connection: AppConnection) => {
		setSection("connected")
		setSelectedId(connection.id)
		setNotice(null)
		setError(null)
		setRemoving(false)
		setAuthorizationUrl(null)
		setIssuers([])
	}
	const check = async (connection: AppConnection) => {
		await workflow.call("connections.verifyConnection", {
			params: { connectionId: connection.id },
			payload: {},
		})
		const rows = await refresh()
		return rows.find((item) => item.id === connection.id)
	}
	const save = async (next: ConnectionDraft): Promise<"added" | "setup"> => {
		if (saveLock.current) return "setup"
		saveLock.current = true
		setSaving(true)
		try {
			setError(null)
			const url = connectionUrl(next.url)
			const rows = await refresh()
			let connection = rows.find((item) => item.endpoint === url)
			if (connection === undefined)
				connection = Schema.decodeUnknownSync(AppConnection)(
					await workflow.call("connections.createManualConnection", {
						payload: {
							id: crypto.randomUUID(),
							name: next.name.trim().slice(0, 80),
							url,
							transport: "streamable-http",
							headers: Object.fromEntries(
								next.headers
									.filter((header) => header.value !== "")
									.map((header) => [header.name, header.value]),
							),
						},
					}),
				)
			if (!alive.current) return "setup"
			setConnections((current) => [
				...current.filter((item) => item.id !== connection.id),
				connection,
			])
			setDraft(null)
			select(connection)
			void props.onChanged?.()
			try {
				const checked = await check(connection)
				return checked !== undefined && connectionSummary(checked) === "ready"
					? "added"
					: "setup"
			} catch {
				return "setup"
			}
		} finally {
			saveLock.current = false
			if (alive.current) setSaving(false)
		}
	}
	const add = async (entry: CatalogEntry): Promise<"added" | "setup"> => {
		const url = connectionAddress(entry)
		if (url === undefined)
			throw new Error(t`This app needs its connection address first.`)
		const next: ConnectionDraft = {
			name: entry.name,
			url,
			headers: (entry.cloud?.headers ?? []).map((header) => ({
				name: header.name,
				label: header.description ?? header.name,
				value: header.value ?? "",
				required: header.required === true,
			})),
		}
		if (next.headers.some((header) => header.required && header.value === "")) {
			setDraft(next)
			return "setup"
		}
		return save(next)
	}
	const authorize = async (issuer?: string) => {
		if (selected === undefined) return
		try {
			const scopes = Match.value(selected.availability).pipe(
				Match.tag("PendingAuthorization", (value) => value.scopes),
				Match.orElse(() => []),
			)
			const result = objectOf(
				await workflow.call("appAuthorization.beginAppAuthorization", {
					params: { connectionId: selected.id },
					payload: {
						revision: selected.revision,
						scopes,
						returnTo: "/?feature=connections",
						...(issuer === undefined ? {} : { issuer }),
					},
				}),
			)
			if (!alive.current) return
			const url = safeLink(result["authorizationUrl"])
			if (url !== undefined) {
				setAuthorizationUrl(url)
				setIssuers([])
			} else if (Array.isArray(result["issuers"]))
				setIssuers(
					result["issuers"].filter(
						(value): value is string => typeof value === "string",
					),
				)
			else {
				await refresh()
				setNotice(t`This App does not need a separate sign-in.`)
			}
		} catch {
			/* A failed sign-in keeps the current App selected. */
		}
	}
	const toggle = async () => {
		if (selected === undefined) return
		try {
			await workflow.call("connections.updateConnection", {
				params: { connectionId: selected.id },
				payload: {
					revision: selected.revision,
					name: selected.name,
					enabled: !selected.enabled,
				},
			})
			await refresh()
			void props.onChanged?.()
		} catch {
			/* Keep the saved state until the update succeeds. */
		}
	}
	const remove = async () => {
		if (selected === undefined) return
		try {
			await workflow.call("connections.deleteConnection", {
				params: { connectionId: selected.id },
				payload: {},
			})
			setSelectedId(null)
			setRemoving(false)
			await refresh()
			void props.onChanged?.()
		} catch {
			/* Failed cleanup remains visible on the selected connection. */
		}
	}
	const filtered = connections.filter((connection) =>
		(connection.name + " " + connection.card.description)
			.toLocaleLowerCase()
			.includes(query.toLocaleLowerCase()),
	)
	return (
		<section className="next-connections next-feature">
			<PageHeading
				title={
					props.initialConnected === true ? t`Connected apps` : t`App Square`
				}
				description={t`Find useful services for your work, and manage the accounts you connect to Kay.`}
			/>
			<div className="connections-toolbar">
				<nav aria-label={t`Apps`}>
					<button
						aria-current={section === "discover" ? "page" : undefined}
						onClick={() => setSection("discover")}
					>{t`Discover`}</button>
					<button
						aria-current={section === "connected" ? "page" : undefined}
						onClick={() => setSection("connected")}
					>
						{t`Connected apps`}
						{connections.length > 0 && <span>{connections.length}</span>}
					</button>
				</nav>
				<Button
					variant="outline"
					disabled={!workflow.ready || blocked || workflow.preview}
					onClick={() => {
						setDraft({ name: "", url: "", headers: [] })
						setError(null)
					}}
				>
					<Plus size={16} />
					{t`Add by link`}
				</Button>
			</div>
			{section === "connected" && (
				<ConnectionTransfer workflow={workflow} onChanged={refresh} />
			)}
			<WorkflowNotice workflow={workflow} />
			{error !== null && (
				<p className="workflow-notice" role="alert">
					{error}
				</p>
			)}
			{notice !== null && (
				<p className="connection-notice" role="status">
					<Check size={16} />
					{notice}
				</p>
			)}
			{draft !== null && (
				<section
					ref={addPanel}
					className="connection-add"
					aria-label={t`Connect an App`}
				>
					<div className="connection-panel-heading">
						<h2>{t`Connect an App`}</h2>
						<Button
							variant="ghost"
							size="icon"
							aria-label={t`Close`}
							disabled={blocked}
							onClick={() => setDraft(null)}
						>
							<X size={17} />
						</Button>
					</div>
					<p>{t`Use the cloud MCP address provided by the service. Your account details stay private to you.`}</p>
					<form
						onSubmit={(event) => {
							event.preventDefault()
							void save(draft).catch((failure) =>
								setError(
									failure instanceof Error
										? failure.message
										: t`The app could not be added.`,
								),
							)
						}}
					>
						<label className="feature-field">
							<span>{t`App name`}</span>
							<input
								required
								maxLength={80}
								value={draft.name}
								onChange={(event) =>
									setDraft({ ...draft, name: event.target.value })
								}
							/>
						</label>
						<label className="feature-field">
							<span>{t`Service address`}</span>
							<input
								required
								type="url"
								placeholder="https://…"
								value={draft.url}
								onChange={(event) =>
									setDraft({ ...draft, url: event.target.value })
								}
							/>
						</label>
						{draft.headers.map((header, index) => (
							<label className="feature-field" key={header.name}>
								<span>{header.label}</span>
								<input
									type="password"
									autoComplete="off"
									required={header.required}
									value={header.value}
									onChange={(event) =>
										setDraft({
											...draft,
											headers: draft.headers.map((item, position) =>
												position === index
													? { ...item, value: event.target.value }
													: item,
											),
										})
									}
								/>
							</label>
						))}
						<Button
							type="submit"
							disabled={
								blocked || draft.name.trim() === "" || draft.url.trim() === ""
							}
						>
							{saving || workflow.busy ? t`Connecting…` : t`Connect App`}
						</Button>
					</form>
				</section>
			)}
			<div hidden={section !== "discover"}>
				<CloudCatalog
					onAdd={add}
					disabled={blocked || !workflow.ready || workflow.preview}
				/>
			</div>
			{section === "connected" &&
				(selected === undefined ? (
					<>
						<div className="connection-list-toolbar">
							<label>
								<Search size={17} />
								<input
									aria-label={t`Search connected apps`}
									placeholder={t`Search connected apps`}
									value={query}
									onChange={(event) => setQuery(event.target.value)}
								/>
							</label>
							<Button
								variant="ghost"
								size="icon"
								aria-label={t`Refresh connected apps`}
								disabled={loading}
								onClick={() => void refresh().catch(() => {})}
							>
								<RefreshCw size={17} />
							</Button>
						</div>
						{!loaded || loading ? (
							<p role="status">{t`Loading your connected apps…`}</p>
						) : error !== null &&
						  connections.length === 0 ? null : connections.length === 0 ? (
							<div className="connection-empty">
								<Link2 size={30} />
								<h2>{t`Bring your tools into the conversation`}</h2>
								<p>{t`Connect an App to let Kay work with a service you already use. You choose the account and approve access.`}</p>
								<Button
									variant="outline"
									onClick={() => setSection("discover")}
								>
									{t`Explore App Square`}
									<ArrowUpRight size={16} />
								</Button>
							</div>
						) : filtered.length === 0 ? (
							<p>{t`No connected apps match your search.`}</p>
						) : (
							<div className="connection-list">
								{filtered.map((connection) => (
									<button
										className="connection-row"
										key={connection.id}
										onClick={() => select(connection)}
									>
										<span className="connection-icon">
											<Link2 size={21} />
										</span>
										<span>
											<strong>
												{connection.name === ""
													? connection.card.name
													: connection.name}
											</strong>
											<small>{connection.card.description}</small>
										</span>
										<span
											className="connection-state"
											data-status={connectionSummary(connection)}
										>
											{statusLabel(connection)}
										</span>
										<ArrowUpRight size={16} />
									</button>
								))}
							</div>
						)}
					</>
				) : (
					<article className="connection-detail">
						<Button
							variant="ghost"
							className="connection-back"
							onClick={() => {
								setSelectedId(null)
								setRemoving(false)
								setAuthorizationUrl(null)
							}}
						>
							<ArrowLeft size={16} />
							{t`All connected apps`}
						</Button>
						<div className="connection-panel-heading">
							<div>
								<span
									className="connection-state"
									data-status={connectionSummary(selected)}
								>
									{statusLabel(selected)}
								</span>
								<h2>
									{selected.name === "" ? selected.card.name : selected.name}
								</h2>
							</div>
							<span className="connection-icon">
								<Link2 size={26} />
							</span>
						</div>
						<p>{selected.card.description}</p>
						<p className="connection-address">{selected.endpoint}</p>
						<div className="connection-actions">
							{authorizationNeeded(selected) && (
								<Button disabled={blocked} onClick={() => void authorize()}>
									{t`Sign in to this App`}
									<ArrowUpRight size={16} />
								</Button>
							)}
							<Button
								variant="outline"
								disabled={
									blocked || !workflow.can("connections.verifyConnection")
								}
								onClick={() => void check(selected).catch(() => {})}
							>
								<RefreshCw size={16} />
								{t`Check connection`}
							</Button>
							<Button
								variant="outline"
								disabled={
									blocked || !workflow.can("connections.updateConnection")
								}
								onClick={() => void toggle()}
							>
								{selected.enabled ? t`Pause connection` : t`Resume connection`}
							</Button>
						</div>
						{authorizationUrl !== null && (
							<a className="connection-sign-in" href={authorizationUrl}>
								{t`Continue to the service to sign in`}
								<ArrowUpRight size={16} />
							</a>
						)}
						{issuers.length > 0 && (
							<div className="connection-issuers">
								<p>{t`Choose the account service you use with this App.`}</p>
								{issuers.map((issuer) => (
									<Button
										key={issuer}
										variant="outline"
										disabled={blocked}
										onClick={() => void authorize(issuer)}
									>
										{new URL(issuer).hostname}
										<ArrowUpRight size={16} />
									</Button>
								))}
							</div>
						)}
						{connectionSummary(selected) === "ready" && (
							<div className="connection-usage">
								<h3>{t`Ready for your next conversation`}</h3>
								<p>{t`Ask Kay to use this App when you need it. Connecting an account does not run any tools by itself.`}</p>
								<Button
									onClick={() =>
										props.onStartConversation(
											t`Help me with a task using ${selected.name}.`,
										)
									}
								>{t`Start a conversation`}</Button>
							</div>
						)}
						<div className="connection-remove">
							{removing ? (
								<>
									<p>{t`Disconnect ${selected.name}? Kay will no longer use this connection. You can add the App again later.`}</p>
									<Button
										variant="destructive"
										disabled={blocked}
										onClick={() => void remove()}
									>{t`Disconnect App`}</Button>
									<Button
										variant="ghost"
										disabled={blocked}
										onClick={() => setRemoving(false)}
									>{t`Cancel`}</Button>
								</>
							) : (
								<Button
									variant="ghost"
									disabled={
										blocked || !workflow.can("connections.deleteConnection")
									}
									onClick={() => setRemoving(true)}
								>{t`Disconnect App`}</Button>
							)}
						</div>
					</article>
				))}
		</section>
	)
}
