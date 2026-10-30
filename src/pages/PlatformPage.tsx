import { useAtom, useAtomSet, useAtomValue, useAtomRefresh } from "@effect/atom-react"
import { useState } from "react"
import { toast } from "sonner"
import { AccessApi, type Settings } from "@openbot-build/client/Api"
import { Schema } from "effect"
import { accessActionAtom, platformSettingsAtom, usersAtom, requestsAtom, grantsAtom, auditAtom, pageAtom, preset, type Preset } from "@/atoms/access"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Choice, TextField, Load, Pager, words } from "@/components/admin/Fields"
import { GroupMapping } from "@/components/admin/GroupMapping"
import { errorMessage } from "@/lib/api"

const modes = [{ value: "closed", label: "Closed" }, { value: "allow", label: "Direct access" }, { value: "approval", label: "Needs approval" }] as const
function SettingsForm({ settings }: { settings: Settings.PlatformSettings }) {
 const [value, set] = useState(settings.registration)
 const [creation, setCreation] = useState(settings.organizationCreation)
 const [busy, setBusy] = useState(false)
 const save = useAtomSet(accessActionAtom, { mode: "promise" })
 const refresh = useAtomRefresh(platformSettingsAtom)
 const change = (p: Partial<AccessApi.Registration>) => set(v => ({ ...v, ...p }))
 return <form className="space-y-6 rounded-panel nested-controls bg-card p-(--surface-inset)" onSubmit={e => {
 e.preventDefault()
 const checked = Schema.decodeUnknownOption(AccessApi.Registration)(value)
 if (checked._tag === "None") { toast.error("Check the domains, groups and roles."); return }
 setBusy(true)
 save({ kind: "settings", input: { expectedVersion: settings.version, registration: checked.value, organizationCreation: creation } }).then(() => toast.success("Access settings saved."), e => toast.error(errorMessage(e))).finally(() => setBusy(false))
 }}>
 <h2 className="text-title-large font-medium">Account access</h2>
 <label className="flex items-center gap-3"><Switch checked={value.emailSignIn} onCheckedChange={emailSignIn => change({ emailSignIn })} />Enable email code sign-in (requires outgoing mail)</label>
 <div className="flex flex-wrap gap-2">{([{ id: "public", name: "Public service" }, { id: "invite", name: "Invite only" }, { id: "company", name: "Company SSO" }, { id: "admin", name: "Admin grants" }] as const).map(p => <Button type="button" variant="secondary" key={p.id} onClick={() => { set(preset(p.id as Preset)); setCreation("platform_admins") }}>{p.name}</Button>)}</div>
 <p className="text-body-medium text-muted-foreground">A preset fills these fields. Review them, then save. Existing accounts keep access unless suspended.</p>
 <div className="grid gap-5 md:grid-cols-3">{(["selfService", "invitations", "sso"] as const).map((key, i) => <Choice key={key} label={["Self-service sign-up", "New accounts through invites", "Trusted SSO sign-up"][i]!} value={value[key]} choices={modes} onChange={v => change({ [key]: v })} />)}</div>
 <Choice label="Who can create organizations" value={creation} choices={[{ value: "platform_admins", label: "Platform admins" }, { value: "anyone", label: "All active accounts" }]} onChange={setCreation} />
 <TextField label="Allowed email domains" value={value.allowedEmailDomains.join(", ")} onChange={v => change({ allowedEmailDomains: words(v.toLowerCase()) })} hint="Leave empty for any domain. Subdomains do not match their parent domain." />
 <label className="flex items-center gap-3"><Switch checked={value.allowExternalInvitations} onCheckedChange={v => change({ allowExternalInvitations: v })} />Allow organization invites outside these domains</label>
 <TextField label="Trusted organization SSO connection IDs" value={value.trustedSsoProviders.join(", ")} onChange={v => change({ trustedSsoProviders: words(v) })} hint="Only these connections may use the trusted SSO sign-up policy." />
 <h3 className="text-title-large font-medium">Platform identity provider</h3>
 <GroupMapping value={value.provider} onChange={provider => change({ provider })} platform />
 <div className="flex gap-2"><Button disabled={busy} type="submit">Save settings</Button><Button type="button" variant="secondary" onClick={refresh}>Reload saved settings</Button></div>
 </form>
}
function UserList() {
 const result = useAtomValue(usersAtom)
 const [, setPage] = useAtom(pageAtom)
 const action = useAtomSet(accessActionAtom, { mode: "promise" })
 const [busy, setBusy] = useState<string>()
 return <Load result={result}>{page => <><p className="mb-4 text-body-medium text-muted-foreground">Suspending an account revokes its sessions and API keys. Restoring it requires a new sign-in and new keys.</p><div className="space-y-3">{page.items.map(u => <div className="flex flex-wrap items-center justify-between gap-3 rounded-action-panel nested-controls bg-muted p-(--action-inset)" key={u.id}><div><p>{u.name || u.email}</p><p className="text-body-medium text-muted-foreground">{u.email} · {u.status}</p></div><Button variant="secondary" disabled={busy !== undefined} onClick={() => { setBusy(u.id); action({ kind: "user", id: u.id, status: u.status === "active" ? "suspended" : "active" }).catch(e => toast.error(errorMessage(e))).finally(() => setBusy(undefined)) }}>{u.status === "active" ? "Suspend" : "Restore"}</Button></div>)}</div><Pager next={page.next} onPage={setPage} /></>}</Load>
}
function RequestList() {
 const result = useAtomValue(requestsAtom)
 const [, setPage] = useAtom(pageAtom)
 const action = useAtomSet(accessActionAtom, { mode: "promise" })
 const refresh = useAtomRefresh(requestsAtom)
 const [busy, setBusy] = useState(false)
 return <Load result={result}>{page => <><p className="mb-4 text-body-medium text-muted-foreground">Approval takes effect after the next successful sign-in. Current access rules still apply. You can change a previous decision.</p>{page.items.length === 0 && <p>No registration requests.</p>}<div className="space-y-3">{page.items.map(r => <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-action-panel nested-controls bg-muted p-(--action-inset)"><div><p>{r.email}</p><p className="text-body-medium text-muted-foreground">{r.providerId} · {r.source} · {r.status}</p></div><div className="flex gap-2">{(["approved", "rejected"] as const).map(status => <Button key={status} variant="secondary" disabled={busy || r.status === status} onClick={() => { setBusy(true); action({ kind: "decision", id: r.id, version: r.version, status }).catch(e => { toast.error(errorMessage(e)); refresh() }).finally(() => setBusy(false)) }}>{status === "approved" ? "Approve" : "Reject"}</Button>)}</div></div>)}</div><Pager next={page.next} onPage={setPage} /></>}</Load>
}
function GrantList() {
 const result = useAtomValue(grantsAtom)
 const [, setPage] = useAtom(pageAtom)
 const action = useAtomSet(accessActionAtom, { mode: "promise" })
 const [email, setEmail] = useState("")
 const settings = useAtomValue(platformSettingsAtom)
 const [providerId, setProvider] = useState(settings._tag === "Success" && settings.value.registration.emailSignIn && settings.value.identityProvider === null ? "email" : "oidc")
 const [busy, setBusy] = useState(false)
 return <div className="space-y-6"><p className="text-body-medium text-muted-foreground">Grant permission to create one account after its provider verifies this email. A grant does not restore a suspended account or bypass domain and group rules.</p><form className="grid items-end gap-4 md:grid-cols-3" onSubmit={e => { e.preventDefault(); setBusy(true); action({ kind: "grant", email: email.trim(), providerId: providerId.trim() }).then(() => setEmail(""), e => toast.error(errorMessage(e))).finally(() => setBusy(false)) }}><TextField label="Verified email" value={email} onChange={setEmail} /><TextField label="Provider ID" value={providerId} onChange={setProvider} hint="oidc, email, or an SSO connection ID" /><Button disabled={busy || !email || !providerId} type="submit">Grant first access</Button></form><Load result={result}>{page => <><div className="space-y-3">{page.items.map(g => <div className="flex items-center justify-between gap-3 rounded-action-panel nested-controls bg-muted p-(--action-inset)" key={g.email + g.providerId}><span>{g.email} · {g.providerId}</span><Button disabled={busy} variant="secondary" onClick={() => { setBusy(true); action({ kind: "revoke", email: g.email, providerId: g.providerId }).catch(e => toast.error(errorMessage(e))).finally(() => setBusy(false)) }}>Revoke</Button></div>)}</div><Pager next={page.next} onPage={setPage} /></>}</Load></div>
}
function AuditList() {
 const result = useAtomValue(auditAtom)
 const [, setPage] = useAtom(pageAtom)
 return <Load result={result}>{page => <><div className="overflow-x-auto"><table className="w-full text-left text-body-medium"><thead><tr>{["Time", "Action", "Actor", "Subject"].map(h => <th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>{page.items.map(e => <tr className="odd:bg-muted" key={e.id}><td className="p-3 whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</td><td className="p-3">{e.action}</td><td className="p-3 break-all">{e.actor}</td><td className="p-3 break-all">{e.subject}</td></tr>)}</tbody></table></div><Pager next={page.next} onPage={setPage} /></>}</Load>
}
export function PlatformPage() {
 const settings = useAtomValue(platformSettingsAtom)
 const [, setPage] = useAtom(pageAtom)
 return <Tabs defaultValue="settings" onValueChange={() => setPage(undefined)}><TabsList className="flex flex-wrap h-auto">{["settings", "users", "requests", "grants", "audit"].map(t => <TabsTrigger value={t} key={t}>{({settings:"Access settings",users:"Users",requests:"Approvals",grants:"First access",audit:"Audit"})[t]}</TabsTrigger>)}</TabsList><TabsContent value="settings"><Load result={settings}>{s => <SettingsForm key={s.version} settings={s} />}</Load></TabsContent><TabsContent value="users"><UserList /></TabsContent><TabsContent value="requests"><RequestList /></TabsContent><TabsContent value="grants"><GrantList /></TabsContent><TabsContent value="audit"><AuditList /></TabsContent></Tabs>
}
