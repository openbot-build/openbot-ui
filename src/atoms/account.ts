import { Effect } from "effect"
import * as Atom from "effect/reactivity/Atom"
import { Api, apiRuntime } from "@/lib/api"

/** The signed-in account, with its organizations. It fails when nobody signed in. */
export const accountAtom = apiRuntime.atom(
	Effect.gen(function* () {
		const client = yield* Api
		return yield* client.api.account.session()
	}),
)

/** Starts a browser sign-in. On success the browser goes to the sign-in provider. */
export const signInAtom = apiRuntime.fn(
	Effect.fnUntraced(function* (input: {
		readonly email?: string
		readonly returnTo?: string
	}) {
		const client = yield* Api
		const start = yield* client.api.signIn.signIn({
			payload: {
				...(input.email ? { email: input.email } : {}),
				...(input.returnTo ? { returnTo: input.returnTo } : {}),
			},
		})
		yield* Effect.sync(() => globalThis.location.assign(start.url))
	}),
)

/**
 * The development server signs everyone in to one local account. This route is
 * not in the API contract, because only the development server has it.
 */
export const developmentSignIn = (returnTo: string) =>
	fetch("/auth/development/sign-in", {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json" },
		body: "{}",
	}).then((response) => {
		if (!response.ok) throw new Error("The development sign-in failed.")
		globalThis.location.assign(returnTo)
	})

/** Better Auth serves the sign-out route. It is not in the API contract. */
export const signOut = () =>
	fetch("/auth/sign-out", {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json" },
		body: "{}",
	}).finally(() => globalThis.location.assign("/sign-in"))

/** The initials of a name or an email, for the avatar. */
export const initials = (
	name: string | undefined,
	email: string | undefined,
) => {
	const source = (name ?? email ?? "?").trim()
	const words = source.split(/[\s@._-]+/).filter((word) => word.length > 0)
	return (
		words
			.slice(0, 2)
			.map((word) => word[0]?.toUpperCase())
			.join("") || "?"
	)
}

/** Keeps the chosen theme of the person. */
export type Theme = "system" | "light" | "dark"
const themeKey = "openbot.theme"

const readTheme = (): Theme => {
	try {
		const value = globalThis.localStorage?.getItem(themeKey)
		return value === "light" || value === "dark" || value === "system"
			? value
			: "dark"
	} catch {
		return "dark"
	}
}

/** Puts the `dark` class on the page when the theme is dark. */
export const applyTheme = (theme: Theme) => {
	const root = globalThis.document?.documentElement
	if (root === undefined) return
	const dark =
		theme === "dark" ||
		(theme === "system" &&
			globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches)
	root.classList.toggle("dark", dark)
	root.style.colorScheme = dark ? "dark" : "light"
}

export const themeAtom = Atom.writable<Theme, Theme>(
	() => readTheme(),
	(ctx, theme) => {
		try {
			globalThis.localStorage?.setItem(themeKey, theme)
		} catch {
			// Storage can be blocked. The theme then lasts only for this page.
		}
		applyTheme(theme)
		ctx.setSelf(theme)
	},
)

/** Makes an organization. The person becomes its Super Administrator. */
export const createOrganizationAtom = apiRuntime.fn(
	Effect.fnUntraced(function* (name: string) {
		const client = yield* Api
		return yield* client.api.organizations.createOrganization({
			payload: { name },
		})
	}),
)
