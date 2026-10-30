import { memo } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import {
	CodeBlock,
	CodeBlockActions,
	CodeBlockContent,
	CodeBlockCopyButton,
	CodeBlockHeader,
	CodeBlockLine,
	CodeBlockTitle,
} from "@/components/ui/code-block"
import { useHighlightedCode } from "@/hooks/use-highlighted-code"
import { cn } from "@/lib/utils"

function FencedCode({
	language,
	code,
}: {
	readonly language: string
	readonly code: string
}) {
	const lines = useHighlightedCode(code, language)
	return (
		<CodeBlock>
			<CodeBlockHeader>
				<CodeBlockTitle className="font-mono font-normal text-muted-foreground">
					{language}
				</CodeBlockTitle>
				<CodeBlockActions>
					<CodeBlockCopyButton value={code} />
				</CodeBlockActions>
			</CodeBlockHeader>
			<CodeBlockContent className="text-body-medium">
				{lines.map((line, index) => (
					<CodeBlockLine key={index}>{line}</CodeBlockLine>
				))}
			</CodeBlockContent>
		</CodeBlock>
	)
}

const components: Components = {
	pre: ({ children }) => <>{children}</>,
	code: ({ className, children }) => {
		const text = String(children ?? "")
		const language = /language-([\w-]+)/.exec(className ?? "")?.[1]
		// Fenced code has a language or ends with a new line. Inline code has neither.
		if (language === undefined && !text.endsWith("\n"))
			return <code className={className}>{children}</code>
		return <FencedCode language={language ?? "text"} code={text} />
	},
	a: ({ href, children }) => (
		<a href={href} target="_blank" rel="noreferrer noopener">
			{children}
		</a>
	),
	table: ({ children }) => (
		<div className="overflow-x-auto">
			<table>{children}</table>
		</div>
	),
}

/** Shows Markdown text from a Bot. Raw HTML in the text is not rendered. */
export const Markdown = memo(function Markdown({
	text,
	className,
}: {
	readonly text: string
	readonly className?: string
}) {
	return (
		<div className={cn("prose-chat", className)}>
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
				{text}
			</ReactMarkdown>
		</div>
	)
})
