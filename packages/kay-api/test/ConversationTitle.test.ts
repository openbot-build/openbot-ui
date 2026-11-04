import assert from "node:assert/strict"
import { test } from "node:test"
import { conversationTitle } from "../src/ConversationTitle.ts"
import type { MessagePage } from "@kaicom/kay-contracts"

const page = (
	texts: ReadonlyArray<{ role: "user" | "assistant"; text: string }>,
): typeof MessagePage.Type => ({
	items: texts.map((part, index) => ({
		id: String(index),
		sourceItemId: String(index),
		sequence: index + 1,
		turnId: null,
		role: part.role,
		parts: [{ type: "text", text: part.text }],
	})),
	next: null,
})
test("title uses the first user request without the Computer page introduction", () => {
	assert.equal(
		conversationTitle(
			page([
				{
					role: "user",
					text: "帮我在电脑“Basic task workspace”上处理一个任务。做一个有关 Transformer 架构的 PPT",
				},
				{ role: "assistant", text: "A different title" },
			]),
		),
		"做一个有关 Transformer 架构的 PPT",
	)
	assert.equal(
		conversationTitle(
			page([
				{
					role: "user",
					text: "Help me with a task on my computer “Work”.\nPrepare the research slides",
				},
			]),
		),
		"Prepare the research slides",
	)
})
test("title ignores assistant output and keeps Unicode characters whole", () => {
	const attached = page([
		{ role: "user", text: "" },
		{ role: "user", text: "Explain this diagram" },
	])
	assert.equal(
		conversationTitle({
			...attached,
			items: attached.items.map((item, index) =>
				index === 0
					? {
							...item,
							parts: [{ type: "file", details: { fileId: "file-first" } }],
						}
					: item,
			),
		}),
		"Explain this diagram",
	)
	assert.equal(
		conversationTitle(page([{ role: "assistant", text: "Invented topic" }])),
		null,
	)
	assert.equal(
		conversationTitle(page([{ role: "user", text: "🙂".repeat(70) }])),
		"🙂".repeat(47) + "…",
	)
	assert.equal(
		conversationTitle(
			page([
				{ role: "user", text: "# First request\nDetails" },
				{ role: "user", text: "Later request" },
			]),
		),
		"First request",
	)
})
