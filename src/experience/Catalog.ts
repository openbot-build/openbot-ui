import { Schema } from "effect"

export const CatalogCategory = Schema.Literals([
	"productivity",
	"developer",
	"data",
	"design",
	"research",
	"communication",
	"automation",
	"finance",
	"other",
])
export type CatalogCategory = typeof CatalogCategory.Type

const Entry = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	publisher: Schema.String,
	description: Schema.String,
	sourceUrl: Schema.String,
	repositoryUrl: Schema.optionalKey(Schema.String),
	homepageUrl: Schema.optionalKey(Schema.String),
	iconUrl: Schema.optionalKey(Schema.String),
	category: CatalogCategory,
	tags: Schema.Array(Schema.String),
	transport: Schema.Literals(["remote", "local", "unknown"]),
	remoteUrl: Schema.optionalKey(Schema.String),
	remoteTransport: Schema.optionalKey(
		Schema.Literals(["streamable-http", "sse"]),
	),
	installUrl: Schema.String,
	cloud: Schema.optionalKey(
		Schema.Struct({
			access: Schema.Literals([
				"anonymous",
				"optional-account",
				"account",
				"unknown",
			]),
			authType: Schema.optionalKey(
				Schema.Literals(["api-key", "oauth", "unknown"]),
			),
			headers: Schema.optionalKey(
				Schema.Array(
					Schema.Struct({
						name: Schema.String,
						value: Schema.optionalKey(Schema.String),
						description: Schema.optionalKey(Schema.String),
						required: Schema.Boolean,
					}),
				),
			),
			note: Schema.String,
			verifiedAt: Schema.String,
		}),
	),
	article: Schema.Struct({
		title: Schema.String,
		summary: Schema.String,
		sections: Schema.Array(
			Schema.Struct({
				heading: Schema.String,
				paragraphs: Schema.Array(Schema.String),
			}),
		),
		sources: Schema.Array(
			Schema.Struct({ title: Schema.String, url: Schema.String }),
		),
	}),
})
export type CatalogEntry = typeof Entry.Type
export const decodeCatalog = (input: unknown) =>
	Schema.decodeUnknownSync(Schema.Array(Entry))(input)

export const getCatalogEntry = ({
	entries,
	id,
}: {
	readonly entries: ReadonlyArray<CatalogEntry>
	readonly id: string
}) => entries.find((entry) => entry.id === id)

const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase()
export function filterCatalog({
	entries,
	query = "",
	category = "",
}: {
	readonly entries: ReadonlyArray<CatalogEntry>
	readonly query?: string
	readonly category?: string
}) {
	const terms = normalize(query).trim().split(/\s+/).filter(Boolean)
	return entries.filter((entry) => {
		if (category !== "" && entry.category !== category) return false
		const text = normalize(
			[
				entry.name,
				entry.publisher,
				entry.description,
				entry.article.title,
				entry.article.summary,
				...entry.tags,
				...entry.article.sections.flatMap((section) => [
					section.heading,
					...section.paragraphs,
				]),
			].join(" "),
		)
		return terms.every((term) => text.includes(term))
	})
}

/** Only concrete HTTPS endpoints can prefill the existing remote connection form. */
export function connectionAddress(entry: CatalogEntry): string | undefined {
	if (
		entry.transport !== "remote" ||
		entry.remoteTransport !== "streamable-http" ||
		entry.remoteUrl === undefined
	)
		return undefined
	if (/[{}<>]|%7[bBdD]|%3[cCeE]/.test(entry.remoteUrl)) return undefined
	try {
		const url = new URL(entry.remoteUrl)
		return url.protocol === "https:" &&
			url.username === "" &&
			url.password === ""
			? entry.remoteUrl
			: undefined
	} catch {
		return undefined
	}
}
