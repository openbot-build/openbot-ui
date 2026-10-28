import { useAtomSet } from "@effect/atom-react"
import { ArrowUpIcon, PaperclipIcon, SquareIcon } from "lucide-react"
import {
	type ClipboardEvent,
	type DragEvent,
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react"
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupTextarea,
} from "@/components/ui/input-group"
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip"
import type { Attachment } from "@/atoms/chat"
import { uploadFileAtom } from "@/atoms/files"
import { type Draft, DraftFiles } from "@/components/app/FilePreview"
import { errorMessage } from "@/lib/api"
import { cn } from "@/lib/utils"

/** A file in the composer, with the uploaded file when the upload ended. */
interface ComposerFile extends Draft {
	readonly uploaded: Attachment | undefined
}

/**
 * The files of the composer. Each file uploads as soon as the person adds it,
 * so the message goes at once when they send it.
 */
const useDrafts = () => {
	const upload = useAtomSet(uploadFileAtom, { mode: "promise" })
	const [files, setFiles] = useState<ReadonlyArray<ComposerFile>>([])
	const previews = useRef(new Set<string>())
	// One upload at a time, so each file gets its own result.
	const queue = useRef<Promise<void>>(Promise.resolve())

	// Give back the local image addresses when the composer goes away.
	useEffect(
		() => () => {
			for (const url of previews.current) URL.revokeObjectURL(url)
		},
		[],
	)

	const change = (key: string, next: Partial<ComposerFile>) =>
		setFiles((current) =>
			current.map((file) => (file.key === key ? { ...file, ...next } : file)),
		)

	const add = (list: Iterable<File>) => {
		for (const file of list) {
			const key = crypto.randomUUID()
			const preview = file.type.startsWith("image/")
				? URL.createObjectURL(file)
				: undefined
			if (preview !== undefined) previews.current.add(preview)
			setFiles((current) => [
				...current,
				{
					key,
					name: file.name,
					mediaType: file.type || "application/octet-stream",
					preview,
					status: "uploading",
					uploaded: undefined,
				},
			])
			queue.current = queue.current.then(() =>
				upload(file).then(
					(uploaded) =>
						change(key, {
							status: "ready",
							uploaded: {
								id: uploaded.id,
								filename: uploaded.filename,
								mediaType: uploaded.mediaType,
							},
						}),
					(cause: unknown) =>
						change(key, { status: "failed", error: errorMessage(cause) }),
				),
			)
		}
	}

	const remove = (key: string) =>
		setFiles((current) => {
			const file = current.find((item) => item.key === key)
			if (file?.preview !== undefined) {
				URL.revokeObjectURL(file.preview)
				previews.current.delete(file.preview)
			}
			return current.filter((item) => item.key !== key)
		})

	const clear = () => {
		for (const file of files)
			if (file.preview !== undefined) {
				URL.revokeObjectURL(file.preview)
				previews.current.delete(file.preview)
			}
		setFiles([])
	}

	return { files, add, remove, clear }
}

/**
 * The box where the person writes a message. Enter sends, and Shift+Enter
 * starts a new line. While the Bot works, the button stops it. With
 * `attachments`, the person can add files with the clip button, by pasting, or
 * by dropping them on the box.
 */
export function Composer({
	onSend,
	onStop,
	busy = false,
	disabled = false,
	attachments = false,
	placeholder = "What do you want to get done?",
	tools,
	autoFocus = false,
	initialText = "",
	className,
}: {
	readonly onSend: (text: string, files: ReadonlyArray<Attachment>) => void
	readonly onStop?: () => void
	readonly busy?: boolean
	readonly disabled?: boolean
	/** Whether the person can add files to the message. */
	readonly attachments?: boolean
	readonly placeholder?: string
	/** Controls in the lower row, such as the mode and the model. */
	readonly tools?: ReactNode
	readonly autoFocus?: boolean
	/** The text that the box starts with. Change the `key` to start again. */
	readonly initialText?: string
	readonly className?: string
}) {
	const [text, setText] = useState(initialText)
	const [dragging, setDragging] = useState(false)
	const drafts = useDrafts()
	const picker = useRef<HTMLInputElement>(null)
	const uploading = drafts.files.some((file) => file.status === "uploading")
	const ready = drafts.files.flatMap((file) =>
		file.status === "ready" && file.uploaded !== undefined
			? [file.uploaded]
			: [],
	)
	const canSend =
		(text.trim().length > 0 || ready.length > 0) &&
		!uploading &&
		!disabled &&
		!busy

	const send = () => {
		if (!canSend) return
		onSend(text.trim(), ready)
		setText("")
		drafts.clear()
	}

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (
			event.key === "Enter" &&
			!event.shiftKey &&
			!event.nativeEvent.isComposing
		) {
			event.preventDefault()
			send()
		}
	}

	const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
		if (!attachments || event.clipboardData.files.length === 0) return
		event.preventDefault()
		drafts.add(event.clipboardData.files)
	}

	const onDragOver = (event: DragEvent<HTMLDivElement>) => {
		if (!attachments || disabled || !event.dataTransfer.types.includes("Files"))
			return
		event.preventDefault()
		setDragging(true)
	}

	const onDrop = (event: DragEvent<HTMLDivElement>) => {
		setDragging(false)
		if (!attachments || disabled || event.dataTransfer.files.length === 0)
			return
		event.preventDefault()
		drafts.add(event.dataTransfer.files)
	}

	return (
		<InputGroup
			onDragOver={onDragOver}
			onDragLeave={() => setDragging(false)}
			onDrop={onDrop}
			className={cn(
				"rounded-screen! bg-composer! has-[[data-slot=input-group-control]:focus-visible]:ring-0!",
				dragging && "bg-accent!",
				className,
			)}
		>
			{drafts.files.length > 0 ? (
				<InputGroupAddon
					align="block-start"
					className="cursor-default px-(--corner-inset) pt-6 pb-0"
				>
					<DraftFiles drafts={drafts.files} onRemove={drafts.remove} />
				</InputGroupAddon>
			) : null}
			<InputGroupTextarea
				value={text}
				disabled={disabled}
				autoFocus={autoFocus}
				onChange={(event) => setText(event.target.value)}
				onKeyDown={onKeyDown}
				onPaste={onPaste}
				placeholder={placeholder}
				aria-label="Message"
				className="max-h-80 min-h-14 px-(--corner-inset) pt-6 text-base leading-6 md:text-[0.95rem]"
			/>
			<InputGroupAddon
				align="block-end"
				className="gap-1.5 px-(--corner-inset) pb-(--corner-inset)"
			>
				<div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
					{attachments ? (
						<>
							<input
								ref={picker}
								type="file"
								multiple
								hidden
								onChange={(event) => {
									if (event.target.files !== null)
										drafts.add(event.target.files)
									event.target.value = ""
								}}
							/>
							<Tooltip>
								<TooltipTrigger
									render={
										<InputGroupButton
											variant="ghost"
											size="icon-sm"
											disabled={disabled}
											onClick={() => picker.current?.click()}
											aria-label="Add files"
											className="size-9 rounded-full text-muted-foreground"
										/>
									}
								>
									<PaperclipIcon className="size-4" />
								</TooltipTrigger>
								<TooltipContent>Add files</TooltipContent>
							</Tooltip>
						</>
					) : null}
					{tools}
				</div>
				{busy && onStop ? (
					<InputGroupButton
						variant="default"
						size="icon-sm"
						onClick={onStop}
						aria-label="Stop"
						className="size-9 rounded-full"
					>
						<SquareIcon className="size-3.5 fill-current" />
					</InputGroupButton>
				) : (
					<InputGroupButton
						variant="default"
						size="icon-sm"
						onClick={send}
						disabled={!canSend}
						aria-label="Send"
						className="size-9 rounded-full"
					>
						<ArrowUpIcon className="size-4.5" strokeWidth={2.5} />
					</InputGroupButton>
				)}
			</InputGroupAddon>
		</InputGroup>
	)
}
