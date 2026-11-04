import { type ReactNode, useId, useRef, useState } from "react"
import { t } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { nativeRuntime, normalizeServiceOrigin } from "../lib/runtime"
import { Surface } from "./Surface"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "./ui/field"

/** Read no account data until the native shell has a usable service address. */
export function ConnectionGate({ children }: { readonly children: ReactNode }) {
	useLingui()
	const recovery = nativeRuntime()?.connection?.recovery
	if (recovery === undefined) return children
	const message =
		recovery === "invalid-settings"
			? t`Your saved service settings could not be used. Save a service address to replace them.`
			: recovery === "unsupported-version"
				? t`Your service settings are from another app version. Update the app, or save an address to replace them.`
				: t`Your service settings could not be read. Try again, or save a service address.`
	return (
		<main className="mx-auto flex min-h-(--app-height) max-w-md flex-col justify-center gap-6 p-6">
			<h1 className="text-2xl font-medium">{t`Check your service settings`}</h1>
			<p>{message}</p>
			<ConnectionForm />
		</main>
	)
}

export function ConnectionSettings() {
	useLingui()
	const [open, setOpen] = useState(false)
	if (nativeRuntime()?.connection === undefined) return null
	return (
		<>
			<Button
				variant="ghost"
				onClick={() => setOpen(true)}
			>{t`Service settings`}</Button>
			<Surface
				open={open}
				onOpenChange={setOpen}
				title={t`Service settings`}
				description={t`Choose the OpenBot service for this app.`}
			>
				<ConnectionForm />
			</Surface>
		</>
	)
}

function ConnectionForm() {
	useLingui()
	const native = nativeRuntime()
	const connection = native?.connection
	const id = useId()
	const [origin, setOrigin] = useState(native?.apiOrigin ?? "")
	const [error, setError] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)
	const lock = useRef(false)
	if (connection === undefined || native === undefined) return null
	const run = async (action: () => Promise<void>) => {
		if (lock.current) return
		lock.current = true
		setError(null)
		setBusy(true)
		try {
			await action()
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause))
		} finally {
			lock.current = false
			setBusy(false)
		}
	}
	const save = (value: string | null) =>
		run(() =>
			connection.change(
				value === null
					? null
					: normalizeServiceOrigin(value, native.development),
			),
		)
	return (
		<form
			onSubmit={(event) => {
				event.preventDefault()
				void save(origin)
			}}
		>
			<FieldGroup>
				<Field data-invalid={error !== null || undefined}>
					<FieldLabel htmlFor={id}>{t`Service address`}</FieldLabel>
					<Input
						id={id}
						type="url"
						autoComplete="url"
						autoCapitalize="none"
						spellCheck={false}
						required
						disabled={busy}
						value={origin}
						onChange={(event) => setOrigin(event.target.value)}
						aria-invalid={error !== null}
						aria-describedby={`${id}-help${error === null ? "" : ` ${id}-error`}`}
					/>
					<FieldDescription
						id={`${id}-help`}
					>{t`Use the service address without an API path. Each service has its own sign-in.`}</FieldDescription>
					{error === null ? null : (
						<FieldError id={`${id}-error`}>{error}</FieldError>
					)}
				</Field>
				<Field orientation="horizontal">
					<Button type="submit" disabled={busy}>{t`Save and connect`}</Button>
					<Button
						type="button"
						variant="ghost"
						disabled={busy}
						onClick={() => {
							void save(null)
						}}
					>{t`Use default`}</Button>
				</Field>
				{connection.recovery !== undefined && connection.retry !== undefined ? (
					<Button
						type="button"
						variant="ghost"
						disabled={busy}
						onClick={() => {
							void run(connection.retry!)
						}}
					>{t`Retry saved settings`}</Button>
				) : null}
				<FieldDescription className="break-all">
					{t`Default service`}: {connection.defaultOrigin}
				</FieldDescription>
			</FieldGroup>
		</form>
	)
}
