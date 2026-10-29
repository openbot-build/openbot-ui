import { useAtomValue, useAtomSet, useAtomRefresh } from "@effect/atom-react"
import { useState } from "react"
import { Link, Navigate, useLocation } from "react-router"
import { toast } from "sonner"
import { accountAtom } from "@/atoms/account"
import { invitationsAtom, answerInviteAtom } from "@/atoms/access"
import { Button } from "@/components/ui/button"
import { Load } from "@/components/admin/Fields"
import { errorMessage } from "@/lib/api"
export function InvitationList() {
	const result = useAtomValue(invitationsAtom)
	const answer = useAtomSet(answerInviteAtom, { mode: "promise" })
	const refresh = useAtomRefresh(accountAtom)
	const [busy, setBusy] = useState(false)
	return (
		<Load result={result}>
			{(page) => (
				<div className="space-y-4">
					{page.items.filter((i) => !i.bot).length === 0 && (
						<p className="text-muted-foreground">
							No pending organization invitations. Contact your administrator
							for access.
						</p>
					)}
					{page.items
						.filter((i) => !i.bot)
						.map((i) => (
							<div key={i.id} className="space-y-3 rounded-xl bg-muted p-4">
								<p>{i.organizationName}</p>
								<p className="text-sm text-muted-foreground">
									{i.email} · {i.roles.join(", ")}
								</p>
								<div className="flex gap-2">
									{[true, false].map((accept) => (
										<Button
											key={String(accept)}
											disabled={busy}
											variant={accept ? "default" : "secondary"}
											onClick={() => {
												setBusy(true)
												answer({ id: i.id, accept })
													.then(
														() => {
															refresh()
															toast.success(
																accept
																	? "Invitation accepted."
																	: "Invitation declined.",
															)
														},
														(e) => toast.error(errorMessage(e)),
													)
													.finally(() => setBusy(false))
											}}
										>
											{accept ? "Accept" : "Decline"}
										</Button>
									))}
								</div>
							</div>
						))}
				</div>
			)}
		</Load>
	)
}
export function InvitationsPage() {
	const account = useAtomValue(accountAtom)
	const location = useLocation()
	const params = new URLSearchParams(location.search)
	const invitation = params.get("invitation")
	if (account._tag === "Failure")
		return (
			<Navigate
				replace
				to={
					"/sign-in?returnTo=" +
					encodeURIComponent(location.pathname + location.search) +
					(invitation ? "&invitation=" + encodeURIComponent(invitation) : "")
				}
			/>
		)
	return (
		<main className="mx-auto max-w-2xl space-y-8 p-10">
			<Link to="/">← OpenBot</Link>
			<h1 className="text-3xl font-semibold">Your invitations</h1>
			<Load result={account}>{() => <InvitationList />}</Load>
		</main>
	)
}
