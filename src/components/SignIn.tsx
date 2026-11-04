import { t } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { useState, type FormEvent } from "react"
import { useLocation } from "react-router"
import { nativeRuntime, returnPath } from "../lib/runtime"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Field, FieldGroup, FieldLabel } from "./ui/field"
import { Language } from "./Language"
import { ConnectionSettings } from "./ConnectionSettings"

export function SignIn() {
	useLingui()
	const location = useLocation()
	const returnTo = returnPath(
		new URLSearchParams(location.search).get("returnTo") ?? "/",
	)
	const [email, setEmail] = useState("")
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const signIn = async (development = false) => {
		setBusy(true)
		setError(null)
		try {
			const native = nativeRuntime()
			if (native !== undefined) {
				await native.signIn({ ...(email ? { email } : {}), returnTo })
				window.location.assign(returnTo)
				return
			}
			const response = await fetch(
				development ? "/auth/development/sign-in" : "/auth/sign-in",
				{
					method: "POST",
					credentials: "same-origin",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(
						development ? {} : { ...(email ? { email } : {}), returnTo },
					),
				},
			)
			if (!response.ok) throw new Error(t`Could not sign in. Try again.`)
			if (development) window.location.assign(returnTo)
			else {
				const result: unknown = await response.json()
				if (
					typeof result !== "object" ||
					result === null ||
					!("url" in result) ||
					typeof result.url !== "string"
				)
					throw new Error(t`Could not sign in. Try again.`)
				const destination = new URL(result.url, window.location.origin)
				if (!["https:", "http:"].includes(destination.protocol))
					throw new Error(t`Could not sign in. Try again.`)
				window.location.assign(destination.href)
			}
		} catch (failure) {
			setError(
				failure instanceof Error
					? failure.message
					: t`Could not sign in. Try again.`,
			)
		} finally {
			setBusy(false)
		}
	}
	return (
		<main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
			<h1 className="text-3xl font-medium">{t`Sign in`}</h1>
			<form
				onSubmit={(event: FormEvent) => {
					event.preventDefault()
					void signIn()
				}}
			>
				<FieldGroup>
					<Field data-disabled={busy || undefined}>
						<FieldLabel htmlFor="email">{t`Email`}</FieldLabel>
						<Input
							id="email"
							type="email"
							autoComplete="email"
							disabled={busy}
							value={email}
							onChange={(event) => setEmail(event.target.value)}
						/>
					</Field>
					{error === null ? null : <p role="alert">{error}</p>}
					<Button type="submit" disabled={busy}>
						{busy ? t`Signing in…` : t`Continue`}
					</Button>
					{import.meta.env.DEV && nativeRuntime() === undefined ? (
						<Button
							type="button"
							variant="outline"
							disabled={busy}
							onClick={() => {
								void signIn(true)
							}}
						>{t`Use the local test account`}</Button>
					) : null}
				</FieldGroup>
			</form>
			<Language />
			<ConnectionSettings />
		</main>
	)
}
