import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react"
import type { ChatSummary } from "@openbot-build/client/Api"
import {
	BotIcon,
	ChevronsUpDownIcon,
	EllipsisIcon,
	HistoryIcon,
	LogOutIcon,
	MonitorIcon,
	MoonIcon,
	SearchIcon,
	SettingsIcon,
	ShieldCheckIcon,
	SquarePenIcon,
	SunIcon,
} from "lucide-react"
import { Link, NavLink, useLocation, useNavigate } from "react-router"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuBadge,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSkeleton,
	SidebarRail,
	SidebarTrigger,
	useSidebar,
} from "@/components/ui/sidebar"
import {
	accountAtom,
	initials,
	signOut,
	type Theme,
	themeAtom,
} from "@/atoms/account"
import { chatAtom } from "@/atoms/chat"
import { botsAtom } from "@/atoms/bots"
import {
	chatName,
	chatsAtom,
	groupByDay,
	pendingRequestsAtom,
} from "@/atoms/chats"
import { searchOpenAtom, settingsTabAtom } from "@/atoms/ui"
import { LogoMark } from "@/components/app/Logo"
import { ChatMenu } from "@/components/app/ChatMenu"
import { modKey, resultValue } from "@/lib/utils"

/** The side bar: actions, the chat history and the account menu. */
export function AppSidebar() {
	const navigate = useNavigate()
	const { pathname } = useLocation()
	const { isMobile, setOpenMobile } = useSidebar()
	const setSearchOpen = useAtomSet(searchOpenAtom)
	const pending = resultValue(useAtomValue(pendingRequestsAtom))?.length ?? 0
	const close = () => {
		if (isMobile) setOpenMobile(false)
	}

	const links = [
		{ to: "/bots", label: "Bots", icon: BotIcon, badge: 0 },
		{
			to: "/requests",
			label: "Requests",
			icon: ShieldCheckIcon,
			badge: pending,
		},
		{ to: "/history", label: "History", icon: HistoryIcon, badge: 0 },
	] as const

	return (
		<Sidebar collapsible="icon" variant="sidebar">
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem className="flex items-center justify-between">
						<SidebarMenuButton
							size="lg"
							render={<Link to="/" onClick={close} />}
							className="w-auto gap-2.5 text-base font-semibold tracking-tight"
							tooltip="OpenBot"
						>
							<LogoMark className="size-6!" />
							<span>OpenBot</span>
						</SidebarMenuButton>
						<SidebarTrigger className="group-data-[collapsible=icon]:hidden" />
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>

			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupContent>
						<SidebarMenu>
							<SidebarMenuItem>
								<SidebarMenuButton
									tooltip="Search"
									onClick={() => {
										close()
										setSearchOpen(true)
									}}
								>
									<SearchIcon />
									<span>Search</span>
								</SidebarMenuButton>
								<SidebarMenuBadge className="opacity-60">
									<KbdGroup>
										<Kbd>{modKey()}</Kbd>
										<Kbd>K</Kbd>
									</KbdGroup>
								</SidebarMenuBadge>
							</SidebarMenuItem>
							<SidebarMenuItem>
								<SidebarMenuButton
									tooltip="Message a Bot"
									isActive={pathname === "/"}
									onClick={() => {
										close()
										navigate("/")
									}}
								>
									<SquarePenIcon />
									<span>Message a Bot</span>
								</SidebarMenuButton>
							</SidebarMenuItem>
							{links.map((link) => (
								<SidebarMenuItem key={link.to}>
									<SidebarMenuButton
										tooltip={link.label}
										isActive={pathname.startsWith(link.to)}
										render={<NavLink to={link.to} onClick={close} />}
									>
										<link.icon />
										<span>{link.label}</span>
									</SidebarMenuButton>
									{link.badge > 0 ? (
										<SidebarMenuBadge className="bg-sky-500 text-white">
											{link.badge}
										</SidebarMenuBadge>
									) : null}
								</SidebarMenuItem>
							))}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
				<HistoryGroups onNavigate={close} />
			</SidebarContent>

			<SidebarFooter>
				<AccountMenu />
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	)
}

function HistoryGroups({ onNavigate }: { readonly onNavigate: () => void }) {
	const result = useAtomValue(chatsAtom)
	const chats = resultValue(result)
	const bots = resultValue(useAtomValue(botsAtom))?.bots ?? []
	// Chats with a request that waits for the person get a mark.
	const waiting = new Set(
		(resultValue(useAtomValue(pendingRequestsAtom)) ?? []).map(
			(request) => request.chat as string,
		),
	)
	if (chats === undefined)
		return (
			<SidebarGroup className="group-data-[collapsible=icon]:hidden">
				<SidebarGroupLabel>Recent</SidebarGroupLabel>
				<SidebarMenu>
					{result._tag === "Failure" ? (
						<p className="px-2 text-xs text-muted-foreground">
							The history did not load.
						</p>
					) : (
						[0, 1, 2, 3, 4].map((index) => (
							<SidebarMenuItem key={index}>
								<SidebarMenuSkeleton />
							</SidebarMenuItem>
						))
					)}
				</SidebarMenu>
			</SidebarGroup>
		)
	if (chats.length === 0) return null
	return groupByDay(chats.slice(0, 100), Date.now()).map((group) => (
		<SidebarGroup
			key={group.label}
			className="group-data-[collapsible=icon]:hidden"
		>
			<SidebarGroupLabel>{group.label}</SidebarGroupLabel>
			<SidebarMenu>
				{group.items.map((item) => (
					<HistoryItem
						key={item.chat.id}
						item={item}
						name={chatName(item.chat, bots)}
						waiting={waiting.has(item.chat.id)}
						onNavigate={onNavigate}
					/>
				))}
			</SidebarMenu>
		</SidebarGroup>
	))
}

function HistoryItem({
	item,
	name,
	waiting,
	onNavigate,
}: {
	readonly item: ChatSummary
	readonly name: string
	readonly waiting: boolean
	readonly onNavigate: () => void
}) {
	const id = item.chat.id
	const { pathname } = useLocation()
	const streaming = useAtomValue(chatAtom(id)).streaming
	const running = item.status === "Running" || streaming !== undefined
	return (
		<SidebarMenuItem>
			<SidebarMenuButton
				isActive={pathname === `/c/${id}`}
				render={<NavLink to={`/c/${id}`} onClick={onNavigate} />}
			>
				<span>{name}</span>
			</SidebarMenuButton>
			{running ? (
				<SidebarMenuBadge>
					<span className="size-1.5 animate-pulse rounded-full bg-sky-500" />
				</SidebarMenuBadge>
			) : waiting ? (
				<SidebarMenuBadge>
					<span className="size-1.5 rounded-full bg-amber-500" />
				</SidebarMenuBadge>
			) : null}
			<ChatMenu
				id={id}
				name={name}
				bot={item.chat.bot}
				trigger={
					<SidebarMenuAction showOnHover aria-label="Chat actions">
						<EllipsisIcon />
					</SidebarMenuAction>
				}
			/>
		</SidebarMenuItem>
	)
}

function AccountMenu() {
	const account = resultValue(useAtomValue(accountAtom))
	const [theme, setTheme] = useAtom(themeAtom)
	const setSettingsTab = useAtomSet(settingsTabAtom)
	const name = account?.profile.name ?? account?.profile.email ?? "Account"
	const email = account?.profile.name ? account.profile.email : undefined
	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<SidebarMenuButton
								size="lg"
								className="aria-expanded:bg-sidebar-accent"
							/>
						}
					>
						<Avatar className="size-8">
							<AvatarFallback className="bg-gradient-to-br from-sky-500 to-indigo-600 text-xs font-semibold text-white">
								{initials(account?.profile.name, account?.profile.email)}
							</AvatarFallback>
						</Avatar>
						<span className="grid flex-1 text-left leading-tight">
							<span className="truncate text-sm font-medium">{name}</span>
							{email ? (
								<span className="truncate text-xs text-muted-foreground">
									{email}
								</span>
							) : null}
						</span>
						<ChevronsUpDownIcon className="ml-auto" />
					</DropdownMenuTrigger>
					<DropdownMenuContent side="top" align="start" className="w-60">
						<DropdownMenuGroup>
							<DropdownMenuItem onClick={() => setSettingsTab("general")}>
								<SettingsIcon /> Settings
							</DropdownMenuItem>
						</DropdownMenuGroup>
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							{account?.platformAdmin && (
								<DropdownMenuItem render={<NavLink to="/admin" />}>
									Platform administration
								</DropdownMenuItem>
							)}
							<DropdownMenuItem render={<NavLink to="/organization" />}>
								Organization settings
							</DropdownMenuItem>
							<DropdownMenuItem render={<NavLink to="/invitations" />}>
								Your invitations
							</DropdownMenuItem>
							<DropdownMenuLabel>Theme</DropdownMenuLabel>
							<DropdownMenuRadioGroup
								value={theme}
								onValueChange={(value) => setTheme(value as Theme)}
							>
								<DropdownMenuRadioItem value="dark">
									<MoonIcon /> Dark
								</DropdownMenuRadioItem>
								<DropdownMenuRadioItem value="light">
									<SunIcon /> Light
								</DropdownMenuRadioItem>
								<DropdownMenuRadioItem value="system">
									<MonitorIcon /> System
								</DropdownMenuRadioItem>
							</DropdownMenuRadioGroup>
						</DropdownMenuGroup>
						<DropdownMenuSeparator />
						<DropdownMenuItem onClick={() => void signOut()}>
							<LogOutIcon /> Sign out
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		</SidebarMenu>
	)
}
