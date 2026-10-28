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
import { errorMessage } from "@/lib/api"

/** A same-origin path to come back to. Other values go to the start page. */
const safeReturn = (value: string | null) =>
	value !== null && value.startsWith("/") && !value.startsWith("//")
		? value
		: "/"

/** The sign-in page. OpenBot finds the sign-in provider from the email. */
export function SignInPage() {
	const [params] = useSearchParams()
	const returnTo = safeReturn(params.get("returnTo"))
	const signIn = useAtomSet(signInAtom, { mode: "promise" })
	const [email, setEmail] = useState("")
	const [busy, setBusy] = useState(false)
	const fail = (cause: unknown) => {
		toast.error(errorMessage(cause))
		setBusy(false)
	}

	return (
		<main className="flex min-h-svh flex-col items-center justify-center gap-8 bg-background p-4">
			<div className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
				<LogoMark className="size-8" /> OpenBot
			</div>
			<Card className="w-full max-w-sm">
				<CardHeader className="text-center">
					<CardTitle className="text-lg">Welcome</CardTitle>
					<CardDescription>Sign in to work with your Bots.</CardDescription>
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
							<Field>
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
							</Field>
							<Field>
								<Button type="submit" size="lg" disabled={busy}>
									{busy ? <Spinner /> : null} Continue
								</Button>
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
