import { t } from "@lingui/core/macro"
import type { Client } from "@kaicom/kay-contracts/Client"
import { Schema } from "effect"
import { useEffect, useRef, useState } from "react"
import {
	ArrowDownToLine,
	ArrowLeft,
	File,
	Folder,
	RefreshCw,
	X,
} from "lucide-react"
import { Button } from "../../components/ui/button"
import {
	ComputerFiles as Files,
	ComputerFileContent,
	childPath,
	parentPath,
	fileBytes,
	type ComputerFile,
} from "./ComputersData"

export function ComputerFiles({
	client,
	computerId,
}: {
	readonly client: Client
	readonly computerId: string
}) {
	const [path, setPath] = useState(".")
	const [pathDraft, setPathDraft] = useState(".")
	const [files, setFiles] = useState<ReadonlyArray<ComputerFile>>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [opened, setOpened] = useState<{
		name: string
		url: string
		text: string | null
	} | null>(null)
	const [revision, setRevision] = useState(0)
	const request = useRef(0)
	const mounted = useRef(true)
	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
			request.current++
		}
	}, [])
	useEffect(
		() => () => {
			if (opened !== null) URL.revokeObjectURL(opened.url)
		},
		[opened],
	)
	useEffect(() => {
		const controller = new AbortController(),
			generation = ++request.current
		setLoading(true)
		setError(null)
		setFiles([])
		setOpened(null)
		void client
			.featureCall(
				"computers.listFiles",
				{ params: { computerId }, query: { path } },
				controller.signal,
			)
			.then((value) => {
				const next = Schema.decodeUnknownSync(Files)(value)
				if (!controller.signal.aborted && request.current === generation)
					setFiles(
						[...next].sort(
							(a, b) =>
								Number(b.kind === "directory") -
									Number(a.kind === "directory") ||
								a.name.localeCompare(b.name),
						),
					)
			})
			.catch((failure) => {
				if (!controller.signal.aborted && request.current === generation)
					setError(
						failure instanceof Error
							? failure.message
							: t`Files could not be loaded.`,
					)
			})
			.finally(() => {
				if (!controller.signal.aborted && request.current === generation)
					setLoading(false)
			})
		return () => controller.abort()
	}, [client, computerId, path, revision])
	const go = (next: string) => {
		setPath(next)
		setPathDraft(next)
	}
	const open = async (file: ComputerFile) => {
		if (file.kind === "directory") {
			go(childPath({ directory: path, name: file.name }))
			return
		}
		if (file.size > 10 * 1024 * 1024) {
			setError(
				t`This file is too large to open here. Ask Kay to work with it in the computer.`,
			)
			return
		}
		const generation = ++request.current
		setLoading(true)
		setError(null)
		try {
			const value = Schema.decodeUnknownSync(ComputerFileContent)(
				await client.featureCall("computers.readFile", {
					params: { computerId },
					query: {
						path: childPath({ directory: path, name: file.name }),
						encoding: "base64",
					},
				}),
			)
			if (!mounted.current || generation !== request.current) return
			const bytes = fileBytes(value)
			const textFile =
				/\.(txt|md|csv|json|log|py|js|ts|tsx|jsx|html|css|yml|yaml|xml|sh)$/i.test(
					file.name,
				)
			setOpened({
				name: file.name,
				url: URL.createObjectURL(new Blob([new Uint8Array(bytes)])),
				text:
					textFile && bytes.length <= 1024 * 1024
						? new TextDecoder().decode(bytes)
						: null,
			})
		} catch (failure) {
			if (mounted.current && generation === request.current)
				setError(
					failure instanceof Error
						? failure.message
						: t`This file could not be opened.`,
				)
		} finally {
			if (mounted.current && generation === request.current) setLoading(false)
		}
	}
	return (
		<section className="computer-files" aria-label={t`Computer files`}>
			<div className="computer-files-toolbar">
				<Button
					variant="ghost"
					size="icon"
					aria-label={t`Parent folder`}
					disabled={path === "." || path === "/" || loading}
					onClick={() => go(parentPath(path))}
				>
					<ArrowLeft size={17} />
				</Button>
				<form
					onSubmit={(event) => {
						event.preventDefault()
						if (pathDraft.trim() !== "") go(pathDraft.trim())
					}}
				>
					<label
						className="sr-only"
						htmlFor="computer-folder"
					>{t`Folder path`}</label>
					<input
						id="computer-folder"
						value={pathDraft}
						onChange={(event) => setPathDraft(event.target.value)}
					/>
					<Button
						type="submit"
						variant="ghost"
						disabled={loading}
					>{t`Open folder`}</Button>
				</form>
				<Button
					variant="ghost"
					size="icon"
					aria-label={t`Refresh files`}
					disabled={loading}
					onClick={() => setRevision((value) => value + 1)}
				>
					<RefreshCw size={17} />
				</Button>
			</div>
			{error !== null && (
				<p role="alert" className="workflow-notice">
					{error}
				</p>
			)}
			{loading ? (
				<p className="computer-loading" role="status">{t`Loading files…`}</p>
			) : opened !== null ? (
				<div className="computer-file-preview">
					<div className="computer-files-toolbar">
						<strong>{opened.name}</strong>
						<a
							className="computer-download"
							href={opened.url}
							download={opened.name}
						>
							<ArrowDownToLine size={16} />
							{t`Download`}
						</a>
						<Button
							variant="ghost"
							size="icon"
							aria-label={t`Close preview`}
							onClick={() => setOpened(null)}
						>
							<X size={16} />
						</Button>
					</div>
					{opened.text !== null ? (
						<pre>{opened.text}</pre>
					) : (
						<p>{t`Download this file to open it on your device.`}</p>
					)}
				</div>
			) : files.length === 0 ? (
				<div className="computer-empty-folder">
					<Folder size={32} />
					<h3>{t`This folder is empty`}</h3>
					<p>{t`Files that Kay creates here will appear in this workspace.`}</p>
				</div>
			) : (
				<div className="computer-file-list">
					{files.map((file) => (
						<button
							key={file.name}
							className="computer-file-row"
							onClick={() => void open(file)}
						>
							{file.kind === "directory" ? (
								<Folder size={20} />
							) : (
								<File size={20} />
							)}
							<span>{file.name}</span>
							<small>
								{file.kind === "directory"
									? t`Folder`
									: new Intl.NumberFormat(undefined, {
											style: "unit",
											unit: "kilobyte",
											maximumFractionDigits: 1,
										}).format(file.size / 1024)}
							</small>
						</button>
					))}
				</div>
			)}
		</section>
	)
}
