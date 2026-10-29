import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react"
import { useState } from "react"
import { toast } from "sonner"
import {
	AccessApi,
	type OrganizationApi,
	type SsoApi,
} from "@openbot-build/client/Api"
import { Schema } from "effect"
import {
	membersAtom,
	orgInvitesAtom,
	connectionsAtom,
	rolesAtom,
	orgActionAtom,
	orgPageAtom as pageAtom,
} from "@/atoms/access"
import { accountAtom } from "@/atoms/account"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { TextField, Load, Pager } from "@/components/admin/Fields"
import { GroupMapping } from "@/components/admin/GroupMapping"
import { errorMessage, organizationAtom } from "@/lib/api"
function Member({ member }: { member: OrganizationApi.Member }) {
	const action = useAtomSet(orgActionAtom, { mode: "promise" })
	const roles = useAtomValue(rolesAtom)
	const [manual, setManual] = useState(member.manualRoles ?? member.roles)
	const [busy, setBusy] = useState(false)
	const save = (input: OrganizationApi.UpdateMemberRequest) => {
		setBusy(true)
		action({ kind: "member", id: member.userId, input })
			.catch((e) => toast.error(errorMessage(e)))
			.finally(() => setBusy(false))
	}
	return (
		<div className="space-y-4 rounded-xl bg-muted p-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<p>{member.name || member.email || member.userId}</p>
					<p className="text-sm text-muted-foreground">
						{member.email} · {member.status}
					</p>
				</div>
				<Button
					variant="secondary"
					disabled={busy}
					onClick={() =>
						save({
							status: member.status === "active" ? "suspended" : "active",
						})
					}
				>
					{member.status === "active"
						? "Suspend in this organization"
						: "Restore membership"}
				</Button>
			</div>
			<p className="text-sm">
				SSO roles:{" "}
				{member.roleSources
					?.map((s) => s.role + " (" + s.providerId + ")")
					.join(", ") || "None"}
			</p>
			<p className="text-sm">Manual roles</p>
			<Load result={roles}>
				{(page) => (
					<div className="flex flex-wrap gap-4">
						{page.map((r) => (
							<label key={r.id} className="flex items-center gap-2 text-sm">
								<Switch
									checked={manual.includes(r.id)}
									onCheckedChange={(on) =>
										setManual(
											on
												? [...manual, r.id]
												: manual.filter((id) => id !== r.id),
										)
									}
								/>
								{r.name}
							</label>
						))}
					</div>
				)}
			</Load>
			<Button
				disabled={busy}
				variant="secondary"
				onClick={() =>
					save({
						roles: manual as OrganizationApi.UpdateMemberRequest["roles"],
					})
				}
			>
				Save manual roles
			</Button>
		</div>
	)
}
function Members() {
	const result = useAtomValue(membersAtom)
	const [, setPage] = useAtom(pageAtom)
	return (
		<Load result={result}>
			{(page) => (
				<div className="space-y-4">
					{page.items.map((m) => (
						<Member key={m.userId + m.roles.join() + m.status} member={m} />
					))}
					<Pager next={page.next} onPage={setPage} />
				</div>
			)}
		</Load>
	)
}
function Invites() {
	const result = useAtomValue(orgInvitesAtom)
	const action = useAtomSet(orgActionAtom, { mode: "promise" })
	const [email, setEmail] = useState("")
	const [busy, setBusy] = useState(false)
	return (
		<div className="space-y-6">
			<form
				className="flex items-end gap-3"
				onSubmit={(e) => {
					e.preventDefault()
					setBusy(true)
					action({ kind: "invite", email: email.trim() })
						.then(
							(result) => {
								setEmail("")
								toast.success(
									result &&
										"delivery" in result &&
										result.delivery?.status !== "sent"
										? "Invitation saved. Copy its link to share it."
										: "Invitation saved.",
								)
							},
							(e) => toast.error(errorMessage(e)),
						)
						.finally(() => setBusy(false))
				}}
			>
				<TextField label="Email to invite" value={email} onChange={setEmail} />
				<Button type="submit" disabled={busy || !email}>
					Invite
				</Button>
			</form>
			<Load result={result}>
				{(page) => (
					<div className="space-y-3">
						{page.items.map((i) => (
							<div
								className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted p-4"
								key={i.id}
							>
								<div>
									<p>{i.email}</p>
									<p className="text-sm text-muted-foreground">
										{i.status} · ends{" "}
										{new Date(i.expiresAt).toLocaleDateString()}
									</p>
								</div>
								{i.status === "pending" && (
									<div className="flex flex-wrap gap-2">
										<Button
											variant="secondary"
											onClick={() =>
												navigator.clipboard
													.writeText(
														location.origin +
															"/invitations?invitation=" +
															encodeURIComponent(i.id),
													)
													.then(
														() => toast.success("Invitation link copied."),
														() => toast.error("The link could not be copied."),
													)
											}
										>
											Copy link
										</Button>
										{(["send", "revoke"] as const).map((kind) => (
											<Button
												key={kind}
												disabled={busy}
												variant="secondary"
												onClick={() => {
													setBusy(true)
													action({ kind, id: i.id })
														.then(
															(result) =>
																toast.success(
																	kind === "revoke"
																		? "Invitation revoked."
																		: result &&
																			  "status" in result &&
																			  result.status === "sent"
																			? "Email sent."
																			: "Email was not sent. The invitation link still works.",
																),
															(e) => toast.error(errorMessage(e)),
														)
														.finally(() => setBusy(false))
												}}
											>
												{kind === "send" ? "Send again" : "Revoke"}
											</Button>
										))}
									</div>
								)}
							</div>
						))}
					</div>
				)}
			</Load>
		</div>
	)
}
function Connection({ connection }: { connection: SsoApi.SsoConnection }) {
	const organizationId = useAtomValue(organizationAtom)
	const [value, set] = useState(connection.access ?? AccessApi.providerDefaults)
	const [busy, setBusy] = useState(false)
	const action = useAtomSet(orgActionAtom, { mode: "promise" })
	return (
		<form
			className="space-y-5 rounded-screen bg-card p-(--corner-inset)"
			onSubmit={(e) => {
				e.preventDefault()
				const access = Schema.decodeUnknownOption(AccessApi.ProviderAccess)(
					value,
				)
				if (access._tag === "None") {
					toast.error("Check the group mappings.")
					return
				}
				setBusy(true)
				action({
					kind: "sso",
					id: connection.id,
					input: { expectedVersion: connection.version, access: access.value },
				})
					.then(
						() => toast.success("SSO mappings saved."),
						(e) => toast.error(errorMessage(e)),
					)
					.finally(() => setBusy(false))
			}}
		>
			<h2 className="text-xl font-medium">{connection.name}</h2>
			<p className="text-sm text-muted-foreground">{connection.issuer}</p>
			<p className="text-sm">Connection ID: {connection.id}</p>
			<GroupMapping
				value={value}
				onChange={set}
				organizationId={organizationId}
			/>
			<Button type="submit" disabled={busy}>
				Save mapping
			</Button>
		</form>
	)
}
function Connections() {
	const result = useAtomValue(connectionsAtom)
	return (
		<Load result={result}>
			{(page) => (
				<div className="space-y-5">
					{page.items.length === 0 && (
						<p>
							No SSO connections are set up. A platform admin can use the
							platform provider, or add an organization connection through the
							SSO API.
						</p>
					)}
					{page.items.map((c) => (
						<Connection key={c.id + c.version} connection={c} />
					))}
				</div>
			)}
		</Load>
	)
}
export function OrganizationPage() {
	const account = useAtomValue(accountAtom)
	const organization = useAtomValue(organizationAtom)
	const [, setPage] = useAtom(pageAtom)
	const member =
		account._tag === "Success"
			? account.value.memberships.find((m) => m.organizationId === organization)
			: undefined
	if (
		!member?.roles.some(
			(r) =>
				r === "super_administrator" ||
				r === "administrator" ||
				r === "administrator_read_only" ||
				r.startsWith("role_"),
		)
	)
		return (
			<p className="p-10">
				You do not have permission to manage this organization.
			</p>
		)
	return (
		<main className="mx-auto w-full max-w-4xl space-y-6 overflow-y-auto p-6 md:p-10">
			<h1 className="text-3xl font-semibold">Organization settings</h1>
			<Tabs defaultValue="members" onValueChange={() => setPage(undefined)}>
				<TabsList>
					<TabsTrigger value="members">Members</TabsTrigger>
					<TabsTrigger value="invitations">Invitations</TabsTrigger>
					<TabsTrigger value="sso">SSO groups</TabsTrigger>
				</TabsList>
				<TabsContent value="members">
					<Members />
				</TabsContent>
				<TabsContent value="invitations">
					<Invites />
				</TabsContent>
				<TabsContent value="sso">
					<Connections />
				</TabsContent>
			</Tabs>
		</main>
	)
}
