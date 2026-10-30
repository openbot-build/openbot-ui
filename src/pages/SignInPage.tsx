import { loginOptionsAtom, sendCodeAtom, verifyCodeAtom } from "@/atoms/access"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { useState } from "react"
import { useSearchParams } from "react-router"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/components/ui/card"
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
	FieldSeparator,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { developmentSignIn, signInAtom } from "@/atoms/account"
import { Logo } from "@/components/app/Logo"
import { errorMessage } from "@/lib/api"

import { safeReturn } from "@/lib/returnTo"

/** The sign-in page. OpenBot finds the sign-in provider from the email. */
export function SignInPage() {
	const [params] = useSearchParams()
	const returnTo = safeReturn(params.get("returnTo"))
    const options = useAtomValue(loginOptionsAtom)
    const invitation = params.get("invitation") ?? undefined
    const reason = params.get("reason")
    const notice = reason === "pending" ? "Your request is waiting for approval. Sign in again after an administrator approves it."
     : reason === "closed" ? "New account registration is closed. Contact an administrator for access."
     : reason === "suspended" ? "This account is suspended. Contact an administrator."
     : reason ? "Access was not granted. Check your invitation or contact an administrator."
     : options._tag === "Success" && options.value.selfService === "closed" ? "Sign in with an existing account, a valid invitation, or access granted by an administrator. Open registration is closed." : null
	const signIn = useAtomSet(signInAtom, { mode: "promise" })
	const [email, setEmail] = useState("")
	const [busy, setBusy] = useState(false)
    const [challenge, setChallenge] = useState<string>()
    const [code, setCode] = useState("")
    const sendCode = useAtomSet(sendCodeAtom, { mode: "promise" })
    const verifyCode = useAtomSet(verifyCodeAtom, { mode: "promise" })
    const emailReady = options._tag === "Success" && options.value.emailSignIn
    const oidcReady = options._tag === "Success" && options.value.oidc
	const fail = (cause: unknown) => {
		toast.error(errorMessage(cause))
		setBusy(false)
	}

	return (
		<main className="flex min-h-svh flex-col items-center justify-center gap-8 bg-background p-4">
			<div className="flex items-center gap-2.5 text-headline-small">
				<Logo />
			</div>
			<Card className="w-full max-w-sm">
				<CardHeader className="text-center">
					<CardTitle className="text-title-large">Welcome</CardTitle>
				</CardHeader>
				<CardContent>
                    {notice && <p role="status" className="mb-5 rounded-xl bg-muted p-4 text-body-medium">{notice}</p>}
					<form
						onSubmit={(event) => {
							event.preventDefault()
							setBusy(true)
							if (emailReady) {
                                if (challenge) verifyCode({ challenge, code }).then(() => globalThis.location.assign(returnTo), fail)
                                else sendCode({ email: email.trim(), ...(invitation ? { invitation } : {}) }).then(result => { setChallenge(result.challenge); setBusy(false) }, fail)
                            } else signIn({ email: email.trim() || undefined, returnTo, invitation }).catch(fail)
						}}
					>
						<FieldGroup>
							<Field>
								<FieldLabel htmlFor="email">Email</FieldLabel>
								<Input
									id="email"
									type="email"
									autoComplete="email"
                                    required={emailReady}
                                    disabled={challenge !== undefined}
									value={email}
									onChange={(event) => setEmail(event.target.value)}
									placeholder="you@example.com"
								/>
								<FieldDescription>
									{emailReady ? "We send a sign-in code to this email." : "Your organization may use its own sign-in. We find it from your email."}
								</FieldDescription>
							</Field>
							<Field>
								{challenge && <Field><FieldLabel htmlFor="code">Email code</FieldLabel><Input id="code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{8}" maxLength={8} required value={code} onChange={e => setCode(e.target.value)} /><FieldDescription>Enter the 8-digit code. It ends in 5 minutes and can be used once.</FieldDescription></Field>}
                                <Button type="submit" size="lg" disabled={busy || (!emailReady && !oidcReady)}>{busy ? <Spinner /> : null} {emailReady ? challenge ? "Sign in" : "Send email code" : "Continue"}</Button>
                                {challenge && <Button type="button" variant="ghost" disabled={busy} onClick={() => { setChallenge(undefined); setCode("") }}>Use another email or send a new code</Button>}
                                {emailReady && oidcReady && <Button type="button" variant="secondary" disabled={busy} onClick={() => { setBusy(true); signIn({ email: email.trim() || undefined, returnTo, invitation }).catch(fail) }}>Use company sign-in</Button>}
                                {options._tag === "Success" && !emailReady && !oidcReady && <p role="status">Sign-in is not set up yet. Contact your administrator.</p>}
							</Field>
							{import.meta.env.DEV ? (
								<>
									<FieldSeparator>Development</FieldSeparator>
									<Field>
										<Button
											type="button"
											variant="outline"
											size="lg"
											disabled={busy}
											onClick={() => {
												setBusy(true)
												developmentSignIn(returnTo).catch(fail)
											}}
										>
											Sign in to the test account
										</Button>
									</Field>
								</>
							) : null}
						</FieldGroup>
					</form>
				</CardContent>
			</Card>
		</main>
	)
}
