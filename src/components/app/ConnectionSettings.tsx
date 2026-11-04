import { type ReactNode, useId, useState } from "react"
import { Button } from "@/components/ui/button"
import {
	Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { nativeRuntime, normalizeServiceOrigin } from "@/lib/runtime"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LogoMark } from "@/components/app/Logo"

const recoveryMessages = {
	"invalid-settings": "Your saved service settings could not be used. Save a service address to replace them.",
	"unsupported-version": "Your service settings are from another app version. Update the app, or save an address to replace them.",
	"unreadable-settings": "Your service settings could not be read. Try again, or save a service address.",
}

/** Mount account and API screens only after the saved service is ready. */
export function ConnectionGate({ children }: { readonly children: ReactNode }) {
	const recovery = nativeRuntime()?.connection?.recovery
	if (!recovery) return children
	return (
		<main className="flex min-h-(--app-height) flex-col items-center justify-center gap-8 bg-background p-4">
			<div className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
				<LogoMark className="size-8" /> OpenBot
			</div>
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle><h1>Check your service settings</h1></CardTitle>
					<CardDescription>{recoveryMessages[recovery]}</CardDescription>
				</CardHeader>
				<CardContent><ConnectionForm /></CardContent>
			</Card>
		</main>
	)
}

/** Keep the service picker available before sign-in and when a service is down. */
export function ConnectionSettings() {
	if (!nativeRuntime()?.connection) return null
	return (
		<Dialog>
			<DialogTrigger render={<Button variant="ghost" />}>Service settings</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Service settings</DialogTitle>
					<DialogDescription>Choose the OpenBot service for this app.</DialogDescription>
				</DialogHeader>
				<ConnectionForm />
			</DialogContent>
		</Dialog>
	)
}

export function ConnectionForm() {
	const native = nativeRuntime()
	const connection = native?.connection
	const id = useId()
	const [origin, setOrigin] = useState(native?.apiOrigin ?? "")
	const [error, setError] = useState<string>()
	const [busy, setBusy] = useState(false)
	if (!connection || !native) return null
	const run = async (action: () => Promise<void>) => {
		setError(undefined)
		setBusy(true)
		try {
			await action()
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause))
			setBusy(false)
		}
	}
	const save = (value: string | null) => run(() =>
		connection.change(value === null ? null : normalizeServiceOrigin(value, native.development)))
	return (
		<form onSubmit={(event) => { event.preventDefault(); void save(origin) }}>
			<FieldGroup>
				<Field data-invalid={Boolean(error)}>
					<FieldLabel htmlFor={id}>Service address</FieldLabel>
					<Input id={id} type="url" autoComplete="url" autoCapitalize="none" spellCheck={false}
						value={origin} onChange={(event) => setOrigin(event.target.value)} disabled={busy}
						aria-invalid={Boolean(error)} aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`} required />
					<FieldDescription id={`${id}-help`}>
						Use the service address without an API path. Each service has its own sign-in.
					</FieldDescription>
					{error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
				</Field>
				<Field orientation="horizontal">
					<Button type="submit" disabled={busy}>{busy ? <Spinner /> : null} Save and connect</Button>
					<Button type="button" variant="ghost" disabled={busy} onClick={() => void save(null)}>Use default</Button>
				</Field>
				{connection.recovery && connection.retry ? (
					<Field><Button type="button" variant="ghost" disabled={busy}
						onClick={() => void run(connection.retry!)}>Retry saved settings</Button></Field>
				) : null}
				<FieldDescription className="break-all">Default: {connection.defaultOrigin}</FieldDescription>
			</FieldGroup>
		</form>
	)
}
