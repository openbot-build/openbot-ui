import { BrowserCrypto } from "@effect/platform-browser"
import * as OpenBot from "@openbot-build/client"
import { Cause, Layer, Predicate } from "effect"
import * as Atom from "effect/reactivity/Atom"

/** The key in local storage that keeps the organization the person works in. */
const organizationKey = "openbot.organization"

const readOrganization = (): string | undefined => {
	try {
		return globalThis.localStorage?.getItem(organizationKey) ?? undefined
	} catch {
		return undefined
	}
}

/**
 * The organization that requests act in. The account may be a member of more
 * than one, so the client sends it in a header.
 */
export const organizationAtom = Atom.writable<string | undefined, string>(
	() => readOrganization(),
	(ctx, value) => {
		try {
			globalThis.localStorage?.setItem(organizationKey, value)
		} catch {
			// Storage can be blocked. The choice then lasts only for this page.
		}
		ctx.setSelf(value)
	},
)

/** Sends the browser to the sign-in page, and keeps the current page to come back to. */
export const goToSignIn = () => {
	const location = globalThis.location
	if (location === undefined || location.pathname.startsWith("/sign-in")) return
	const returnTo = location.pathname + location.search
	location.assign(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`)
}

/**
 * The runtime of every API atom. The OpenBot client runs on the same origin and
 * uses the session cookie. When the organization changes, the runtime and the
 * atoms that use it start again.
 */
export const apiRuntime = Atom.runtime((get) =>
	Layer.merge(
		BrowserCrypto.layer,
		OpenBot.layer({
			baseUrl: globalThis.location?.origin ?? "",
			organization: get(organizationAtom),
			onUnauthorized: goToSignIn,
		}),
	),
)

/** The typed client. Use it inside the effects of `apiRuntime` atoms. */
export const Api = OpenBot.Client

/** Makes a short message from an API failure for people to read. */
export const errorMessage = (cause: unknown): string => {
	const error = Cause.isCause(cause) ? Cause.squash(cause) : cause
	if (Predicate.isObject(error)) {
        if (Predicate.hasProperty(error, "_tag") && error._tag === "AccessDenied" && Predicate.hasProperty(error, "reason")) {
            switch(error.reason) {
                case "pending": return "Your request is waiting for approval. Sign in again after it is approved."
                case "closed": return "New account registration is closed. Contact an administrator for access."
                case "rejected": return "Your access request was declined. Contact an administrator."
                case "suspended": return "This account is suspended. Contact an administrator."
                case "rate_limited": return "Please wait a minute before trying again."
                case "invitation": return "This invitation is not valid for your email. Ask for a new invitation."
                case "identity": return "The code or identity could not be checked. Use a new code or your original sign-in provider."
                default: return "Access was not granted. Contact an administrator."
            }
        }
		if (Predicate.hasProperty(error, "message")) {
			const message = error.message
			if (Predicate.isString(message) && message.length > 0) return message
		}
		if (Predicate.hasProperty(error, "_tag") && Predicate.isString(error._tag))
			return describeTag(error._tag)
	}
	return "Something went wrong. Try again."
}

const describeTag = (tag: string): string => {
	switch (tag) {
		case "AuthenticationRequired":
			return "Sign in to go on."
		case "Forbidden":
			return "You do not have permission to do this."
		case "PolicyUnavailable":
			return "The server cannot check your permissions now. Try again soon."
		case "ChatNotFound":
			return "This chat does not exist."
		case "ChatConflict":
			return "The chat changed in another place. Reload and try again."
		case "ExecutionUnavailable":
		case "ChatExecutionUnavailable":
			return "The server cannot run work now. Try again soon."
		case "ChatStorageUnavailable":
			return "The server cannot read chats now. Try again soon."
		case "ToolCallNotFound":
		case "ExecutionNotFound":
			return "This work is not running any more."
		case "FilesUnavailable":
			return "The server cannot keep files now. Try again soon."
		case "LiveUnavailable":
			return "Live talk is not ready for this chat."
		case "BotNotFound":
			return "This Bot does not exist."
		case "OrganizationRequired":
			return "Choose an organization first."
		case "MembershipRequired":
			return "You are not a member of this organization."
		default:
			// Split a tag such as `ModelNotFound` into words.
			return tag.replace(/([a-z])([A-Z])/g, "$1 $2")
	}
}
