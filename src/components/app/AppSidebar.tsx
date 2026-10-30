import { useAtom, useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import { ChevronsUpDownIcon, HistoryIcon, LogOutIcon, MonitorIcon, MoonIcon, PlusIcon, SearchIcon, SettingsIcon, ShieldCheckIcon, SquarePenIcon, SunIcon, SlidersHorizontalIcon } from "lucide-react"
import { Link, NavLink, useLocation } from "react-router"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSkeleton, SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import { accountAtom, initials, signOut, type Theme, themeAtom } from "@/atoms/account"
import { billingAtom } from "@/atoms/billing"
import { botsAtom } from "@/atoms/bots"
import { chatsAtom, pendingRequestsAtom } from "@/atoms/chats"
import { searchOpenAtom, settingsTabAtom } from "@/atoms/ui"
import { Logo } from "@/components/app/Logo"
import { organizationAtom } from "@/lib/api"
import { resultValue } from "@/lib/utils"

/** Bots stay in one place. History and account tools are secondary. */
export function AppSidebar() {
  const { pathname, search } = useLocation()
  const { isMobile, setOpenMobile } = useSidebar()
  const setSearchOpen = useAtomSet(searchOpenAtom)
  const account = resultValue(useAtomValue(accountAtom))
  const [space, setSpace] = useAtom(organizationAtom)
  const result = useAtomValue(botsAtom)
  const loaded = resultValue(result)
  const refresh = useAtomRefresh(botsAtom)
  const chats = resultValue(useAtomValue(chatsAtom)) ?? []
  const requests = resultValue(useAtomValue(pendingRequestsAtom)) ?? []
  const selectedBot = pathname === "/"
    ? new URLSearchParams(search).get("bot") ?? loaded?.defaultBot ?? loaded?.bots[0]?.id
    : chats.find(item => pathname === `/c/${item.chat.id}`)?.chat.bot
  const close = () => { if (isMobile) setOpenMobile(false) }
  const actions = [
    { label: "Start here", icon: SquarePenIcon, to: "/" },
    { label: "Search", icon: SearchIcon, to: undefined },
    { label: "History", icon: HistoryIcon, to: "/history" },
    { label: "Requests", icon: ShieldCheckIcon, to: "/requests" },
  ]
  return (
    <Sidebar collapsible="offcanvas" variant="inset">
      <SidebarHeader className="gap-7 px-(--sheet-action-inset) pt-(--sheet-action-inset) pb-5">
        <div className="flex items-center justify-between gap-2">
          <Link to="/" onClick={close} aria-label="OpenBot home"><Logo /></Link>
          <SidebarTrigger className="size-11 text-muted-foreground [&_svg]:size-5" />
        </div>
        <nav aria-label="Main navigation" className="flex items-center justify-between gap-1">
          {actions.map(action => (
            <Tooltip key={action.label}>
              <TooltipTrigger render={
                <Button variant="ghost" size="icon-lg" aria-label={action.label === "Requests" && requests.length ? `Requests (${requests.length})` : action.label}
                  aria-current={action.to === pathname ? "page" : undefined}
                  className="relative size-11 aria-[current=page]:bg-sidebar-accent"
                  {...(action.to ? { nativeButton: false, render: <NavLink to={action.to} onClick={close} /> } : { onClick: () => { close(); setSearchOpen(true) } })} />
              }>
                <action.icon className="size-5" />
                {action.label === "Requests" && requests.length > 0 && <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-label-small text-primary-foreground">{requests.length}</span>}
              </TooltipTrigger>
              <TooltipContent>{action.label}</TooltipContent>
            </Tooltip>
          ))}
        </nav>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="px-(--sheet-content-inset)">
          <div className="mb-3 flex items-center justify-between px-3">
            <h2 className="text-label-large text-muted-foreground">Your Bots</h2>
            <Button variant="ghost" size="icon-sm" nativeButton={false} render={<Link to="/bots?new=1" onClick={close} />} aria-label="New Bot"><PlusIcon /></Button>
          </div>
          <SidebarMenu className="gap-2">
            {loaded?.bots.map(bot => {
              const direct = chats.find(item => item.chat.kind === "direct" && item.chat.bot === bot.id)
              const waiting = requests.some(request => chats.some(item => item.chat.id === request.chat && item.chat.bot === bot.id))
              return <SidebarMenuItem key={bot.id}>
                <SidebarMenuButton isActive={selectedBot === bot.id} aria-current={selectedBot === bot.id ? "page" : undefined} className="h-auto min-h-14 rounded-lg [corner-shape:round] px-5 py-4 text-body-large" render={<Link to={direct ? `/c/${direct.chat.id}` : `/?bot=${encodeURIComponent(bot.id)}`} onClick={close} />}>
                  <span className="min-w-0 flex-1 truncate">{bot.name}</span>
                  {waiting && <span className="size-2 shrink-0 rounded-full bg-amber-500"><span className="sr-only">Needs your attention</span></span>}
                </SidebarMenuButton>
              </SidebarMenuItem>
            })}
            {!loaded && (result._tag === "Failure" ? <div className="px-3 text-body-medium text-muted-foreground"><p>Bots could not load.</p><Button variant="ghost" onClick={refresh}>Try again</Button></div> : [0, 1, 2].map(i => <SidebarMenuItem key={i}><SidebarMenuSkeleton /></SidebarMenuItem>))}
            {loaded?.bots.length === 0 && <p className="px-3 py-4 text-body-medium text-muted-foreground">No Bots yet.</p>}
          </SidebarMenu>
          <Button variant="ghost" className="mt-4 justify-start gap-3 px-5 text-muted-foreground" nativeButton={false} render={<Link to="/bots" onClick={close} />}><SlidersHorizontalIcon /> Manage Bots</Button>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="gap-3 px-4 pb-4">
        {(account?.memberships.filter(m => m.status === "active").length ?? 0) > 1 && <label>
          <span className="sr-only">Current space</span>
          <select className="w-full cursor-pointer rounded-full bg-transparent px-3 py-2 text-body-medium text-muted-foreground focus-visible:outline-2" value={space ?? ""} onChange={event => setSpace(event.target.value)}>
            {account?.memberships.filter(m => m.status === "active").map(m => <option key={m.organizationId} value={m.organizationId}>{m.name}</option>)}
          </select>
        </label>}
        <AccountMenu />
      </SidebarFooter>
    </Sidebar>
  )
}

function AccountMenu() {
  const account = resultValue(useAtomValue(accountAtom));
  const space = useAtomValue(organizationAtom);
  const billing = resultValue(useAtomValue(billingAtom(space ?? "")));
  const canBill = billing !== undefined;
  const privateSpace = billing?.kind === "personal";
  const [theme, setTheme] = useAtom(themeAtom);
  const setSettingsTab = useAtomSet(settingsTabAtom);
  const name = account?.profile.name ?? account?.profile.email ?? "Account";
  const email = account?.profile.name ? account.profile.email : undefined;
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="h-12 rounded-full p-2 aria-expanded:bg-sidebar-accent"
              />
            }
          >
            <Avatar className="size-8">
              <AvatarFallback className="bg-foreground text-background text-body-small font-semibold">
                {initials(account?.profile.name, account?.profile.email)}
              </AvatarFallback>
            </Avatar>
            <span className="grid flex-1 text-left leading-tight">
              <span className="truncate text-body-medium font-medium">{name}</span>
              {email ? (
                <span className="truncate text-body-small text-muted-foreground">
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
              {canBill && <DropdownMenuItem render={<NavLink to="/billing" />}>Billing &amp; credits</DropdownMenuItem>}
              {account?.platformAdmin && (
                <DropdownMenuItem render={<NavLink to="/admin" />}>
                  Platform administration
                </DropdownMenuItem>
              )}
              {!privateSpace && (
                <DropdownMenuItem render={<NavLink to="/organization" />}>
                  Organization settings
                </DropdownMenuItem>
              )}
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
  );
}
