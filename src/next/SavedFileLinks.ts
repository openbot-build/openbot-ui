const fileReference = /^openbot-file:([A-Za-z0-9_-]{1,128})$/
const fileLink = /^#kay-saved-file-([A-Za-z0-9_-]{1,128})$/

/** Internal links are handled by the existing authenticated file download action. */
export const savedFileLinkId = (href: string | undefined): string | null =>
	href === undefined ? null : (fileLink.exec(href)?.[1] ?? null)

type MarkdownNode = {
	readonly type: string
	url?: string
	readonly children?: ReadonlyArray<MarkdownNode>
}

/** Project native file references before the renderer removes unknown protocols. */
export const remarkSavedFileLinks = () => (tree: MarkdownNode) => {
	const visit = (node: MarkdownNode): void => {
		if (
			(node.type === "link" || node.type === "definition") &&
			typeof node.url === "string"
		) {
			const id = fileReference.exec(node.url)?.[1]
			if (id !== undefined) node.url = `#kay-saved-file-${id}`
		}
		for (const child of node.children ?? []) visit(child)
	}
	visit(tree)
}
