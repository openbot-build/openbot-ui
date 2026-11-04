import { useAtomSet } from "@effect/atom-react"
import { useState } from "react"
import { useSearchParams } from "react-router"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
	Card,
	CardContent,
	CardDescription,
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
import { LogoMark } from "@/components/app/Logo"
import { ConnectionSettings } from "@/components/app/ConnectionSettings"
import { errorMessage } from "@/lib/api"
import { nativeRuntime, returnPath } from "@/lib/runtime"

/** The sign-in page. OpenBot finds the sign-in provider from the email. */
export function SignInPage() {
	const localSignIn = nativeRuntime()?.developmentSignIn === true
	const [params] = useSearchParams()
	const returnTo = returnPath(params.get("returnTo"))
	const signIn = useAtomSet(signInAtom, { mode: "promise" })
	const [email, setEmail] = useState("")
	const [busy, setBusy] = useState(false)
	const fail = (cause: unknown) => {
		toast.error(errorMessage(cause))
		setBusy(false)
	}

	return (
		<main className="flex min-h-(--app-height) flex-col items-center justify-center gap-8 bg-background p-4">
			<div className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
				<LogoMark className="size-8" /> OpenBot
			</div>
			<Card className="w-full max-w-sm">
				<CardHeader className="text-center">
					<CardTitle className="text-lg">Welcome</CardTitle>
					<CardDescription>{localSignIn ? "Use the test account on your local OpenBot service." : "Sign in to work with your Bots."}</CardDescription>
				</CardHeader>
				<CardContent>
					<form
						onSubmit={(event) => {
							event.preventDefault()
							setBusy(true)
							signIn({ email: email.trim() || undefined, returnTo }).catch(fail)
						}}
					>
						<FieldGroup>
							{!localSignIn ? <Field>
								<FieldLabel htmlFor="email">Work email</FieldLabel>
								<Input
									id="email"
									type="email"
									autoComplete="email"
									value={email}
									onChange={(event) => setEmail(event.target.value)}
									placeholder="you@example.com"
								/>
								<FieldDescription>
									Your organization may use its own sign-in. We find it from
									your email.
								</FieldDescription>
							</Field> : null}
							<Field>
								<Button type="submit" size="lg" disabled={busy}>
									{busy ? <Spinner /> : null} {localSignIn ? "Sign in to the test account" : "Continue"}
								</Button>
							</Field>
							{import.meta.env.DEV && !nativeRuntime() ? (
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
			<ConnectionSettings />
		</main>
	)
}
