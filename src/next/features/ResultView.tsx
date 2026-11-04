import { t } from "@lingui/core/macro"
import { useState } from "react"
import { objectOf, secretField, words } from "./SchemaForm"
import { safeLink, titleOf } from "./FeatureData"

export function ValueView({
	value,
	name = "",
}: {
	readonly value: unknown
	readonly name?: string
}) {
	const [revealed, setRevealed] = useState(false)
	if (value === undefined || value === null)
		return <span className="feature-muted">—</span>
	if (secretField(name) && !revealed)
		return (
			<button
				type="button"
				className="feature-text-button"
				onClick={() => setRevealed(true)}
			>{t`Show secret`}</button>
		)
	if (typeof value === "boolean") return <span>{value ? t`Yes` : t`No`}</span>
	if (typeof value === "number")
		return (
			<span>
				{/(At|Date|Time)$/.test(name) && value > 1000000000000
					? new Date(value).toLocaleString()
					: value.toLocaleString()}
			</span>
		)
	if (typeof value === "string")
		return safeLink(value) !== undefined ? (
			<a href={value} target="_blank" rel="noreferrer noopener">
				{value}
			</a>
		) : (
			<span className="feature-value-text">{value}</span>
		)
	if (Array.isArray(value))
		return value.length === 0 ? (
			<span className="feature-muted">{t`None`}</span>
		) : (
			<ol className="feature-values">
				{value.map((entry, index) => (
					<li key={index}>
						<ValueView value={entry} />
					</li>
				))}
			</ol>
		)
	return (
		<dl className="feature-properties">
			{Object.entries(objectOf(value)).map(([key, entry]) => (
				<div key={key}>
					<dt>{words(key)}</dt>
					<dd>
						<ValueView value={entry} name={key} />
					</dd>
				</div>
			))}
		</dl>
	)
}

export function RecordCard({
	value,
	selected,
	onSelect,
	onOpenChat,
}: {
	readonly value: unknown
	readonly selected: boolean
	readonly onSelect: () => void
	readonly onOpenChat: (id: string) => void
}) {
	const record = objectOf(value)
	const title = titleOf(value)
	const status = record["status"] ?? record["state"]
	const description =
		record["description"] ?? record["summary"] ?? record["reason"]
	const chat =
		typeof record["chat"] === "string"
			? record["chat"]
			: typeof record["chatId"] === "string"
				? record["chatId"]
				: undefined
	return (
		<article className="feature-record" data-selected={selected}>
			<button
				type="button"
				className="feature-record-select"
				onClick={onSelect}
			>
				<strong>{title || t`Details`}</strong>
				{typeof status === "string" && (
					<span className="feature-status">{status}</span>
				)}
				{typeof description === "string" && description !== title && (
					<p>{description}</p>
				)}
				{typeof record["id"] === "string" && record["id"] !== title && (
					<small>{record["id"]}</small>
				)}
			</button>
			{chat && (
				<button
					type="button"
					className="feature-text-button"
					onClick={() => onOpenChat(chat)}
				>{t`Open conversation`}</button>
			)}
			{selected && (
				<div className="feature-record-details">
					<ValueView value={value} />
				</div>
			)}
		</article>
	)
}
