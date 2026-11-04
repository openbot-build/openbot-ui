import { Schema } from "effect"
import type { CatalogEntry } from "./Catalog"
import source from "./catalog/Stories.json"

const Story = Schema.Struct({
	id: Schema.NonEmptyString,
	kicker: Schema.NonEmptyString,
	title: Schema.NonEmptyString,
	summary: Schema.NonEmptyString,
	cover: Schema.NonEmptyString,
	sections: Schema.Array(
		Schema.Struct({
			heading: Schema.NonEmptyString,
			paragraphs: Schema.Array(Schema.NonEmptyString),
		}),
	),
	apps: Schema.Array(
		Schema.Struct({
			catalogId: Schema.NonEmptyString,
			reason: Schema.NonEmptyString,
		}),
	),
})

export type EditorialStory = typeof Story.Type
export const stories = Schema.decodeSync(Schema.Array(Story))(source)
export const getStory = (id: string) => stories.find((story) => story.id === id)

export function storyApps({
	story,
	entries,
}: {
	readonly story: EditorialStory
	readonly entries: ReadonlyArray<CatalogEntry>
}) {
	return story.apps.flatMap((item) => {
		const entry = entries.find((entry) => entry.id === item.catalogId)
		return entry === undefined ? [] : [{ entry, reason: item.reason }]
	})
}
