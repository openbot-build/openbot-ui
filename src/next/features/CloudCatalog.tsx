import { t } from "@lingui/core/macro"
import { useState } from "react"
import { entries } from "../../experience/CatalogData"
import {
	connectionAddress,
	filterCatalog,
	type CatalogEntry,
} from "../../experience/Catalog"
import { stories } from "../../experience/Editorial"
import { Button } from "../../components/ui/button"

export function CloudCatalog({
	onAdd,
	disabled,
}: {
	readonly onAdd: (entry: CatalogEntry) => Promise<"added" | "setup">
	readonly disabled: boolean
}) {
	const [query, setQuery] = useState("")
	const [storyId, setStory] = useState<string | null>(null)
	const [entryId, setEntry] = useState<string | null>(null)
	const [pending, setPending] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [visible, setVisible] = useState(24)
	const [added, setAdded] = useState<ReadonlyArray<string>>([])
	const story = stories.find((item) => item.id === storyId)
	const entry = entries.find((item) => item.id === entryId)
	const filtered = filterCatalog({ entries, query }).filter(
		(item) => item.transport === "remote",
	)
	return (
		<section className="feature-cloud">
			<h2>{t`Discover what Kay can do`}</h2>
			<div className="feature-stories">
				{stories.map((item) => (
					<button
						key={item.id}
						onClick={() => {
							setStory(storyId === item.id ? null : item.id)
							setEntry(null)
						}}
					>
						<img src={item.cover} alt="" loading="lazy" />
						<span>{item.kicker}</span>
						<strong>{item.title}</strong>
					</button>
				))}
			</div>
			{story && (
				<article className="feature-article">
					<h3>{story.title}</h3>
					<p>{story.summary}</p>
					{story.sections.map((section) => (
						<section key={section.heading}>
							<h4>{section.heading}</h4>
							{section.paragraphs.map((paragraph, index) => (
								<p key={index}>{paragraph}</p>
							))}
						</section>
					))}
					<div className="feature-toolbar">
						{story.apps.map((app) => {
							const item = entries.find(
								(candidate) => candidate.id === app.catalogId,
							)
							return item === undefined ? null : (
								<Button
									key={item.id}
									variant="outline"
									onClick={() => setEntry(item.id)}
								>
									{item.name}
								</Button>
							)
						})}
					</div>
				</article>
			)}
			<label className="feature-search">
				<input
					placeholder={t`Search cloud apps`}
					value={query}
					onChange={(event) => {
						setQuery(event.target.value)
						setVisible(24)
					}}
				/>
			</label>
			{error && (
				<div className="feature-error" role="alert">
					{error}
				</div>
			)}
			{entry && (
				<article className="feature-article">
					<h3>{entry.article.title}</h3>
					<p>{entry.article.summary}</p>
					{entry.article.sections.map((section) => (
						<section key={section.heading}>
							<h4>{section.heading}</h4>
							{section.paragraphs.map((paragraph, index) => (
								<p key={index}>{paragraph}</p>
							))}
						</section>
					))}
					<p className="feature-help">{entry.cloud?.note}</p>
					{entry.article.sources.map((source) => (
						<p key={source.url}>
							<a href={source.url} target="_blank" rel="noreferrer noopener">
								{source.title}
							</a>
						</p>
					))}
				</article>
			)}
			<div className="feature-cloud-grid">
				{filtered.slice(0, visible).map((item) => (
					<article key={item.id} className="feature-record">
						<button
							className="feature-record-select"
							onClick={() => setEntry(entryId === item.id ? null : item.id)}
						>
							{item.iconUrl && (
								<img
									src={item.iconUrl}
									alt=""
									loading="lazy"
									referrerPolicy="no-referrer"
								/>
							)}
							<strong>{item.name}</strong>
							<small>{item.publisher}</small>
							<p>{item.description}</p>
						</button>
						<Button
							variant="outline"
							disabled={
								disabled ||
								pending !== null ||
								added.includes(item.id) ||
								connectionAddress(item) === undefined
							}
							onClick={() => {
								setPending(item.id)
								setError(null)
								void onAdd(item)
									.then((outcome) => {
										if (outcome === "added")
											setAdded((current) => [...current, item.id])
										else setError(t`Complete the connection details below.`)
									})
									.catch((failure) =>
										setError(
											failure instanceof Error
												? failure.message
												: t`The app could not be added.`,
										),
									)
									.finally(() => setPending(null))
							}}
						>
							{pending === item.id
								? t`Adding…`
								: added.includes(item.id)
									? t`Added`
									: t`Add`}
						</Button>
					</article>
				))}
			</div>
			{visible < filtered.length && (
				<Button
					variant="outline"
					onClick={() => setVisible((count) => count + 24)}
				>{t`Show more`}</Button>
			)}
		</section>
	)
}
