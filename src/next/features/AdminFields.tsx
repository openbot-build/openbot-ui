import { t } from "@lingui/core/macro"
import { Match } from "effect"
import { useId } from "react"
import type { AdminField } from "./AdminData"
import { readPath } from "./AdminData"
import type { JsonObject } from "./SchemaValues"
import { objectOf } from "./SchemaValues"

export function AdminFields({
	fields,
	draft,
	previous,
	onChange,
	disabled = false,
}: {
	readonly fields: ReadonlyArray<AdminField>
	readonly draft: JsonObject
	readonly previous: JsonObject | null
	readonly onChange: (path: string, value: unknown) => void
	readonly disabled?: boolean | undefined
}) {
	const id = useId()
	return (
		<fieldset className="admin-form-fields" disabled={disabled}>
			{fields.map((field) => {
				if (previous !== null && field.createOnly === true) return null
				const value = draft[field.path] ?? field.defaultValue
				const secretSet =
					field.type === "password" &&
					objectOf(readPath(previous, field.path))["set"] === true
				const required = field.required === true && !secretSet
				const inputId = `${id}-${field.path}`
				const hintId = `${inputId}-hint`
				const describedBy =
					field.hint !== undefined || secretSet ? hintId : undefined
				const input = Match.value(field.type ?? "text").pipe(
					Match.when("boolean", () => (
						<input
							id={inputId}
							aria-describedby={describedBy}
							type="checkbox"
							checked={value === true}
							disabled={field.readOnly}
							onChange={(event) => onChange(field.path, event.target.checked)}
						/>
					)),
					Match.when("choice", () => {
						const index =
							field.choices?.findIndex(
								(choice) =>
									JSON.stringify(choice.value) === JSON.stringify(value),
							) ?? -1
						return (
							<select
								id={inputId}
								aria-describedby={describedBy}
								value={index < 0 ? "" : String(index)}
								required={required}
								disabled={field.readOnly}
								onChange={(event) =>
									onChange(
										field.path,
										event.target.value === ""
											? ""
											: field.choices?.[Number(event.target.value)]?.value,
									)
								}
							>
								<option value="">
									{field.nullable === true ? t`Not set` : t`Choose…`}
								</option>
								{field.choices?.map((choice, choiceIndex) => (
									<option key={choiceIndex} value={choiceIndex}>
										{choice.label}
									</option>
								))}
							</select>
						)
					}),
					Match.when("multiple", () => (
						<div className="admin-choice-list">
							{field.choices?.length === 0 ? (
								<p>{t`No choices are available yet. Add the related service first.`}</p>
							) : (
								field.choices?.map((choice, index) => {
									const selected = Array.isArray(value) ? value : []
									const active = selected.some(
										(item) =>
											JSON.stringify(item) === JSON.stringify(choice.value),
									)
									return (
										<label key={index}>
											<input
												type="checkbox"
												checked={active}
												disabled={field.readOnly}
												onChange={(event) =>
													onChange(
														field.path,
														event.target.checked
															? [...selected, choice.value]
															: selected.filter(
																	(item) =>
																		JSON.stringify(item) !==
																		JSON.stringify(choice.value),
																),
													)
												}
											/>
											<span>{choice.label}</span>
										</label>
									)
								})
							)}
						</div>
					)),
					Match.when("lines", () => (
						<textarea
							id={inputId}
							aria-describedby={describedBy}
							rows={3}
							value={
								Array.isArray(value) ? value.join("\n") : String(value ?? "")
							}
							required={required}
							readOnly={field.readOnly}
							onChange={(event) => onChange(field.path, event.target.value)}
						/>
					)),
					Match.when("number", () => (
						<input
							id={inputId}
							aria-describedby={describedBy}
							type="number"
							value={String(value ?? "")}
							step="any"
							min={field.min}
							max={field.max}
							required={required}
							readOnly={field.readOnly}
							onChange={(event) => onChange(field.path, event.target.value)}
						/>
					)),
					Match.orElse((type) => (
						<input
							id={inputId}
							aria-describedby={describedBy}
							type={type}
							value={typeof value === "string" ? value : ""}
							required={required}
							readOnly={field.readOnly}
							autoComplete={type === "password" ? "new-password" : "off"}
							placeholder={
								secretSet ? t`Leave empty to keep the saved secret` : undefined
							}
							onChange={(event) => onChange(field.path, event.target.value)}
						/>
					)),
				)
				return (
					<div
						className={
							field.type === "boolean"
								? "admin-field admin-field-toggle"
								: "admin-field"
						}
						key={field.path}
					>
						{field.type === "multiple" ? (
							<fieldset aria-describedby={describedBy}>
								<legend>
									{field.label}
									{required ? " *" : ""}
								</legend>
								{input}
							</fieldset>
						) : (
							<label htmlFor={inputId}>
								<span>
									{field.label}
									{required ? " *" : ""}
								</span>
								{input}
							</label>
						)}
						<div id={hintId}>
							{field.hint !== undefined && <p>{field.hint}</p>}
							{secretSet && (
								<p>{t`A secret is saved. Its value is never shown here.`}</p>
							)}
						</div>
					</div>
				)
			})}
		</fieldset>
	)
}
