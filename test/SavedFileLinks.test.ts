import assert from "node:assert/strict"
import { test } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { defaultRemarkPlugins, Streamdown } from "streamdown"
import {
	remarkSavedFileLinks,
	savedFileLinkId,
} from "../src/next/SavedFileLinks.ts"

const render = (markdown: string, mode: "static" | "streaming" = "static") =>
	renderToStaticMarkup(
		createElement(Streamdown, {
			children: markdown,
			mode,
			plugins: {},
			controls: false,
			animated: false,
			remarkPlugins: [
				...Object.values(defaultRemarkPlugins),
				remarkSavedFileLinks,
			],
			urlTransform: (url) =>
				/^(?:https?:|mailto:|#|\/[^/])/i.test(url) ? url : "",
			components: {
				a: ({ href, children }) => {
					const fileId = savedFileLinkId(href)
					return fileId === null
						? createElement("a", { href }, children)
						: createElement("button", { "data-file-id": fileId }, children)
				},
			},
		}),
	)

test("native Markdown file links reach the authenticated download renderer before sanitization", () => {
	for (const mode of ["static", "streaming"] as const) {
		const html = render("[Presentation.pptx](openbot-file:file_123-abc)", mode)
		assert.match(
			html,
			/<button data-file-id="file_123-abc">Presentation.pptx<\/button>/,
		)
		assert.doesNotMatch(html, /\[blocked\]|Blocked URL|openbot-file:/)
	}
})

test("reference-style file links are projected without changing ordinary web links", () => {
	const html = render(
		"[Slides][saved] and [Source](https://example.com/source)\n\n[saved]: openbot-file:file-1",
	)
	assert.match(html, /<button data-file-id="file-1">Slides<\/button>/)
	assert.match(html, /<a href="https:\/\/example.com\/source">Source<\/a>/)
})

test("malformed and executable references cannot become saved-file actions", () => {
	for (const target of [
		"openbot-file:",
		"openbot-file:../private",
		"openbot-file:file-1?admin=true",
		"openbot-file:file-1#other",
		"openbot-file:file%2Fprivate",
		"openbot-file:" + "a".repeat(129),
		"javascript:alert(1)",
		"data:text/html,hello",
		"file:///etc/passwd",
	]) {
		const html = render(`[Download](${target})`)
		assert.doesNotMatch(html, /data-file-id=/, target)
		assert.doesNotMatch(
			html,
			/href="(?:javascript:|data:|file:|openbot-file:)/i,
			target,
		)
	}
})

test("code examples and raw HTML do not gain file download actions", () => {
	const html = render(
		'`[Example](openbot-file:file-1)`\n\n```text\n[Example](openbot-file:file-2)\n```\n\n<a href="openbot-file:file-3">Raw</a>',
	)
	assert.doesNotMatch(html, /data-file-id=/)
	assert.match(html, /openbot-file:file-1/)
	assert.match(html, /openbot-file:file-2/)
})

test("internal file markers accept only a complete bounded native ID", () => {
	assert.equal(savedFileLinkId("#kay-saved-file-file_1-2"), "file_1-2")
	for (const href of [
		undefined,
		"#kay-saved-file-",
		"#kay-saved-file-file-1?query",
		"#kay-saved-file-file%2f1",
		"#kay-saved-file-" + "a".repeat(129),
		"https://example.com/#kay-saved-file-file-1",
	])
		assert.equal(savedFileLinkId(href), null)
})
