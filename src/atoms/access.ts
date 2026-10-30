import { Effect } from "effect"
import * as Atom from "effect/reactivity/Atom"
import { AccessApi, type Settings, OrganizationApi, type SsoApi } from "@openbot-build/client/Api"
import { Api, apiRuntime } from "@/lib/api"

export const accessKey = "account-access"
export const loginOptionsAtom = apiRuntime.atom(Effect.flatMap(Api, c => c.api.loginOptions.get()))
export const platformSettingsAtom = apiRuntime.atom(Effect.flatMap(Api, c => c.api.platform.getPlatformSettings())).pipe(Atom.withReactivity([accessKey]))
const pageQuery = (after: string | undefined) => ({ limit: 50, ...(after === undefined ? {} : { after }) })
export const pageAtom = Atom.make<string | undefined>(undefined)
export const usersAtom = apiRuntime.atom(get => Effect.flatMap(Api, c => c.api.access.users({ query: pageQuery(get(pageAtom)) }))).pipe(Atom.withReactivity([accessKey]))
export const requestsAtom = apiRuntime.atom(get => Effect.flatMap(Api, c => c.api.access.requests({ query: pageQuery(get(pageAtom)) }))).pipe(Atom.withReactivity([accessKey]))
export const grantsAtom = apiRuntime.atom(get => Effect.flatMap(Api, c => c.api.access.grants({ query: pageQuery(get(pageAtom)) }))).pipe(Atom.withReactivity([accessKey]))
export const auditAtom = apiRuntime.atom(get => Effect.flatMap(Api, c => c.api.access.audit({ query: pageQuery(get(pageAtom)) }))).pipe(Atom.withReactivity([accessKey]))
export type AccessAction =
 | { kind: "settings"; input: Settings.UpdatePlatformSettingsRequest }
 | { kind: "user"; id: string; status: "active" | "suspended" }
 | { kind: "decision"; id: string; version: number; status: "approved" | "rejected" }
 | { kind: "grant" | "revoke"; email: string; providerId: string }
export const accessActionAtom = apiRuntime.fn(Effect.fnUntraced(function* (action: AccessAction) {
 const c = yield* Api
 switch (action.kind) {
  case "settings": return yield* c.api.platform.updatePlatformSettings({ payload: action.input })
  case "user": return yield* c.api.access.updateUser({ params: { userId: action.id }, payload: { status: action.status } })
  case "decision": return yield* c.api.access.decide({ params: { requestId: action.id }, payload: { expectedVersion: action.version, status: action.status } })
  case "grant": return yield* c.api.access.grant({ payload: { email: action.email, providerId: action.providerId } })
  case "revoke": return yield* c.api.access.revokeGrant({ payload: { email: action.email, providerId: action.providerId } })
 }
}), { reactivityKeys: [accessKey] })
export const invitationsAtom = apiRuntime.atom(Effect.flatMap(Api, c => c.api.organizations.listMyInvitations())).pipe(Atom.withReactivity([accessKey]))
export const answerInviteAtom = apiRuntime.fn(Effect.fnUntraced(function* (input: { id: string; accept: boolean }) {
 const c = yield* Api
 return yield* input.accept ? c.api.organizations.acceptInvitation({ params: { invitationId: OrganizationApi.InvitationId.make(input.id) } }) : c.api.organizations.declineInvitation({ params: { invitationId: OrganizationApi.InvitationId.make(input.id) } })
}), { reactivityKeys: [accessKey] })
export const membersAtom = apiRuntime.atom(get => Effect.flatMap(Api, c => c.api.organization.listMembers({ query: pageQuery(get(pageAtom)) }))).pipe(Atom.withReactivity([accessKey]))
export const orgInvitesAtom = apiRuntime.atom(Effect.flatMap(Api, c => c.api.organization.listInvitations({ query: {} }))).pipe(Atom.withReactivity([accessKey]))
export const connectionsAtom = apiRuntime.atom(Effect.flatMap(Api, c => c.api.sso.listSsoConnections())).pipe(Atom.withReactivity([accessKey]))
export const rolesAtom = apiRuntime.atom(Effect.flatMap(Api, c => c.api.organization.listRoles()))
export type OrgAction =
 | { kind: "invite"; email: string }
 | { kind: "revoke" | "send"; id: string }
 | { kind: "member"; id: string; input: OrganizationApi.UpdateMemberRequest }
 | { kind: "sso"; id: string; input: SsoApi.UpdateSsoConnectionRequest }
export const orgActionAtom = apiRuntime.fn(Effect.fnUntraced(function* (action: OrgAction) {
 const c = yield* Api
 switch (action.kind) {
  case "invite": return yield* c.api.organization.createInvitation({ payload: { email: action.email } })
  case "revoke": return yield* c.api.organization.revokeInvitation({ params: { invitationId: OrganizationApi.InvitationId.make(action.id) } })
  case "send": return yield* c.api.organization.resendInvitation({ params: { invitationId: OrganizationApi.InvitationId.make(action.id) } })
  case "member": return yield* c.api.organization.updateMember({ params: { userId: action.id }, payload: action.input })
  case "sso": return yield* c.api.sso.updateSsoConnection({ params: { connectionId: action.id }, payload: action.input })
 }
}), { reactivityKeys: [accessKey] })

export type Preset = "public" | "invite" | "company" | "admin"
/** Presets fill visible fields. Save is a separate step. */
export const preset = (kind: Preset): AccessApi.Registration => ({
 ...AccessApi.defaults,
 selfService: kind === "public" ? "allow" : "closed",
 invitations: kind === "invite" || kind === "public" ? "allow" : "closed",
 sso: kind === "company" ? "allow" : "closed",
 provider: { ...AccessApi.providerDefaults, trusted: kind === "company" },
})

export const sendCodeAtom = apiRuntime.fn(Effect.fnUntraced(function* (input: { email: string; invitation?: string }) {
 const c = yield* Api
 return yield* c.api.emailSignIn.send({ payload: input })
}))
export const verifyCodeAtom = apiRuntime.fn(Effect.fnUntraced(function* (input: { challenge: string; code: string }) {
 const c = yield* Api
 return yield* c.api.emailSignIn.verify({ payload: input })
}))
