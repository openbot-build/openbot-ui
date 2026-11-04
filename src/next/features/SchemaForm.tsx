import { t } from "@lingui/core/macro"
import { useEffect, useId, useState } from "react"

import {
	objectOf,
	words,
	secretField,
	literal,
	resolveSchema,
	seedWithRoot,
	variantIndex,
	type JsonObject,
} from "./SchemaValues"
export {
	objectOf,
	words,
	secretField,
	resolveSchema,
	seed,
	seedWithRoot,
	type JsonObject,
} from "./SchemaValues"

function JsonInput({
	value,
	onChange,
	required,
	label,
}: {
	readonly value: unknown
	readonly onChange: (value: unknown) => void
	readonly required: boolean
	readonly label: string
}) {
	const serialized = value === undefined ? "" : JSON.stringify(value, null, 2)
	const [text, setText] = useState(serialized)
	useEffect(() => setText(serialized), [serialized])
	return (
		<textarea
			className="feature-json-input"
			aria-label={label}
			rows={6}
			spellCheck={false}
			required={required}
			value={text}
			onChange={(event) => {
				const raw = event.target.value
				setText(raw)
				try {
					const next = raw.trim() === "" ? undefined : JSON.parse(raw)
					event.currentTarget.setCustomValidity("")
					onChange(next)
				} catch {
					event.currentTarget.setCustomValidity(
						t`Enter valid JSON before continuing.`,
					)
				}
			}}
		/>
	)
}

function propertyLabel(name: string): string {
	const labels: Record<string, string> = {
		name: t`Name`,
		title: t`Title`,
		description: t`Description`,
		text: t`Text`,
		botId: "Kay Bot",
		chatId: t`Conversation`,
		fileId: t`File`,
		computerId: t`Computer`,
		requestId: t`Request`,
		connectionId: t`Connection`,
		triggerId: t`Automation`,
		expected: t`Current revision`,
		expectedVersion: t`Current version`,
		decision: t`Decision`,
		reason: t`Reason`,
		rule: t`Remember this rule`,
		scope: t`Scope`,
		shared: t`Available to organization members`,
		availability: t`Organizations with access`,
		modelOwner: t`Model catalog scope`,
		enabled: t`Enabled`,
		status: t`Status`,
		url: t`Address`,
		endpoint: t`Server address`,
		apiKey: t`API key`,
		path: t`Path`,
		content: t`Content`,
		input: t`Input`,
		limit: t`Items per page`,
		cursor: t`Next page cursor`,
		after: t`After`,
		before: t`Before`,
	}
	return labels[name] ?? words(name)
}

export function SchemaField({
	schema,
	root = schema,
	value,
	onChange,
	name,
	required = false,
	depth = 0,
	references = {},
	preserveEmpty = false,
}: {
	readonly schema: JsonObject
	readonly root?: JsonObject
	readonly value: unknown
	readonly onChange: (value: unknown) => void
	readonly name: string
	readonly required?: boolean
	readonly depth?: number
	readonly references?: Readonly<
		Record<
			string,
			ReadonlyArray<{ readonly value: string; readonly label: string }>
		>
	>
	readonly preserveEmpty?: boolean
}) {
	const id = useId()
	const resolved = resolveSchema(schema, root)
	const label =
		typeof resolved["title"] === "string"
			? resolved["title"]
			: propertyLabel(name)
	const description =
		typeof resolved["description"] === "string"
			? resolved["description"]
			: undefined
	const [advanced, setAdvanced] = useState(false)
	if (resolved["readOnly"] === true) return null
	if (literal(resolved) !== undefined)
		return (
			<div className="feature-fixed">
				<span>{label}</span>
				<code>{String(literal(resolved))}</code>
			</div>
		)
	const variants = Array.isArray(resolved["oneOf"])
		? resolved["oneOf"]
		: Array.isArray(resolved["anyOf"])
			? resolved["anyOf"]
			: []
	const choices = variants.map((variant) =>
		resolveSchema(objectOf(variant), root),
	)
	if (
		!required &&
		value === undefined &&
		(choices.length > 0 ||
			resolved["type"] === "object" ||
			resolved["type"] === "array")
	)
		return (
			<div className="feature-optional">
				<button
					type="button"
					className="feature-text-button"
					onClick={() => onChange(seedWithRoot(resolved, root) ?? {})}
				>{t`Add ${label}`}</button>
				{description && <small>{description}</small>}
			</div>
		)
	if (choices.length > 0 && !advanced && depth < 8) {
		const chosen = variantIndex(choices, value, root)
		return (
			<fieldset className="feature-field feature-union">
				<legend>{label}</legend>
				<select
					aria-label={label}
					value={chosen}
					onChange={(event) => {
						const choice = choices[Number(event.target.value)] ?? {}
						onChange(
							choice["type"] === "null" ? null : seedWithRoot(choice, root),
						)
					}}
				>
					{choices.map((choice, index) => (
						<option key={index} value={index}>
							{String(
								choice["title"] ??
									literal(objectOf(objectOf(choice["properties"])["_tag"])) ??
									literal(objectOf(objectOf(choice["properties"])["type"])) ??
									choice["type"] ??
									t`Option ${index + 1}`,
							)}
						</option>
					))}
				</select>
				{choices[chosen] !== undefined &&
					choices[chosen]?.["type"] !== "null" && (
						<SchemaField
							key={chosen}
							schema={choices[chosen]!}
							root={root}
							value={value}
							onChange={onChange}
							name={name}
							required={required}
							depth={depth + 1}
							references={references}
							preserveEmpty={preserveEmpty}
						/>
					)}
				{choices[chosen]?.["type"] === "null" && (
					<p className="feature-help">{t`No value`}</p>
				)}
				{!required && (
					<button
						type="button"
						className="feature-text-button"
						onClick={() => onChange(undefined)}
					>{t`Remove optional value`}</button>
				)}
			</fieldset>
		)
	}
	const object =
		resolved["type"] === "object" || resolved["properties"] !== undefined
	if (
		object &&
		resolved["properties"] !== undefined &&
		depth < 8 &&
		!advanced
	) {
		const properties = objectOf(resolved["properties"])
		const needed = Array.isArray(resolved["required"])
			? resolved["required"]
			: []
		return (
			<fieldset className="feature-field feature-object">
				<legend>{label}</legend>
				{description && <p className="feature-help">{description}</p>}
				{Object.entries(properties).map(([key, child]) => (
					<SchemaField
						key={key}
						schema={objectOf(child)}
						root={root}
						value={objectOf(value)[key]}
						name={key}
						required={needed.includes(key)}
						depth={depth + 1}
						references={references}
						preserveEmpty={preserveEmpty}
						onChange={(next) => {
							const record = { ...objectOf(value) }
							if (next === undefined) delete record[key]
							else record[key] = next
							onChange(record)
						}}
					/>
				))}
				<button
					type="button"
					className="feature-text-button"
					onClick={() => setAdvanced(true)}
				>{t`Edit as JSON`}</button>
				{!required && (
					<button
						type="button"
						className="feature-text-button"
						onClick={() => onChange(undefined)}
					>{t`Remove optional value`}</button>
				)}
			</fieldset>
		)
	}
	if (Array.isArray(resolved["enum"]))
		return (
			<label className="feature-field" htmlFor={id}>
				<span>
					{label}
					{required ? " *" : ""}
				</span>
				<select
					id={id}
					required={required}
					value={value === undefined ? "" : JSON.stringify(value)}
					onChange={(event) =>
						onChange(
							event.target.value === ""
								? undefined
								: JSON.parse(event.target.value),
						)
					}
				>
					<option value="">{t`Choose…`}</option>
					{resolved["enum"].map((item, index) => (
						<option key={index} value={JSON.stringify(item)}>
							{String(item)}
						</option>
					))}
				</select>
				{description && <small>{description}</small>}
			</label>
		)
	if (resolved["type"] === "boolean" && !required)
		return (
			<label className="feature-field" htmlFor={id}>
				<span>{label}</span>
				<select
					id={id}
					value={value === undefined ? "" : value === true ? "true" : "false"}
					onChange={(event) =>
						onChange(
							event.target.value === ""
								? undefined
								: event.target.value === "true",
						)
					}
				>
					<option value="">{t`Not set`}</option>
					<option value="true">{t`Yes`}</option>
					<option value="false">{t`No`}</option>
				</select>
				{description && <small>{description}</small>}
			</label>
		)
	if (resolved["type"] === "boolean")
		return (
			<label className="feature-field feature-checkbox">
				<input
					type="checkbox"
					checked={value === true}
					onChange={(event) => onChange(event.target.checked)}
				/>
				<span>{label}</span>
				{description && <small>{description}</small>}
			</label>
		)
	if (
		resolved["type"] === "array" ||
		object ||
		variants.length > 0 ||
		depth >= 8 ||
		advanced ||
		resolved["type"] === undefined
	)
		return (
			<div className="feature-field">
				<label>
					{label}
					{required ? " *" : ""}
				</label>
				{description && <small>{description}</small>}
				<JsonInput
					value={value}
					onChange={onChange}
					required={required}
					label={label}
				/>
				{advanced && (
					<button
						type="button"
						className="feature-text-button"
						onClick={() => setAdvanced(false)}
					>{t`Use the form`}</button>
				)}
			</div>
		)
	const numeric =
		resolved["type"] === "integer" || resolved["type"] === "number"
	const multiline =
		!numeric &&
		(name === "description" ||
			name === "text" ||
			name === "content" ||
			name === "prompt" ||
			name === "rule" ||
			name === "instructions")
	const suggestions = references[name] ?? []
	return (
		<label className="feature-field" htmlFor={id}>
			<span>
				{label}
				{required ? " *" : ""}
			</span>
			{multiline ? (
				<textarea
					id={id}
					rows={4}
					required={required}
					value={typeof value === "string" ? value : ""}
					onChange={(event) =>
						onChange(
							event.target.value === "" && !required && !preserveEmpty
								? undefined
								: event.target.value,
						)
					}
				/>
			) : (
				<input
					id={id}
					list={suggestions.length > 0 ? `${id}-choices` : undefined}
					type={
						numeric
							? "number"
							: secretField(name) || resolved["writeOnly"] === true
								? "password"
								: "text"
					}
					autoComplete="off"
					required={required}
					step={resolved["type"] === "integer" ? 1 : "any"}
					min={
						typeof resolved["minimum"] === "number"
							? resolved["minimum"]
							: undefined
					}
					max={
						typeof resolved["maximum"] === "number"
							? resolved["maximum"]
							: undefined
					}
					maxLength={
						typeof resolved["maxLength"] === "number"
							? resolved["maxLength"]
							: undefined
					}
					value={
						typeof value === "string" || typeof value === "number" ? value : ""
					}
					onChange={(event) =>
						onChange(
							event.target.value === "" && (numeric || !preserveEmpty)
								? undefined
								: numeric
									? Number(event.target.value)
									: event.target.value,
						)
					}
				/>
			)}
			{suggestions.length > 0 && (
				<datalist id={`${id}-choices`}>
					{suggestions.map((entry) => (
						<option key={entry.value} value={entry.value}>
							{entry.label}
						</option>
					))}
				</datalist>
			)}
			{description && <small>{description}</small>}
		</label>
	)
}
