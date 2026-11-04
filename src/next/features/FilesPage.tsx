import { t } from "@lingui/core/macro"
import { useLingui } from "@lingui/react"
import { Match, Schema } from "effect"
import { useEffect, useRef, useState } from "react"
import {
	ArrowDownToLine,
	ArrowUpRight,
	Check,
	File,
	FileText,
	FolderOpen,
	Image,
	Search,
	Upload,
	X,
} from "lucide-react"
import { Button } from "../../components/ui/button"
import { PageHeading } from "../Shell"
import {
	FilePage,
	WorkspaceFile,
	fileCategory,
	filePreviewKind,
	mergeFiles,
} from "./FilesData"
import {
	WorkflowNotice,
	useWorkspaceWorkflow,
	type WorkflowProps,
} from "./Workflow"
import "./FilesPage.css"
import { filesPageInput } from "./FilesQuery"
import { hasPendingFileAttachment } from "./FileAttachmentRecovery"

type Filter = "all" | "documents" | "images" | "other"
type Preview = {
	readonly fileId: string
	readonly url: string
	readonly text: string | null
}

const samples = (): ReadonlyArray<WorkspaceFile> => [
	{
		id: "sample-launch",
		filename: t`Launch brief.md`,
		mediaType: "text/markdown",
		bytes: 1812,
		status: "ready",
		createdAt: Date.UTC(2026, 9, 26, 8),
	},
	{
		id: "sample-research",
		filename: t`Customer research.md`,
		mediaType: "text/markdown",
		bytes: 3260,
		status: "ready",
		createdAt: Date.UTC(2026, 9, 25, 8),
	},
	{
		id: "sample-weekend",
		filename: t`Weekend notes.txt`,
		mediaType: "text/plain",
		bytes: 1240,
		status: "ready",
		createdAt: Date.UTC(2026, 9, 24, 8),
	},
]

const sampleContent = (file: WorkspaceFile) =>
	Match.value(file.id).pipe(
		Match.when(
			"sample-launch",
			() =>
				t`A quieter product launch\n\nThe goal\nGive people one useful thing they can try today.\n\nThe story\nStart with the problem, show the result, and leave room for a conversation.\n\nNext steps\nReview the opening paragraph and choose the first audience.\n\nThis is sample content for the interface preview.`,
		),
		Match.when(
			"sample-research",
			() =>
				t`Customer research\n\nWhat we learned\nPeople want to return to their work without losing the context around it.\n\nA useful starting point\nKeep the conversation, the decision, and the finished document close together.\n\nQuestions to explore\nWhat does a good handoff feel like?\nWhat information should stay visible?\n\nThis is sample content for the interface preview.`,
		),
		Match.orElse(
			() =>
				t`Weekend notes\n\nA little time by the sea.\nA walk without a timetable.\nA place to keep the ideas that show up along the way.\n\nThis is sample content for the interface preview.`,
		),
	)

const fileSize = (bytes: number, locale: string) => {
	const format = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
	return bytes < 1024
		? `${format.format(bytes)} B`
		: bytes < 1024 * 1024
			? `${format.format(bytes / 1024)} KB`
			: `${format.format(bytes / (1024 * 1024))} MB`
}

function FileIcon({
	file,
	size = 22,
}: {
	readonly file: WorkspaceFile
	readonly size?: number
}) {
	return Match.value(fileCategory(file)).pipe(
		Match.when("images", () => <Image size={size} aria-hidden="true" />),
		Match.when("documents", () => <FileText size={size} aria-hidden="true" />),
		Match.when("other", () => <File size={size} aria-hidden="true" />),
		Match.exhaustive,
	)
}

export function FilesPage(props: WorkflowProps) {
	const { i18n } = useLingui()
	const workflow = useWorkspaceWorkflow(props)
	const [files, setFiles] = useState<ReadonlyArray<WorkspaceFile>>(() =>
		props.client === undefined ? samples() : [],
	)
	const [next, setNext] = useState<string | null>(null)
	const [filter, setFilter] = useState<Filter>("all")
	const [query, setQuery] = useState("")
	const [selected, setSelected] = useState<WorkspaceFile | null>(null)
	const [preview, setPreview] = useState<Preview | null>(null)
	const [loading, setLoading] = useState(false)
	const [opening, setOpening] = useState(false)
	const [attaching, setAttaching] = useState(false)
	const attachLock = useRef(false)
	const attachmentRequest = useRef<AbortController | null>(null)
	const canAttach =
		props.conversationId !== undefined && props.onAttachFile !== undefined
	const [notice, setNotice] = useState<string | null>(null)
	const [readError, setReadError] = useState<string | null>(null)
	const [refresh, setRefresh] = useState(0)
	const input = useRef<HTMLInputElement>(null)
	const detail = useRef<HTMLDivElement>(null)
	const selectionTrigger = useRef<HTMLButtonElement | null>(null)
	const contentRequest = useRef<AbortController | null>(null)
	const generation = useRef(0)
	const mounted = useRef(true)
	const localFiles = useRef<Readonly<Record<string, Blob>>>({})
	const previewRef = useRef<Preview | null>(null)
	const canList = workflow.can("files.listFiles")
	const canUpload = workflow.can("files.uploadFile")
	const canRead = workflow.can("files.getFileContent")
	const filtered = files.filter(
		(file) =>
			(filter === "all" || fileCategory(file) === filter) &&
			file.filename.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
	)
	const available = workflow.preview || canList
	const checkingAttachment =
		selected !== null &&
		props.conversationId !== undefined &&
		props.bootstrap !== undefined &&
		hasPendingFileAttachment({
			storage: sessionStorage,
			identity: props.bootstrap.identity,
			chatId: props.conversationId,
			fileId: selected.id,
		})

	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
			generation.current++
			contentRequest.current?.abort()
			attachmentRequest.current?.abort()
			if (previewRef.current !== null)
				URL.revokeObjectURL(previewRef.current.url)
		}
	}, [])

	useEffect(() => {
		if (!workflow.ready || workflow.preview || !canList) return
		const controller = new AbortController()
		setLoading(true)
		setReadError(null)
		workflow
			.read("files.listFiles", filesPageInput(), controller.signal)
			.then((value) => {
				const page = Schema.decodeUnknownSync(FilePage)(value)
				if (controller.signal.aborted) return
				setFiles(page.items)
				setNext(page.next)
				setSelected((current) =>
					current === null
						? null
						: (page.items.find((file) => file.id === current.id) ?? current),
				)
			})
			.catch((failure: unknown) => {
				if (!controller.signal.aborted)
					setReadError(
						failure instanceof Error
							? failure.message
							: t`Your files could not be loaded.`,
					)
			})
			.finally(() => {
				if (!controller.signal.aborted) setLoading(false)
			})
		return () => controller.abort()
	}, [workflow.ready, workflow.preview, workflow.read, canList, refresh])

	const clearPreview = () => {
		if (previewRef.current !== null) URL.revokeObjectURL(previewRef.current.url)
		previewRef.current = null
		setPreview(null)
	}
	const loadContent = async (file: WorkspaceFile, download = false) => {
		contentRequest.current?.abort()
		const controller = new AbortController()
		contentRequest.current = controller
		const current = ++generation.current
		setOpening(true)
		setReadError(null)
		try {
			const blob = workflow.preview
				? (localFiles.current[file.id] ??
					new Blob([sampleContent(file)], { type: file.mediaType }))
				: await workflow.download(
						"files.getFileContent",
						{ params: { fileId: file.id } },
						controller.signal,
					)
			const text = filePreviewKind(file) === "text" ? await blob.text() : null
			if (
				!mounted.current ||
				controller.signal.aborted ||
				current !== generation.current
			)
				return
			const url = URL.createObjectURL(blob)
			if (download) {
				const link = document.createElement("a")
				link.href = url
				link.download = file.filename
				link.click()
				setTimeout(() => URL.revokeObjectURL(url), 1000)
			} else {
				clearPreview()
				const value = { fileId: file.id, url, text }
				previewRef.current = value
				setPreview(value)
			}
		} catch (failure) {
			if (
				mounted.current &&
				!controller.signal.aborted &&
				current === generation.current
			)
				setReadError(
					failure instanceof Error
						? failure.message
						: t`This file could not be opened.`,
				)
		} finally {
			if (mounted.current && current === generation.current) setOpening(false)
		}
	}
	const openFile = (file: WorkspaceFile) => {
		contentRequest.current?.abort()
		generation.current++
		setSelected(file)
		clearPreview()
		setReadError(null)
		setOpening(false)
		if (
			file.status === "ready" &&
			canRead &&
			filePreviewKind(file) !== "download"
		)
			void loadContent(file)
		requestAnimationFrame(() => {
			detail.current?.scrollIntoView({ block: "nearest", behavior: "auto" })
			detail.current?.focus({ preventScroll: true })
		})
	}
	const closeFile = () => {
		contentRequest.current?.abort()
		generation.current++
		setSelected(null)
		clearPreview()
		setOpening(false)
		setReadError(null)
		if (selectionTrigger.current?.isConnected === true)
			selectionTrigger.current.focus()
	}
	const upload = async (file: globalThis.File) => {
		setNotice(null)
		setReadError(null)
		try {
			const uploaded = workflow.preview
				? {
						id: `preview-${crypto.randomUUID()}`,
						filename: file.name,
						mediaType: file.type || "application/octet-stream",
						bytes: file.size,
						status: "ready" as const,
						createdAt: Date.now(),
					}
				: Schema.decodeUnknownSync(WorkspaceFile)(
						await workflow.call("files.uploadFile", {}, file),
					)
			if (!mounted.current) return
			if (workflow.preview)
				localFiles.current = { ...localFiles.current, [uploaded.id]: file }
			setFiles((current) => [
				uploaded,
				...current.filter((entry) => entry.id !== uploaded.id),
			])
			setQuery("")
			setFilter("all")
			if (!workflow.preview) setRefresh((current) => current + 1)
			setNotice(
				workflow.preview
					? t`Added to this preview only. Nothing was uploaded.`
					: uploaded.status === "ready"
						? t`Your file is ready to use.`
						: t`Your file is being prepared.`,
			)
			selectionTrigger.current = null
			openFile(uploaded)
		} catch (failure) {
			if (mounted.current)
				setReadError(
					failure instanceof Error
						? failure.message
						: t`This file could not be uploaded.`,
				)
		}
	}
	const loadMore = async () => {
		if (next === null || loading) return
		setLoading(true)
		setReadError(null)
		try {
			const page = Schema.decodeUnknownSync(FilePage)(
				await workflow.read("files.listFiles", filesPageInput(next)),
			)
			if (!mounted.current) return
			setFiles((current) => mergeFiles(current, page.items))
			setNext(page.next === next ? null : page.next)
		} catch (failure) {
			if (mounted.current)
				setReadError(
					failure instanceof Error
						? failure.message
						: t`More files could not be loaded.`,
				)
		} finally {
			if (mounted.current) setLoading(false)
		}
	}
	const filters: ReadonlyArray<{
		readonly id: Filter
		readonly label: string
	}> = [
		{ id: "all", label: t`All files` },
		{ id: "documents", label: t`Documents` },
		{ id: "images", label: t`Images` },
		{ id: "other", label: t`Other files` },
	]
	const useSelectedFile = async (file: WorkspaceFile) => {
		const attachment = {
			fileId: file.id,
			name: file.filename,
			type: file.mediaType.startsWith("image/")
				? ("image" as const)
				: ("file" as const),
		}
		if (
			props.conversationId === undefined ||
			props.onAttachFile === undefined
		) {
			props.onUseFile?.(attachment)
			return
		}
		if (attachLock.current) return
		attachLock.current = true
		const controller = new AbortController()
		attachmentRequest.current = controller
		setAttaching(true)
		setReadError(null)
		try {
			await props.onAttachFile(
				attachment,
				props.conversationId,
				controller.signal,
			)
		} catch (failure) {
			if (mounted.current)
				setReadError(
					failure instanceof Error
						? failure.message
						: t`The file could not be saved to this conversation.`,
				)
		} finally {
			attachLock.current = false
			if (mounted.current) setAttaching(false)
		}
	}

	return (
		<section
			className="workflow-page files-page"
			data-detail={selected !== null || undefined}
		>
			<PageHeading
				title={t`Your work, close at hand.`}
				description={t`Find what you saved, take a look, and bring it into your next conversation.`}
			>
				{canUpload && (
					<Button
						onClick={() => input.current?.click()}
						disabled={workflow.busy || workflow.unconfirmed !== null}
					>
						<Upload size={17} />
						{workflow.busy ? t`Uploading…` : t`Upload a file`}
					</Button>
				)}
				<input
					ref={input}
					className="sr-only"
					type="file"
					tabIndex={-1}
					aria-label={t`Choose a file to upload`}
					onChange={(event) => {
						const file = event.target.files?.[0]
						event.target.value = ""
						if (file !== undefined) void upload(file)
					}}
				/>
			</PageHeading>
			<WorkflowNotice workflow={workflow} />
			{notice !== null && (
				<p className="files-notice" role="status">
					<Check size={16} />
					{notice}
				</p>
			)}
			{readError !== null && workflow.error === null && (
				<div className="files-error" role="alert">
					{readError}
					<Button
						variant="ghost"
						disabled={loading}
						onClick={() => {
							workflow.clearError()
							setRefresh((current) => current + 1)
						}}
					>{t`Refresh files`}</Button>
				</div>
			)}
			{!workflow.loading && !available ? (
				<div className="workflow-empty">
					<FolderOpen size={28} />
					<h2>{t`Files are not available for this account.`}</h2>
					<p>{t`You can keep working in your conversations.`}</p>
				</div>
			) : (
				<>
					<div className="files-toolbar">
						<nav
							className="workflow-tabs files-filters"
							aria-label={t`File types`}
						>
							{filters.map((item) => (
								<button
									key={item.id}
									type="button"
									aria-pressed={filter === item.id}
									onClick={() => setFilter(item.id)}
								>
									{item.label}
								</button>
							))}
						</nav>
						<label className="workflow-search files-search">
							<Search size={17} />
							<span className="sr-only">{t`Search files`}</span>
							<input
								value={query}
								placeholder={t`Search files`}
								onChange={(event) => setQuery(event.target.value)}
							/>
						</label>
					</div>
					<div
						className="files-layout"
						data-detail={selected !== null || undefined}
					>
						<div className="files-library">
							<div className="files-section-title">
								<h2>{query !== "" ? t`Search results` : t`Recently saved`}</h2>
								<span>{filtered.length}</span>
								{!workflow.preview && canList && (
									<button
										type="button"
										onClick={() => setRefresh((current) => current + 1)}
										disabled={loading}
									>{t`Refresh`}</button>
								)}
							</div>
							{workflow.loading || (loading && files.length === 0) ? (
								<div
									className="files-skeleton"
									role="status"
									aria-label={t`Loading files`}
								>
									<i />
									<i />
									<i />
								</div>
							) : filtered.length === 0 ? (
								<div className="workflow-empty files-empty">
									<FolderOpen size={30} />
									<h2>
										{files.length === 0
											? t`A place for what you make.`
											: t`No files match yet.`}
									</h2>
									<p>
										{files.length === 0
											? t`Upload a document or image, then use it in a conversation with Kay.`
											: t`Try another name or choose a different file type.`}
									</p>
									{query !== "" && (
										<Button
											variant="outline"
											onClick={() => {
												setQuery("")
												setFilter("all")
											}}
										>{t`Show all files`}</Button>
									)}
								</div>
							) : (
								<div className="files-grid">
									{filtered.map((file) => (
										<button
											key={file.id}
											type="button"
											className="files-card"
											aria-pressed={selected?.id === file.id}
											onClick={(event) => {
												selectionTrigger.current = event.currentTarget
												openFile(file)
											}}
										>
											<div
												className="files-card-art"
												data-category={fileCategory(file)}
											>
												<FileIcon file={file} size={34} />
												<span>
													{file.filename
														.split(".")
														.at(-1)
														?.slice(0, 8)
														.toUpperCase()}
												</span>
											</div>
											<div className="files-card-copy">
												<strong>{file.filename}</strong>
												<span>
													{fileSize(file.bytes, i18n.locale)}
													<span aria-hidden="true"> · </span>
													{file.status === "pending"
														? t`Preparing`
														: new Intl.DateTimeFormat(i18n.locale, {
																month: "short",
																day: "numeric",
															}).format(file.createdAt)}
												</span>
											</div>
										</button>
									))}
								</div>
							)}
							{next !== null && (
								<Button
									className="files-more"
									variant="outline"
									disabled={loading}
									onClick={() => void loadMore()}
								>
									{loading ? t`Loading…` : t`Load more files`}
								</Button>
							)}
							{workflow.preview && (
								<p className="files-preview-note">{t`Sample files. Uploads stay in this preview and are cleared when you leave.`}</p>
							)}
						</div>
						{selected !== null && (
							<div
								className="files-detail"
								ref={detail}
								tabIndex={-1}
								role="region"
								aria-label={t`File preview`}
							>
								<div className="files-detail-top">
									<span className="files-detail-icon">
										<FileIcon file={selected} />
									</span>
									<button
										type="button"
										className="files-close"
										aria-label={t`Close file preview`}
										onClick={closeFile}
									>
										<X size={18} />
									</button>
								</div>
								<h2>{selected.filename}</h2>
								<p className="files-detail-meta">
									{fileSize(selected.bytes, i18n.locale)} ·{" "}
									{new Intl.DateTimeFormat(i18n.locale, {
										dateStyle: "medium",
									}).format(selected.createdAt)}
								</p>
								{opening ? (
									<div
										className="files-content-loading"
										role="status"
									>{t`Opening your file…`}</div>
								) : preview?.fileId === selected.id ? (
									preview.text !== null ? (
										<pre className="files-text-preview">{preview.text}</pre>
									) : (
										<img
											className="files-image-preview"
											src={preview.url}
											alt={selected.filename}
										/>
									)
								) : (
									<div className="files-no-preview">
										<FileIcon file={selected} size={32} />
										<p>
											{selected.status === "pending"
												? t`This file is still being prepared. Refresh the library in a moment.`
												: canRead
													? t`Download this file to view its full content.`
													: t`File content is not available for this account.`}
										</p>
									</div>
								)}
								<div className="files-detail-actions">
									{selected.status === "ready" && (
										<>
											{(props.onUseFile !== undefined || canAttach) && (
												<Button
													disabled={attaching}
													onClick={() => void useSelectedFile(selected)}
												>
													<ArrowUpRight size={16} />
													{attaching
														? checkingAttachment
															? t`Checking…`
															: t`Saving…`
														: checkingAttachment
															? t`Check saved file`
															: canAttach
																? t`Save to this conversation`
																: t`Use in a conversation`}
												</Button>
											)}
											{canRead && (
												<Button
													variant="outline"
													disabled={opening}
													onClick={() => void loadContent(selected, true)}
												>
													<ArrowDownToLine size={16} />
													{t`Download`}
												</Button>
											)}
										</>
									)}
								</div>
								{(props.onUseFile !== undefined || canAttach) &&
									selected.status === "ready" && (
										<p className="files-detail-hint">
											{canAttach
												? t`Keep this file with the conversation for later.`
												: t`Adds the file to a new draft. You choose what to ask before sending.`}
										</p>
									)}
							</div>
						)}
					</div>
				</>
			)}
		</section>
	)
}
