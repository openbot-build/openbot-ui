import { t } from "@lingui/core/macro"
import {
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
	type ReactNode,
} from "react"
import { defaultRemarkPlugins, Streamdown } from "streamdown"
import {
	MessageScrollerProvider,
	MessageScroller,
	MessageScrollerViewport,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerButton,
} from "../components/ui/message-scroller"
import { ReadingPosition } from "../components/ReadingPosition"
import {
	ArrowRight,
	ArrowUp,
	Check,
	FolderOpen,
	FileText,
	Download,
	Globe2,
	AudioLines,
	Plus,
	Search,
	Sparkles,
	Square,
	X,
} from "lucide-react"
import { Anchor } from "../components/mascot/Mascot"
import { Button } from "../components/ui/button"
import { InputGroup, InputGroupTextarea } from "../components/ui/input-group"
import { stories } from "../experience/Editorial"
import { PageHeading } from "./Shell"
import { toolLabel } from "./ToolLabel"
import type { Attachment, Message, SavedAttachment, Task } from "./Model"
import { remarkSavedFileLinks, savedFileLinkId } from "./SavedFileLinks"

const messageRemarkPlugins = [
	...Object.values(defaultRemarkPlugins),
	remarkSavedFileLinks,
]

function SavedFile({
	file,
	onDownload,
	inline = false,
	children,
}: {
	readonly file: SavedAttachment
	readonly inline?: boolean
	readonly children?: ReactNode
	readonly onDownload?:
		| ((
				fileId: string,
		  ) => Promise<{ readonly filename: string; readonly blob: Blob }>)
		| undefined
}) {
	const [downloading, setDownloading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const active = useRef(false)
	const locked = useRef(false)
	const Container = inline ? "span" : "div"
	const ErrorText = inline ? "span" : "p"
	useEffect(() => {
		active.current = true
		return () => {
			active.current = false
		}
	}, [])
	const download = async () => {
		if (onDownload === undefined || locked.current) return
		locked.current = true
		setDownloading(true)
		setError(null)
		try {
			const saved = await onDownload(file.fileId)
			if (!active.current) return
			const url = URL.createObjectURL(saved.blob)
			const link = document.createElement("a")
			link.href = url
			link.download = saved.filename
			link.click()
			setTimeout(() => URL.revokeObjectURL(url), 1000)
		} catch {
			if (active.current)
				setError(t`This file could not be downloaded. Please try again.`)
		} finally {
			locked.current = false
			if (active.current) setDownloading(false)
		}
	}
	return (
		<Container>
			<Button
				variant={inline ? "link" : "outline"}
				className={inline ? "h-auto px-0 py-0 align-baseline" : undefined}
				title={inline ? t`Download` : undefined}
				disabled={downloading || onDownload === undefined}
				onClick={() => void download()}
			>
				{!inline && <FileText size={16} />}
				{children ?? file.name ?? t`Saved file`}
				<Download size={16} />
				{downloading ? t`Downloading…` : inline ? null : t`Download`}
			</Button>
			{error !== null && (
				<ErrorText className="feature-error" role="alert">
					{error}
				</ErrorText>
			)}
		</Container>
	)
}

export function ChatView({
	kind,
	title,
	messages,
	replyBodies,
	activeReplyId,
	replyAnchorsActive = true,
	draft,
	onDraft,
	onSubmit,
	onDetail,
	preview = true,
	busy = false,
	status,
	activity,
	activityActive = false,
	activityInDock = false,
	onStop,
	onEarlier,
	conversationKey = kind,
	historyReady = true,
	attachments = [],
	onRemoveAttachment,
	onUpload,
	onAppView,
	onDownloadAttachment,
}: {
	readonly kind: "kay" | "conversation" | "new"
	readonly title: string
	readonly messages: ReadonlyArray<Message>
	readonly replyBodies?: ReadonlyMap<string, ReactNode>
	readonly activeReplyId?: string | undefined
	readonly replyAnchorsActive?: boolean
	readonly draft: string
	readonly onDraft: (value: string) => void
	readonly onSubmit: () => void
	readonly onDetail: (id: string) => void
	readonly preview?: boolean
	readonly busy?: boolean
	readonly activity?: ReactNode
	readonly status?: ReactNode
	readonly activityActive?: boolean
	readonly activityInDock?: boolean
	readonly onStop?: () => void
	readonly onEarlier?: () => void
	readonly conversationKey?: string
	readonly historyReady?: boolean
	readonly attachments?: ReadonlyArray<Attachment>
	readonly onRemoveAttachment?: (fileId: string) => void
	readonly onUpload?: (file: File) => void
	readonly onDownloadAttachment?: (
		fileId: string,
	) => Promise<{ readonly filename: string; readonly blob: Blob }>
	readonly onAppView?: (view: {
		readonly operationId: string
		readonly itemId: string
	}) => void
}) {
	const id = useId()
	const composing = useRef(false)
	const blurFrame = useRef<number | null>(null)
	const viewport = useRef<HTMLDivElement>(null)
	const fileInput = useRef<HTMLInputElement>(null)
	const composerInput = useRef<HTMLTextAreaElement>(null)
	const lastMessageId = messages.at(-1)?.id
	const replyAnchorId =
		activeReplyId ??
		(!activityActive && (kind === "conversation" || kind === "kay")
			? messages.findLast((message) => message.role === "assistant")?.id
			: undefined)
	const followPreviewReply =
		lastMessageId !== undefined && replyBodies?.has(lastMessageId) === true
	useEffect(() => {
		if (followPreviewReply && viewport.current !== null) {
			viewport.current.scrollTop = viewport.current.scrollHeight
		}
	}, [lastMessageId, followPreviewReply])
	const [composerFocused, setComposerFocused] = useState(false)
	const composerFocus = (focused: boolean) => {
		setComposerFocused(focused)
	}
	useLayoutEffect(
		() => () => {
			if (blurFrame.current !== null) cancelAnimationFrame(blurFrame.current)
			blurFrame.current = null
		},
		[],
	)
	const hasInput = draft.trim() !== "" || attachments.length > 0
	const composerExpanded =
		composerFocused || draft.length > 0 || attachments.length > 0
	return (
		<div
			className="next-chat"
			data-kind={kind}
			data-empty={messages.length === 0 || undefined}
		>
			<MessageScrollerProvider
				key={conversationKey}
				autoScroll={!preview || followPreviewReply}
			>
				<MessageScroller className="next-chat-scroller">
					<MessageScrollerViewport className="next-chat-scroll" ref={viewport}>
						<MessageScrollerContent className="next-chat-column">
							{onEarlier !== undefined && (
								<Button
									variant="ghost"
									disabled={busy}
									onClick={onEarlier}
								>{t`Load earlier messages`}</Button>
							)}
							{kind === "conversation" &&
								activity == null &&
								!messages.some((message) => message.role === "assistant") && (
									<Anchor
										placement="reply"
										active={replyAnchorsActive}
										className="next-reply-mascot"
									/>
								)}
							{kind !== "conversation" && (
								<header className="next-chat-welcome">
									<Anchor placement="home" className="next-home-mascot" />
									<div className="next-welcome-copy">
										<p className="next-eyebrow">
											{kind === "kay"
												? t`A little more room for your day`
												: "Chat"}
										</p>
										<h1>
											{kind === "kay"
												? t`What shall we make time for?`
												: t`A new conversation. A fresh start.`}
										</h1>
										<p>
											{kind === "kay"
												? t`Pick up where we left off, or bring me something new.`
												: t`This conversation has its own history. Your ongoing chat with Kay stays where it is.`}
										</p>
									</div>
								</header>
							)}
							{kind === "kay" && preview && (
								<div className="next-context-strip">
									<button onClick={() => onDetail("launch-review")}>
										<span className="next-context-icon">
											<Check size={16} />
										</span>
										<span>
											<strong>{t`Ready when you are`}</strong>
											<small>{t`The launch outline needs a look`}</small>
										</span>
										<ArrowRight size={17} />
									</button>
									<button onClick={() => onDetail("weekly-notes")}>
										<span className="next-context-icon">
											<FolderOpen size={16} />
										</span>
										<span>
											<strong>{t`One place for the week`}</strong>
											<small>{t`Notes, sources and next steps`}</small>
										</span>
										<ArrowRight size={17} />
									</button>
								</div>
							)}
							{messages.length > 0 && (
								<section className="next-transcript" aria-label={title}>
									{preview && (
										<div className="next-date-divider">
											<span>{t`Example conversation`}</span>
										</div>
									)}
									{messages.map((message) => (
										<MessageScrollerItem
											key={message.id}
											messageId={message.id}
										>
											<article
												className={"next-message next-message-" + message.role}
												data-scripted-reply={
													replyBodies?.has(message.id) || undefined
												}
											>
												{message.id === replyAnchorId && (
													<Anchor
														placement="reply"
														active={replyAnchorsActive}
														className="next-reply-mascot"
													/>
												)}
												{replyBodies?.get(message.id) ??
													(message.role === "user" ? (
														<p>{message.text}</p>
													) : (
														<div className="prose-content">
															<Streamdown
																mode={
																	message.streaming === true
																		? "streaming"
																		: "static"
																}
																isAnimating={message.streaming === true}
																animated={false}
																controls={false}
																plugins={{}}
																remarkPlugins={messageRemarkPlugins}
																urlTransform={(url) =>
																	/^(?:https?:|mailto:|#|\/[^/])/i.test(url)
																		? url
																		: ""
																}
																components={{
																	a: ({ href, children }) => {
																		const fileId = savedFileLinkId(href)
																		return fileId !== null ? (
																			<SavedFile
																				file={{ fileId }}
																				onDownload={onDownloadAttachment}
																				inline
																			>
																				{children}
																			</SavedFile>
																		) : (
																			<a
																				href={href}
																				target="_blank"
																				rel="noopener noreferrer"
																			>
																				{children}
																			</a>
																		)
																	},
																	img: ({ alt }) => (
																		<span>{alt ?? "[Image]"}</span>
																	),
																}}
															>
																{message.text}
															</Streamdown>
														</div>
													))}
												{message.attachments?.map((file) => (
													<SavedFile
														key={file.fileId}
														file={file}
														onDownload={onDownloadAttachment}
													/>
												))}
												{message.details
													?.filter(
														(part) =>
															part.type !== "tool-approval-request" &&
															part.type !== "tool-approval-response",
													)
													.map((part, index) => (
														<div key={index}>
															<details className="next-message-details">
																<summary>
																	{part.value !== null &&
																	typeof part.value === "object" &&
																	"name" in part.value &&
																	typeof part.value.name === "string"
																		? `${toolLabel(part.value.name)} · ${part.type === "tool-result" ? t`Result` : t`Tool call`}`
																		: part.type}
																</summary>
																<pre>{JSON.stringify(part.value, null, 2)}</pre>
															</details>
															{part.appView !== undefined &&
																onAppView !== undefined && (
																	<Button
																		variant="outline"
																		disabled={busy}
																		onClick={() => {
																			if (part.appView !== undefined)
																				onAppView(part.appView)
																		}}
																	>{t`Open App interface`}</Button>
																)}
														</div>
													))}
												{message.role === "assistant" &&
													preview &&
													replyBodies?.has(message.id) !== true && (
														<span className="next-message-caption">{t`Preview response`}</span>
													)}
											</article>
										</MessageScrollerItem>
									))}
								</section>
							)}
							{kind === "new" && (
								<div className="next-starter-list">
									{[
										t`Think through an idea`,
										t`Make sense of a document`,
										t`Find the original source`,
									].map((prompt) => (
										<button key={prompt} onClick={() => onDraft(prompt)}>
											<span>{prompt}</span>
											<ArrowUp size={16} />
										</button>
									))}
								</div>
							)}
							{activity != null &&
								(!activityInDock || replyAnchorId === undefined) && (
									<div
										className="next-chat-activity"
										data-has-mascot={replyAnchorId === undefined}
									>
										{replyAnchorId === undefined && (
											<Anchor
												placement="reply"
												active={replyAnchorsActive}
												className="next-reply-mascot"
											/>
										)}
										{!activityInDock && activity}
									</div>
								)}
						</MessageScrollerContent>
					</MessageScrollerViewport>
					{!preview && historyReady && (
						<ReadingPosition
							key={conversationKey}
							viewport={viewport}
							session={conversationKey}
						/>
					)}
					{!preview && <MessageScrollerButton aria-label={t`Jump to latest`} />}
				</MessageScroller>
			</MessageScrollerProvider>
			<div className="next-composer-wrap">
				{status}
				{activityInDock && activity}
				<form
					className="next-composer"
					data-expanded={composerExpanded}
					onFocusCapture={(event) => {
						if (
							event.target instanceof Element &&
							event.target.closest(".next-composer-primary") !== null
						)
							return
						if (blurFrame.current !== null)
							cancelAnimationFrame(blurFrame.current)
						blurFrame.current = null
						composerFocus(true)
					}}
					onBlurCapture={(event) => {
						if (event.currentTarget.contains(event.relatedTarget)) return
						if (event.relatedTarget !== null) {
							composerFocus(false)
							return
						}
						const form = event.currentTarget
						if (blurFrame.current !== null)
							cancelAnimationFrame(blurFrame.current)
						blurFrame.current = requestAnimationFrame(() => {
							blurFrame.current = null
							if (document.hasFocus() && !form.contains(document.activeElement))
								composerFocus(false)
						})
					}}
					onSubmit={(event) => {
						event.preventDefault()
						if (!busy && !composing.current && hasInput) onSubmit()
					}}
				>
					<label className="sr-only" htmlFor={id}>{t`Message Kay`}</label>
					<InputGroup
						className="next-composer-input"
						onClick={(event) => {
							if (
								event.target instanceof Element &&
								event.target.closest("button, input, textarea, a") === null
							)
								composerInput.current?.focus()
						}}
					>
						{onUpload !== undefined && (
							<input
								ref={fileInput}
								type="file"
								className="sr-only"
								tabIndex={-1}
								aria-label={t`File to upload`}
								onChange={(event) => {
									const file = event.currentTarget.files?.[0]
									event.currentTarget.value = ""
									if (file !== undefined) onUpload(file)
								}}
							/>
						)}
						{attachments.length > 0 && (
							<div className="next-attachments">
								{attachments.map((file) => (
									<span key={file.fileId}>
										{file.name}
										<button
											type="button"
											onClick={() => onRemoveAttachment?.(file.fileId)}
											aria-label={t`Remove ${file.name}`}
										>
											<X size={14} />
										</button>
									</span>
								))}
							</div>
						)}
						<InputGroupTextarea
							ref={composerInput}
							id={id}
							value={draft}
							rows={2}
							placeholder={
								kind === "kay"
									? t`Tell Kay what's on your mind…`
									: t`Start with a thought…`
							}
							onChange={(event) => onDraft(event.target.value)}
							onCompositionStart={() => {
								composing.current = true
							}}
							onCompositionEnd={() => {
								composing.current = false
							}}
							onKeyDown={(event) => {
								if (
									event.key !== "Enter" ||
									event.shiftKey ||
									composing.current ||
									event.nativeEvent.isComposing ||
									event.nativeEvent.keyCode === 229
								)
									return
								event.preventDefault()
								event.currentTarget.form?.requestSubmit()
							}}
						/>
						<div className="next-composer-toolbar" inert={!composerExpanded}>
							{
								<Button
									type="button"
									variant="ghost"
									size="icon-lg"
									onClick={() =>
										onUpload === undefined
											? onDetail("attach")
											: fileInput.current?.click()
									}
									disabled={busy}
									aria-label={t`Add a file`}
								>
									<Plus size={21} />
								</Button>
							}
							<span className="next-composer-companion">
								<Sparkles size={14} />
								{kind === "kay" ? "Kay" : "Chat"}
							</span>
							{onUpload !== undefined && (
								<Button
									type="button"
									variant="ghost"
									disabled={busy}
									onClick={() => onDetail("saved-files")}
								>{t`Saved files`}</Button>
							)}
							<div className="next-composer-spacer" />
							{onStop !== undefined && (
								<Button
									type="button"
									variant="outline"
									disabled={busy}
									onClick={onStop}
								>{t`Stop`}</Button>
							)}
						</div>
						<Button
							type={hasInput ? "submit" : "button"}
							size="icon-lg"
							className="next-composer-primary"
							data-action={
								hasInput ? "send" : onStop !== undefined ? "stop" : "live"
							}
							disabled={busy}
							aria-label={
								hasInput
									? preview
										? t`Preview sending a message`
										: t`Send message`
									: onStop !== undefined
										? t`Stop`
										: `Live · ${t`Voice conversation`}`
							}
							title={
								hasInput
									? t`Send message`
									: onStop !== undefined
										? t`Stop`
										: `Live · ${t`Voice conversation`}`
							}
							onClick={() => {
								if (!hasInput) {
									if (onStop !== undefined) onStop()
									else onDetail("voice")
								}
							}}
						>
							<span className="next-composer-live-icon" aria-hidden="true">
								{onStop !== undefined ? (
									<Square className="size-4" />
								) : (
									<AudioLines className="size-5" />
								)}
							</span>
							<span className="next-composer-send-icon" aria-hidden="true">
								<ArrowUp className="size-5" />
							</span>
						</Button>
					</InputGroup>
				</form>
				{preview && (
					<p className="next-composer-note">{t`Send a message to preview how Kay thinks and works.`}</p>
				)}
			</div>
		</div>
	)
}

export const taskStateLabel = (state: Task["state"]) =>
	state === "review"
		? t`Needs your review`
		: state === "running"
			? t`In progress`
			: t`Completed`

export function AppsView({
	onOpen,
}: {
	readonly onOpen: (id: string) => void
}) {
	return (
		<div className="next-page next-apps-page">
			<PageHeading
				title={t`A little more possibility.`}
				description={t`Tools for the things you want to do. Stories to help you get started.`}
			>
				<Button variant="outline" onClick={() => onOpen("app-search")}>
					<Search size={17} />
					{t`Find an App`}
				</Button>
			</PageHeading>
			<div className="next-stories">
				{stories.slice(0, 4).map((story, index) => (
					<button
						key={story.id}
						className="next-story"
						data-lead={index === 0 || undefined}
						onClick={() => onOpen("story:" + story.id)}
					>
						<img
							src={story.cover}
							alt=""
							loading={index > 1 ? "lazy" : "eager"}
						/>
						<span>
							<small>{story.kicker}</small>
							<strong>{story.title}</strong>
							<p>{story.summary}</p>
							<span className="next-story-read">
								{t`Read the story`}
								<ArrowRight size={16} />
							</span>
						</span>
					</button>
				))}
			</div>
			<div className="next-apps-note">
				<Globe2 size={21} />
				<p>{t`The existing cloud App collection and editorial stories stay with Kay.`}</p>
			</div>
		</div>
	)
}
