import { t } from "@lingui/core/macro"
import { Schema } from "effect"
import { useEffect, useRef, useState } from "react"
import {
	ArrowUpRight,
	Brain,
	FolderArchive,
	Gem,
	Link2,
	Monitor,
	Moon,
	Palette,
	Plus,
	RefreshCw,
	Sun,
	Trash2,
	UserRound,
} from "lucide-react"
import { Button } from "../../components/ui/button"
import { Language } from "../../components/Language"
import { ConnectionSettings } from "../../components/ConnectionSettings"
import { setAppearance, useAppearance } from "../../hooks/UseAppearance"
import { PageHeading } from "../Shell"
import {
	MemoryPage,
	personalMemoryInput,
	type MemoryEntry,
	type PersonalSettingsSection,
	personalSettingsRoute,
} from "./SettingsData"
import {
	useWorkspaceWorkflow,
	WorkflowNotice,
	type WorkflowProps,
} from "./Workflow"
import { MembershipPage } from "./MembershipPage"
import "./SettingsPage.css"

type Section = PersonalSettingsSection
export interface SettingsPageProps extends WorkflowProps {
	readonly onChanged?: (() => void | Promise<void>) | undefined
	readonly initialSection?: Section | undefined
	readonly onNavigateFeature: (id: string) => void
	readonly previewName?: string | undefined
}

export function SettingsPage(props: SettingsPageProps) {
	const { bootstrap, onOpenChat, onNavigateFeature } = props
	const workflow = useWorkspaceWorkflow(props)
	const { appearance } = useAppearance()
	const [section, setSection] = useState<Section>(
		props.initialSection ?? "general",
	)
	const [entries, setEntries] = useState<ReadonlyArray<MemoryEntry>>([])
	const [loaded, setLoaded] = useState(false)
	const [reading, setReading] = useState(false)
	const [draft, setDraft] = useState("")
	const [removing, setRemoving] = useState<string | null>(null)
	const [notice, setNotice] = useState<string | null>(null)
	const [memoryError, setMemoryError] = useState<string | null>(null)
	const generation = useRef(0)
	const botId = bootstrap?.defaultBotId
	const owner =
		bootstrap?.identity.userId + ":" + bootstrap?.identity.organizationId
	const canReadMemory =
		!workflow.preview && botId != null && workflow.can("bots.botMemory")
	const canWriteMemory =
		!workflow.preview && botId != null && workflow.can("bots.updateBotMemory")
	const refreshMemory = async (signal?: AbortSignal) => {
		if (!canReadMemory || botId == null) return
		const current = ++generation.current
		setReading(true)
		setMemoryError(null)
		try {
			const value = Schema.decodeUnknownSync(MemoryPage)(
				await workflow.read("bots.botMemory", { params: { botId } }, signal),
			)
			if (signal?.aborted === true || generation.current !== current) return
			setEntries(value.entries.filter((entry) => entry.status === "active"))
			setLoaded(true)
		} catch {
			// Decode failures must also remain visible rather than leave an empty memory list.
			if (signal?.aborted !== true && generation.current === current)
				setMemoryError(t`This request could not be completed.`)
		} finally {
			if (signal?.aborted !== true && generation.current === current)
				setReading(false)
		}
	}
	useEffect(() => {
		setEntries([])
		setLoaded(false)
		setDraft("")
		setRemoving(null)
		setMemoryError(null)
		return () => {
			generation.current++
		}
	}, [owner])
	useEffect(() => {
		if (section !== "memory" || !workflow.ready || !canReadMemory) return
		const controller = new AbortController()
		void refreshMemory(controller.signal)
		return () => {
			controller.abort()
			generation.current++
		}
	}, [section, workflow.ready, canReadMemory, botId, owner])
	const remember = async () => {
		const content = draft.trim()
		if (content === "" || botId == null || !canWriteMemory) return
		try {
			await workflow.call(
				"bots.updateBotMemory",
				personalMemoryInput({ botId, command: { _tag: "Remember", content } }),
			)
			setDraft("")
			setNotice(t`Memory saved.`)
			await refreshMemory()
		} catch {
			/* The workflow shows the failed or unconfirmed change. */
		}
	}
	const forget = async (id: string) => {
		if (botId == null || !canWriteMemory) return
		try {
			await workflow.call(
				"bots.updateBotMemory",
				personalMemoryInput({ botId, command: { _tag: "Forget", id } }),
			)
			setRemoving(null)
			setNotice(t`Memory removed.`)
			await refreshMemory()
		} catch {
			/* Keep the selected memory available for review. */
		}
	}
	const archives =
		bootstrap?.conversations.filter(
			(chat) =>
				bootstrap.metadata?.find((item) => item.chatId === chat.id)
					?.archived === true,
		) ?? []
	const sections = [
		{ id: "general" as const, title: t`General`, icon: Palette },
		{ id: "membership" as const, title: "Treasure", icon: Gem },
		{ id: "memory" as const, title: t`Memory`, icon: Brain },
		{ id: "connections" as const, title: t`Connected apps`, icon: Link2 },
		{ id: "data" as const, title: t`Your data`, icon: FolderArchive },
	]
	return (
		<section className="kay-settings-page">
			<PageHeading
				title={t`Settings`}
				description={t`Make Kay feel right for you.`}
			/>
			<div className="kay-settings-layout">
				<nav className="kay-settings-nav" aria-label={t`Settings categories`}>
					{sections.map(({ id, title, icon: Icon }) => (
						<button
							key={id}
							aria-current={section === id ? "page" : undefined}
							onClick={() => {
								if (workflow.preview) setSection(id)
								else onNavigateFeature(personalSettingsRoute(id))
								setNotice(null)
							}}
						>
							<Icon size={18} />
							<span>{title}</span>
						</button>
					))}
				</nav>
				<div className="kay-settings-content">
					<WorkflowNotice workflow={workflow} />
					{section === "memory" &&
						memoryError !== null &&
						workflow.error === null && (
							<p className="kay-settings-notice" role="alert">
								{memoryError}
							</p>
						)}
					{notice !== null && (
						<p className="kay-settings-notice" role="status">
							{notice}
						</p>
					)}
					{section === "membership" && (
						<MembershipPage
							onChanged={props.onChanged}
							client={props.client}
							bootstrap={props.bootstrap}
							onNavigateFeature={onNavigateFeature}
						/>
					)}
					{section === "general" && (
						<>
							<section className="kay-settings-card">
								<div className="kay-settings-card-title">
									<UserRound size={19} />
									<h2>{t`Your account`}</h2>
								</div>
								<p className="kay-settings-account-name">
									{bootstrap?.identity.displayName ??
										props.previewName ??
										"Kay"}
								</p>
								<p className="kay-settings-description">{t`Your identity and sign-in are managed with your KAI account.`}</p>
							</section>
							<section className="kay-settings-card">
								<h2>{t`Appearance and language`}</h2>
								<div
									className="kay-appearance-options"
									aria-label={t`Appearance`}
								>
									{[
										{
											value: "system" as const,
											label: t`System`,
											icon: Monitor,
										},
										{ value: "light" as const, label: t`Light`, icon: Sun },
										{ value: "dark" as const, label: t`Dark`, icon: Moon },
									].map(({ value, label, icon: Icon }) => (
										<button
											key={value}
											aria-pressed={appearance === value}
											onClick={() => setAppearance(value)}
										>
											<Icon size={21} />
											<span>{label}</span>
										</button>
									))}
								</div>
								<div className="kay-settings-language">
									<Language />
								</div>
								<ConnectionSettings />
							</section>
						</>
					)}
					{section === "memory" && (
						<section className="kay-settings-card">
							<div className="kay-settings-card-title">
								<Brain size={19} />
								<h2>{t`What Kay remembers`}</h2>
								{canReadMemory && (
									<Button
										variant="ghost"
										size="icon"
										disabled={reading || workflow.busy}
										aria-label={t`Refresh memory`}
										onClick={() => void refreshMemory()}
									>
										<RefreshCw size={16} />
									</Button>
								)}
							</div>
							<p className="kay-settings-description">{t`Keep useful details for future conversations. You can remove them here, or turn memory off for an individual message in the conversation.`}</p>
							{workflow.preview ? (
								<p className="kay-settings-empty">{t`Your saved memories will appear here. This preview does not read or change an account.`}</p>
							) : !workflow.ready || (reading && !loaded) ? (
								<div
									className="feature-skeleton"
									role="status"
								>{t`Loading memory…`}</div>
							) : !canReadMemory ? (
								<p className="kay-settings-empty">{t`Memory is not available for this account yet.`}</p>
							) : (
								<>
									{loaded && entries.length === 0 && (
										<p className="kay-settings-empty">{t`No saved memories yet.`}</p>
									)}
									<ul className="kay-memory-list">
										{entries.map((entry) => (
											<li key={entry.id}>
												<p>{entry.content}</p>
												{canWriteMemory && (
													<Button
														variant="ghost"
														size="icon"
														disabled={
															workflow.busy || workflow.unconfirmed !== null
														}
														aria-label={t`Remove memory`}
														onClick={() => setRemoving(entry.id)}
													>
														<Trash2 size={16} />
													</Button>
												)}
												{removing === entry.id && (
													<div className="kay-memory-confirm">
														<p>{t`Remove this memory from future conversations?`}</p>
														<div>
															<Button
																variant="outline"
																disabled={workflow.busy}
																onClick={() => setRemoving(null)}
															>{t`Cancel`}</Button>
															<Button
																variant="destructive"
																disabled={
																	workflow.busy || workflow.unconfirmed !== null
																}
																onClick={() => void forget(entry.id)}
															>{t`Remove`}</Button>
														</div>
													</div>
												)}
											</li>
										))}
									</ul>
									{canWriteMemory && (
										<form
											className="kay-memory-form"
											onSubmit={(event) => {
												event.preventDefault()
												void remember()
											}}
										>
											<label htmlFor="kay-memory-content">{t`Something you want Kay to remember`}</label>
											<textarea
												id="kay-memory-content"
												value={draft}
												onChange={(event) => setDraft(event.target.value)}
												placeholder={t`For example, how you prefer your answers…`}
												rows={3}
											/>
											<Button
												type="submit"
												disabled={
													draft.trim() === "" ||
													workflow.busy ||
													workflow.unconfirmed !== null
												}
											>
												<Plus size={16} />
												{t`Save memory`}
											</Button>
										</form>
									)}
								</>
							)}
						</section>
					)}
					{section === "connections" && (
						<section className="kay-settings-card">
							<h2>{t`Connected apps`}</h2>
							<p className="kay-settings-description">{t`Manage the services you have connected, check their access, or disconnect an account.`}</p>
							<button
								className="kay-settings-link"
								onClick={() => onNavigateFeature("connections")}
							>
								<span>
									<strong>{t`Your connections`}</strong>
									<small>{t`Accounts and permissions belong to you.`}</small>
								</span>
								<ArrowUpRight size={18} />
							</button>
							<button
								className="kay-settings-link"
								onClick={() => onNavigateFeature("apps")}
							>
								<span>
									<strong>{t`App Square`}</strong>
									<small>{t`Find another service to use with Kay.`}</small>
								</span>
								<ArrowUpRight size={18} />
							</button>
							{workflow.can("channelLinks.listMyChannelIdentities") &&
								!workflow.preview && (
									<button
										className="kay-settings-link"
										onClick={() => onNavigateFeature("channelLinks")}
									>
										<span>
											<strong>{t`Linked accounts`}</strong>
											<small>{t`Manage your own messaging account links.`}</small>
										</span>
										<ArrowUpRight size={18} />
									</button>
								)}
						</section>
					)}
					{section === "data" && (
						<>
							<section className="kay-settings-card">
								<h2>{t`Your files`}</h2>
								<p className="kay-settings-description">{t`View and download the files saved in your workspace.`}</p>
								<button
									className="kay-settings-link"
									onClick={() => onNavigateFeature("files")}
								>
									<span>
										<strong>{t`Open files`}</strong>
									</span>
									<ArrowUpRight size={18} />
								</button>
							</section>
							<section className="kay-settings-card">
								<h2>{t`Archived conversations`}</h2>
								<p className="kay-settings-description">{t`Archived conversations stay here until you need them again.`}</p>
								{archives.length === 0 ? (
									<p className="kay-settings-empty">{t`No archived conversations.`}</p>
								) : (
									archives.map((chat) => (
										<button
											key={chat.id}
											className="kay-settings-link"
											onClick={() => onOpenChat(chat.id)}
										>
											<span>
												<strong>
													{bootstrap?.metadata?.find(
														(item) => item.chatId === chat.id,
													)?.title ??
														chat.title ??
														t`Conversation`}
												</strong>
											</span>
											<ArrowUpRight size={18} />
										</button>
									))
								)}
							</section>
						</>
					)}
				</div>
			</div>
		</section>
	)
}
