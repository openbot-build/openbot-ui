import { t } from "@lingui/core/macro"
import { useState } from "react"
import { Button } from "../../components/ui/button"
import type { FeatureInput } from "./FeatureData"
import {
	connectionChoices,
	connectionCommand,
	defaultConnectionChoice,
	type ImportedEntry,
} from "./ImportConnectionsData"

function DraftConnection({
	entry,
	disabled,
	completed,
	onCreate,
}: {
	readonly entry: ImportedEntry
	readonly disabled: boolean
	readonly completed: boolean
	readonly onCreate: (input: FeatureInput) => Promise<void>
}) {
	const choices = connectionChoices(entry)
	const [selected, setSelected] = useState(() => defaultConnectionChoice(entry))
	const [name, setName] = useState(
		entry.draft?.imported?.name ?? entry.entry.name,
	)
	const [values, setValues] = useState<Readonly<Record<string, string>>>({})
	const [confirmed, setConfirmed] = useState(false)
	const choice = choices[selected]
	if (entry.draft === null)
		return (
			<article className="feature-record">
				<strong>{entry.entry.name}</strong>
				<p role="alert">{entry.error ?? t`This app could not be prepared.`}</p>
			</article>
		)
	const expired = entry.draft.expiresAt <= Date.now()
	if (completed)
		return (
			<article className="feature-record">
				<strong>{name}</strong>
				<p role="status">{t`Connection added. Verify it or authorize account access next.`}</p>
			</article>
		)
	return (
		<form
			className="feature-command"
			onSubmit={(event) => {
				event.preventDefault()
				if (disabled || !confirmed || expired || choice === undefined) return
				void onCreate(connectionCommand({ entry, choice, name, values }))
			}}
		>
			<h3>{entry.entry.name}</h3>
			<p>{t`Review this imported app before adding it. Credentials are not included in the export.`}</p>
			{choices.length > 1 && (
				<label className="feature-field">
					<span>{t`Connection endpoint`}</span>
					<select
						value={selected}
						disabled={disabled}
						onChange={(event) => {
							setSelected(Number(event.target.value))
							setValues({})
							setConfirmed(false)
						}}
					>
						{choices.map((item, index) => (
							<option key={index} value={index}>
								{item.name} ·{" "}
								{String(item.endpoint.remote["url"] ?? item.cardUrl)}
							</option>
						))}
					</select>
				</label>
			)}
			{choice !== undefined && (
				<>
					<p className="feature-help">
						{String(choice.endpoint.remote["url"] ?? choice.cardUrl)}
					</p>
					<label className="feature-field">
						<span>{t`App name`}</span>
						<input
							required
							maxLength={80}
							value={name}
							onChange={(event) => {
								setName(event.target.value)
								setConfirmed(false)
							}}
						/>
					</label>
					{choice.endpoint.requirements.map((requirement) => (
						<label className="feature-field" key={requirement.key}>
							<span>
								{requirement.description ??
									requirement.key.replace(/^(header|variable):/, "")}
							</span>
							{requirement.choices !== undefined &&
							requirement.choices !== null &&
							requirement.choices.length > 0 ? (
								<select
									required
									value={values[requirement.key] ?? ""}
									onChange={(event) => {
										setValues({
											...values,
											[requirement.key]: event.target.value,
										})
										setConfirmed(false)
									}}
								>
									<option value="">{t`Choose…`}</option>
									{requirement.choices.map((choice) => (
										<option key={choice} value={choice}>
											{choice}
										</option>
									))}
								</select>
							) : (
								<input
									required
									type={requirement.isSecret ? "password" : "text"}
									autoComplete="off"
									value={values[requirement.key] ?? ""}
									onChange={(event) => {
										setValues({
											...values,
											[requirement.key]: event.target.value,
										})
										setConfirmed(false)
									}}
								/>
							)}
						</label>
					))}
				</>
			)}
			{expired ? (
				<p role="alert">{t`This draft has expired. Import the app again to review its current details.`}</p>
			) : (
				<label className="feature-field">
					<span>
						<input
							type="checkbox"
							checked={confirmed}
							disabled={disabled}
							onChange={(event) => setConfirmed(event.target.checked)}
						/>
						{t`I reviewed this connection and want to add it.`}
					</span>
				</label>
			)}
			<Button
				type="submit"
				disabled={disabled || !confirmed || expired || choice === undefined}
			>{t`Add connection`}</Button>
		</form>
	)
}
export function ImportConnections({
	entries,
	disabled,
	completed,
	onCreate,
}: {
	readonly entries: ReadonlyArray<ImportedEntry>
	readonly disabled: boolean
	readonly completed: ReadonlyArray<string>
	readonly onCreate: (input: FeatureInput) => Promise<void>
}) {
	return (
		<section aria-label={t`Imported apps`}>
			{entries.map((entry, index) => (
				<DraftConnection
					key={entry.draft?.id ?? index}
					entry={entry}
					disabled={disabled}
					completed={entry.draft !== null && completed.includes(entry.draft.id)}
					onCreate={onCreate}
				/>
			))}
		</section>
	)
}
