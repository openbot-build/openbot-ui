import { InvitationList } from "./InvitationsPage"
import {
	useAtom,
	useAtomRefresh,
	useAtomSet,
	useAtomValue,
} from "@effect/atom-react"
import { Cause } from "effect"
import { Building2Icon } from "lucide-react"
import { useEffect, useState } from "react"
import { Link, Navigate, Outlet, useLocation } from "react-router"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Spinner } from "@/components/ui/spinner"
import { accountAtom, createOrganizationAtom } from "@/atoms/account"
import { AppSidebar } from "@/components/app/AppSidebar"
import { SearchDialog } from "@/components/app/SearchDialog"
import { SettingsDialog } from "@/components/app/SettingsDialog"
import { Shortcuts } from "@/components/app/Shortcuts"
import { errorMessage, organizationAtom } from "@/lib/api"

const isAuthError = (cause: Cause.Cause<unknown>) => {
	const error = Cause.squash(cause)
	return (
		typeof error === "object" &&
		error !== null &&
		"_tag" in error &&
		error._tag === "AuthenticationRequired"
	)
}

/** Reads the side bar state that the shadcn side bar keeps in a cookie. */
const sidebarOpen = () =>
	!globalThis.document?.cookie.includes("sidebar_state=false")

/**
 * The frame of every page after sign-in. It checks the account and picks the
 * organization, then shows the side bar and the page.
 */
export function AppLayout() {
	const location = useLocation()
	const account = useAtomValue(accountAtom)
	const [organization, setOrganization] = useAtom(organizationAtom)
	const memberships =
		account._tag === "Success"
			? account.value.memberships.filter((item) => item.status === "active")
			: []
	const chosen = memberships.find(
		(item) => item.organizationId === organization,
	)

	useEffect(() => {
		const first = memberships[0]
		if (chosen === undefined && first !== undefined)
			setOrganization(first.organizationId)
	}, [chosen, memberships, setOrganization])

	if (account._tag === "Initial") return <FullPageSpinner />
	if (account._tag === "Failure") {
		if (isAuthError(account.cause))
			return (
				<Navigate
					to={`/sign-in?returnTo=${encodeURIComponent(location.pathname + location.search)}`}
					replace
				/>
			)
		return (
			<Empty className="min-h-svh">
				<EmptyHeader>
					<EmptyTitle>OpenBot is not reachable</EmptyTitle>
					<EmptyDescription>{errorMessage(account.cause)}</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button onClick={() => globalThis.location.reload()}>
						Try again
					</Button>
				</EmptyContent>
			</Empty>
		)
	}
	if (memberships.length === 0) return <NoOrganization />
	if (chosen === undefined) return <FullPageSpinner />

	return (
		<SidebarProvider defaultOpen={sidebarOpen()} className="app-shell" style={{ "--sidebar-width": "18rem" } as React.CSSProperties}>
			<AppSidebar />
			<SidebarInset className="app-canvas min-w-0 overflow-hidden">
				<Outlet />
			</SidebarInset>
			<SearchDialog />
			<SettingsDialog />
			<Shortcuts />
		</SidebarProvider>
	)
}

function FullPageSpinner() {
	return (
		<div className="flex min-h-svh items-center justify-center">
			<Spinner className="size-6 text-muted-foreground" />
		</div>
	)
}

function NoOrganization() {
 const account = useAtomValue(accountAtom)
 const canCreate = account._tag === "Success" && account.value.canCreateOrganization
 const admin = account._tag === "Success" && account.value.platformAdmin
	const create = useAtomSet(createOrganizationAtom, { mode: "promise" })
	const refresh = useAtomRefresh(accountAtom)
	const [name, setName] = useState("")
	const [busy, setBusy] = useState(false)
	return (
		<Empty className="min-h-svh">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<Building2Icon />
				</EmptyMedia>
				<EmptyTitle>Your organization access</EmptyTitle>
				<EmptyDescription>
					Your account is not in an organization yet. Accept an invitation or contact your administrator.
				</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				{canCreate && <form
					className="flex w-full max-w-sm gap-2"
					onSubmit={(event) => {
						event.preventDefault()
						if (name.trim().length === 0) return
						setBusy(true)
						create(name.trim())
							.then(refresh, (cause: unknown) =>
								toast.error(errorMessage(cause)),
							)
							.finally(() => setBusy(false))
					}}
				>
					<Input
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="Organization name"
						aria-label="Organization name"
					/>
					<Button type="submit" disabled={busy || name.trim().length === 0}>
						{busy ? <Spinner /> : null} Create
					</Button>
				</form>}
                <InvitationList />
                {admin && <Link to="/admin">Platform administration</Link>}
			</EmptyContent>
		</Empty>
	)
}
