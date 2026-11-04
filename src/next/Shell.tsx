import { dual } from "effect/Function"
import { t } from "@lingui/core/macro"
import {
	ArrowLeft,
	CheckCheck,
	Files,
	FolderOpen,
	Gem,
	Grid2X2,
	Menu,
	MessageSquare,
	MoreHorizontal,
	PanelRight,
	Plus,
	Pin,
	Search,
	Monitor,
	UserRound,
	Settings2,
	Workflow,
	X,
} from "lucide-react"
import type { ReactNode, ComponentType, CSSProperties } from "react"
import { KayBrand } from "../components/KayBrand"
import { Surface, usePortraitLayout } from "../components/Surface"
import { Anchor, Provider } from "../components/mascot/Mascot"
import type { Startup } from "../components/mascot/Driver"
import { Button } from "../components/ui/button"
import {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "../components/ui/dropdown-menu"
import { useVisualViewport } from "../hooks/UseVisualViewport"
import type { Destination, ViewAction, ViewState, Workspace } from "./Model"
import { featureTitleKey } from "./FeatureDestinations"
import { groupLabel } from "./features/FeatureLabels"
import { AccountAvatar } from "./AccountAvatar"
import "./Shell.css"

const sections = () =>
	[
		{ kind: "tasks", label: t`Tasks`, icon: CheckCheck },
		{ kind: "files", label: t`Files`, icon: Files },
		{ kind: "apps", label: t`App Square`, icon: Grid2X2 },
		{ kind: "automations", label: t`Automations`, icon: Workflow },
	] as const

export const destinationTitle: {
	(destination: Destination, workspace: Workspace): string
	(workspace: Workspace): (destination: Destination) => string
} = dual(2, (destination: Destination, workspace: Workspace): string => {
	if (destination.kind === "kay") return "Kay"
	if (destination.kind === "new") return t`New conversation`
	if (destination.kind === "feature")
		return featureTitleKey(destination.id) === "admin"
			? groupLabel("admin")
			: destination.title
	if (destination.kind === "conversation")
		return (
			workspace.conversations.find((item) => item.id === destination.id)
				?.title ?? t`Conversation`
		)
	return (
		sections().find((item) => item.kind === destination.kind)?.label ?? "Kay"
	)
})

export interface NavigationItem {
	readonly id: string
	readonly label: string
	readonly icon: ComponentType<{ size?: number }>
	readonly onSelect: () => void
	readonly selected?: boolean
	readonly disabled?: boolean
	readonly count?: number
}

interface NavigationProps {
	readonly workspace: Workspace
	readonly view: ViewState
	readonly dispatch: (action: ViewAction) => void
	readonly onAccount: () => void
	readonly onMembership: () => void
	readonly onSearch: () => void
	readonly compact?: boolean
	readonly navigationItems?: ReadonlyArray<NavigationItem> | undefined
	readonly accountItems?: ReadonlyArray<NavigationItem> | undefined
	readonly onConversationMenu?: ((id: string) => void) | undefined
	readonly onConversationAutomations?: ((id: string) => void) | undefined
}

export function Navigation({
	workspace,
	view,
	dispatch,
	onAccount,
	onMembership,
	onSearch,
	compact = false,
	navigationItems,
	accountItems,
	onConversationMenu,
	onConversationAutomations,
}: NavigationProps) {
	const navigate = (destination: Destination) =>
		dispatch({ type: "navigate", destination })
	return (
		<div className="next-navigation">
			{!compact && (
				<div className="next-navigation-brand">
					<KayBrand />
					<Button
						variant="ghost"
						size="icon-lg"
						onClick={onSearch}
						aria-label={t`Search conversations`}
					>
						<Search />
					</Button>
				</div>
			)}
			<div className="next-navigation-scroll">
				<div className="next-kay-wrapper">
					<button
						className="next-kay-entry"
						aria-current={view.destination.kind === "kay" ? "page" : undefined}
						onClick={() => navigate({ kind: "kay" })}
					>
						<span className="next-kay-icon" aria-hidden="true">
							<MessageSquare className="next-kay-placeholder" size={19} />
							<Anchor placement="sidebar" className="next-kay-anchor" />
						</span>
						<span>Kay</span>
					</button>
				</div>
				<div className="next-new-conversation">
					<button
						aria-current={view.destination.kind === "new" ? "page" : undefined}
						onClick={() => navigate({ kind: "new" })}
					>
						<Plus size={19} />
						{t`New chat`}
					</button>
				</div>
				<nav aria-label={t`Workspace`} className="next-destinations">
					<p className="next-section-label">{t`Your workspace`}</p>
					{navigationItems === undefined &&
						sections().map(({ kind, label, icon: Icon }) => (
							<button
								key={kind}
								className="next-destination"
								aria-current={
									view.destination.kind === kind ? "page" : undefined
								}
								onClick={() => navigate({ kind })}
							>
								<Icon size={19} />
								<span>{label}</span>
								{kind === "tasks" && workspace.tasks.length > 0 && (
									<span className="next-count">{workspace.tasks.length}</span>
								)}
							</button>
						))}
					{navigationItems === undefined && (
						<button
							className="next-destination"
							onClick={() => dispatch({ type: "detail", id: "computer" })}
						>
							<Monitor size={19} />
							<span>{t`Computers`}</span>
						</button>
					)}
					{navigationItems?.map(
						({ id, label, icon: Icon, onSelect, selected, count }) => (
							<button
								key={id}
								className="next-destination"
								aria-current={selected === true ? "page" : undefined}
								onClick={onSelect}
							>
								<Icon size={19} />
								<span>{label}</span>
								{count !== undefined && count > 0 && (
									<span className="next-count">{count}</span>
								)}
							</button>
						),
					)}
				</nav>
				<nav aria-label={t`Conversations`} className="next-history">
					<p className="next-section-label">{t`Recent conversations`}</p>
					{workspace.conversations
						.filter(
							(item) => item.kind === "conversation" && item.archived !== true,
						)
						.sort(
							(a, b) => Number(b.pinned === true) - Number(a.pinned === true),
						)
						.map((conversation) => (
							<div
								key={conversation.id}
								className="next-conversation-item"
								data-managed={onConversationMenu !== undefined || undefined}
								data-automated={
									(conversation.automationIds?.length ?? 0) > 0 || undefined
								}
							>
								<button
									className="next-conversation-row"
									style={
										conversation.color === undefined
											? undefined
											: ({
													"--next-row-color": conversation.color,
												} as CSSProperties)
									}
									aria-current={
										view.destination.kind === "conversation" &&
										view.destination.id === conversation.id
											? "page"
											: undefined
									}
									onClick={() =>
										navigate({ kind: "conversation", id: conversation.id })
									}
								>
									<span className="next-selection-dot" aria-hidden="true" />
									<span className="next-conversation-title">
										{conversation.title}
									</span>
									{conversation.pinned === true && <Pin size={13} />}
								</button>
								{(conversation.automationIds?.length ?? 0) > 0 &&
									onConversationAutomations !== undefined && (
										<button
											className="next-conversation-automation"
											onClick={() => onConversationAutomations(conversation.id)}
											aria-label={t`Automations for ${conversation.title}`}
											title={t`Automations for ${conversation.title}`}
										>
											<Workflow size={15} />
										</button>
									)}
								{onConversationMenu !== undefined && (
									<button
										className="next-conversation-menu"
										aria-label={t`Manage ${conversation.title}`}
										onClick={() => onConversationMenu(conversation.id)}
									>
										<MoreHorizontal size={16} />
									</button>
								)}
							</div>
						))}
				</nav>
			</div>
			<DropdownMenu>
				<DropdownMenuTrigger
					className="next-account"
					aria-label={t`Account menu`}
				>
					<AccountAvatar
						initial={workspace.account.initial}
						url={workspace.account.avatarUrl}
					/>
					<span>
						<strong>{workspace.account.name}</strong>
						<small>{workspace.account.planName ?? "Kay Mythic"}</small>
					</span>
					<MoreHorizontal size={19} />
				</DropdownMenuTrigger>
				<DropdownMenuContent
					side="top"
					align="start"
					sideOffset={8}
					className="next-account-menu"
				>
					<DropdownMenuItem onClick={onAccount}>
						<UserRound size={17} />
						<span>{t`Your account`}</span>
					</DropdownMenuItem>
					<DropdownMenuItem onClick={onMembership}>
						<Gem size={17} />
						<span>Treasure</span>
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					{accountItems === undefined ? (
						<DropdownMenuItem onClick={onAccount}>
							<Settings2 size={17} />
							<span>{t`Settings`}</span>
						</DropdownMenuItem>
					) : (
						accountItems.map(
							({ id, label, icon: Icon, onSelect, disabled }) => (
								<DropdownMenuItem
									key={id}
									onClick={onSelect}
									disabled={disabled}
								>
									<Icon size={17} />
									<span>{label}</span>
								</DropdownMenuItem>
							),
						)
					)}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	)
}

export interface ShellProps extends NavigationProps {
	readonly children: ReactNode
	readonly startup?: Startup
	readonly thinking?: boolean
	readonly replyActive?: boolean
	readonly detail?: ReactNode
	readonly detailTitle?: string
	readonly onDetails: () => void
}

/** Shared layout has no knowledge of engine records, cookies, or network calls. */
export function Shell({
	workspace,
	view,
	dispatch,
	children,
	startup = "ready",
	thinking = false,
	replyActive = false,
	detail,
	detailTitle,
	onDetails,
	onAccount,
	onMembership,
	onSearch,
	navigationItems,
	accountItems,
	onConversationMenu,
	onConversationAutomations,
}: ShellProps) {
	useVisualViewport()
	const portrait = usePortraitLayout()
	const currentChatId =
		view.destination.kind === "conversation"
			? view.destination.id
			: view.destination.kind === "kay"
				? workspace.conversations.find(
						(chat) =>
							chat.kind === "direct" &&
							chat.botId ===
								workspace.companions.find((bot) => bot.isDefault)?.id,
					)?.id
				: undefined
	const placement =
		portrait && view.navigationOpen
			? "sidebar"
			: view.detailId !== null
				? "header"
				: view.destination.kind === "conversation" ||
					  (view.destination.kind === "kay" && replyActive)
					? "reply"
					: view.destination.kind === "kay" || view.destination.kind === "new"
						? "home"
						: "header"
	return (
		<Provider
			placement={placement}
			startup={startup}
			thinking={thinking && (placement === "home" || placement === "reply")}
		>
			<div
				className="next-shell"
				data-startup={workspace.source === "preview" ? startup : undefined}
				inert={
					startup === "pending" ||
					startup === "loading" ||
					startup === "handoff"
				}
				data-inspector={(!portrait && view.detailId !== null) || undefined}
			>
				<aside className="next-sidebar" data-mascot-boundary="sidebar">
					<Navigation
						{...{
							workspace,
							view,
							dispatch,
							onAccount,
							onMembership,
							onSearch,
							navigationItems,
							accountItems,
							onConversationMenu,
							onConversationAutomations,
						}}
					/>
				</aside>
				<div className="next-main" data-mascot-boundary="main">
					<header className="next-header" data-mascot-boundary="header">
						<div className="next-mobile-brand">
							<Button
								variant="ghost"
								size="icon-lg"
								onClick={() => dispatch({ type: "navigation", open: true })}
								aria-label={t`Open navigation`}
							>
								<Menu />
							</Button>
							<KayBrand />
						</div>
						<div className="next-page-title">
							<span>{destinationTitle(view.destination, workspace)}</span>
							{view.destination.kind === "kay" && (
								<span className="next-header-note">{t`Your ongoing conversation`}</span>
							)}
						</div>
						<div className="next-header-actions">
							{currentChatId !== undefined &&
								onConversationAutomations !== undefined && (
									<Button
										variant="ghost"
										size="icon-lg"
										onClick={() => onConversationAutomations(currentChatId)}
										aria-label={t`Conversation automations`}
										title={t`Conversation automations`}
									>
										<Workflow size={18} />
									</Button>
								)}
							{workspace.source === "preview" && (
								<span className="next-preview-label">{t`Interactive preview`}</span>
							)}
							<Button
								variant="ghost"
								size="icon-lg"
								onClick={onDetails}
								aria-label={t`Open details`}
							>
								<PanelRight size={19} />
							</Button>
						</div>
					</header>
					{workspace.source === "preview" && (
						<div className="next-preview-notice">
							<span className="next-preview-dot" />
							{t`Example data · No messages are sent and no services are connected.`}
						</div>
					)}
					<main className="next-content" id="next-content">
						{children}
					</main>
				</div>
				{!portrait && view.detailId !== null && (
					<aside
						className="next-inspector"
						data-mascot-boundary="surface"
						aria-labelledby="next-inspector-title"
					>
						<header>
							<Anchor placement="header" className="next-surface-mascot" />
							<h2 id="next-inspector-title">{detailTitle ?? t`Details`}</h2>
							<Button
								variant="ghost"
								size="icon-lg"
								onClick={() => dispatch({ type: "detail", id: null })}
								aria-label={t`Close`}
							>
								<X size={18} />
							</Button>
						</header>
						<div className="next-inspector-content">{detail}</div>
					</aside>
				)}
			</div>
			{portrait && (
				<Surface
					navigation
					open={view.navigationOpen}
					onOpenChange={(open) => dispatch({ type: "navigation", open })}
					title={t`Your workspace`}
				>
					<Navigation
						compact
						{...{
							workspace,
							view,
							dispatch,
							onAccount,
							onMembership,
							onSearch,
							navigationItems,
							accountItems,
							onConversationMenu,
							onConversationAutomations,
						}}
					/>
				</Surface>
			)}
			{portrait && (
				<Surface
					wide
					open={view.detailId !== null}
					onOpenChange={(open) => {
						if (!open) dispatch({ type: "detail", id: null })
					}}
					title={detailTitle ?? t`Details`}
					titleLeading={
						<Anchor placement="header" className="next-surface-mascot" />
					}
				>
					{detail}
				</Surface>
			)}
		</Provider>
	)
}

export function PageHeading({
	title,
	description,
	children,
}: {
	readonly title: string
	readonly description: string
	readonly children?: ReactNode
}) {
	return (
		<header className="next-page-heading">
			<div>
				<p className="next-eyebrow">Kay / {t`Your workspace`}</p>
				<h1>{title}</h1>
				<p>{description}</p>
			</div>
			{children}
		</header>
	)
}

export const workspaceIcons = {
	ArrowLeft,
	FolderOpen,
	Gem,
	MessageSquare,
	Settings2,
}
