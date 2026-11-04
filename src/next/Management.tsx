import { writeClipboard } from "../lib/runtime"
import { useEffect, useRef, useState } from "react"
import { t } from "@lingui/core/macro"
import type * as Product from "@kaicom/kay-contracts"
import type { Client } from "@kaicom/kay-contracts/Client"
import { RequestFailed } from "@kaicom/kay-contracts/Client"
import { Button } from "../components/ui/button"
import { preferencesFrom, type ProductPreferences } from "./ProductModel"

export function Management({
	client,
	chat,
	title,
	preferences,
	onPreferences,
	onChanged,
	onDeleted,
}: {
	readonly client: Client
	readonly chat: Product.Conversation
	readonly title: string
	readonly preferences: ProductPreferences
	readonly onPreferences: (value: ProductPreferences) => void
	readonly onChanged: () => Promise<unknown>
	readonly onDeleted: () => void
}) {
	const [metadata, setMetadata] = useState<Product.ChatMetadata | null>(null)
	const [name, setName] = useState(title)
	const [projectName, setProjectName] = useState("")
	const [confirmDelete, setConfirmDelete] = useState(false)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<unknown>(null)
	const [notice, setNotice] = useState("")
	const lock = useRef(false)
	useEffect(() => {
		const controller = new AbortController()
		setMetadata(null)
		setConfirmDelete(false)
		setError(null)
		void client
			.chatMetadata(chat.id, controller.signal)
			.then((value) => {
				if (!controller.signal.aborted) {
					setMetadata(value)
					setName(value.title ?? title)
				}
			})
			.catch((failure: unknown) => {
				if (!controller.signal.aborted) setError(failure)
			})
		return () => controller.abort()
	}, [chat.id])
	const run = async (work: () => Promise<unknown>) => {
		if (lock.current) return
		lock.current = true
		setBusy(true)
		setError(null)
		setNotice("")
		try {
			await work()
		} catch (failure) {
			setError(failure)
		} finally {
			lock.current = false
			setBusy(false)
		}
	}
	const patch = (change: {
		readonly title?: string | null
		readonly archived?: boolean
	}) => {
		if (metadata === null) return
		void run(async () => {
			setMetadata(
				await client.patchChatMetadata(chat.id, {
					expected: metadata.revision,
					...change,
				}),
			)
			await onChanged()
		})
	}
	const pinned = preferences.pinned.includes(chat.id)
	return (
		<section className="next-management">
			<h3>{t`Manage conversation`}</h3>
			{error !== null && (
				<div className="next-live-error" role="alert">
					<p>
						{error instanceof Error
							? error.message
							: t`Kay could not finish this request.`}
					</p>
					{error instanceof RequestFailed &&
						error.problem.code === "outcome_unknown" && (
							<p>{t`The result is uncertain. Review the saved conversation before sending again.`}</p>
						)}
					<Button
						variant="outline"
						disabled={busy}
						onClick={() => {
							void run(async () => {
								setMetadata(await client.chatMetadata(chat.id))
								onPreferences(preferencesFrom(await client.preferences()))
								await onChanged()
							})
						}}
					>{t`Refresh`}</Button>
				</div>
			)}
			{notice !== "" && <p role="status">{notice}</p>}
			<form
				className="next-management-title"
				onSubmit={(event) => {
					event.preventDefault()
					patch({ title: name.trim() === "" ? null : name.trim() })
				}}
			>
				<label htmlFor="next-conversation-name">{t`Title`}</label>
				<input
					id="next-conversation-name"
					value={name}
					maxLength={200}
					onChange={(event) => setName(event.target.value)}
				/>
				<Button
					type="submit"
					variant="outline"
					disabled={busy || metadata === null}
				>{t`Rename`}</Button>
			</form>
			<div className="next-detail-actions">
				<Button
					variant="outline"
					disabled={busy}
					onClick={() => {
						void run(async () =>
							onPreferences(
								preferencesFrom(
									await client.patchPreferences({
										_tag: "SetPin",
										sessionId: chat.id,
										pinned: !pinned,
									}),
								),
							),
						)
					}}
				>
					{pinned ? t`Unpin` : t`Pin`}
				</Button>
				<Button
					variant="outline"
					disabled={busy || metadata === null}
					onClick={() => patch({ archived: metadata?.archived !== true })}
				>
					{metadata?.archived === true ? t`Unarchive` : t`Archive`}
				</Button>
			</div>
			<label className="next-management-title">
				{t`Project`}
				<select
					disabled={busy}
					value={
						preferences.projects.find((project) =>
							project.sessions.includes(chat.id),
						)?.id ?? ""
					}
					onChange={(event) => {
						const id = event.target.value
						void run(async () =>
							onPreferences(
								preferencesFrom(
									await client.patchPreferences({
										_tag: "MoveToProject",
										sessionId: chat.id,
										projectId: id === "" ? null : id,
									}),
								),
							),
						)
					}}
				>
					<option value="">{t`No project`}</option>
					{preferences.projects.map((project) => (
						<option key={project.id} value={project.id}>
							{project.name}
						</option>
					))}
				</select>
			</label>
			<form
				className="next-management-title"
				onSubmit={(event) => {
					event.preventDefault()
					if (projectName.trim() !== "")
						void run(async () => {
							onPreferences(
								preferencesFrom(
									await client.patchPreferences({
										_tag: "CreateProject",
										id: crypto.randomUUID(),
										name: projectName.trim(),
										sessionId: chat.id,
									}),
								),
							)
							setProjectName("")
						})
				}}
			>
				<label htmlFor="next-project-name">{t`New project`}</label>
				<input
					id="next-project-name"
					value={projectName}
					maxLength={60}
					onChange={(event) => setProjectName(event.target.value)}
				/>
				<Button
					type="submit"
					variant="outline"
					disabled={busy || projectName.trim() === ""}
				>{t`Create project`}</Button>
			</form>
			<div className="next-detail-actions">
				<Button
					variant="ghost"
					disabled={busy}
					onClick={() => {
						void run(async () => {
							await writeClipboard(
								`${location.origin}/?chat=${encodeURIComponent(chat.id)}`,
							)
							setNotice(
								t`Conversation link copied. Access still requires permission.`,
							)
						})
					}}
				>{t`Copy conversation link`}</Button>
				<Button
					variant="ghost"
					disabled={busy}
					onClick={() => {
						void run(async () => {
							let page = await client.messages(chat.id)
							let items = [...page.items]
							while (page.next !== null) {
								page = await client.messages(chat.id, page.next)
								items = [...page.items, ...items]
							}
							const blob = new Blob(
								[
									JSON.stringify(
										{
											conversation: chat,
											title: metadata?.title ?? title,
											messages: items,
										},
										null,
										2,
									),
								],
								{ type: "application/json" },
							)
							const url = URL.createObjectURL(blob)
							const link = document.createElement("a")
							link.href = url
							link.download = `kay-${chat.id}.json`
							link.click()
							URL.revokeObjectURL(url)
						})
					}}
				>{t`Export conversation`}</Button>
			</div>
			{confirmDelete ? (
				<div className="next-live-error">
					<p>{t`Delete this conversation and its saved history?`}</p>
					<Button
						variant="destructive"
						disabled={busy}
						onClick={() => {
							void run(async () => {
								await client.featureCall("chats.deleteChat", {
									params: { chatId: chat.id },
								})
								await onChanged()
								onDeleted()
							})
						}}
					>{t`Delete conversation`}</Button>
					<Button
						variant="ghost"
						onClick={() => setConfirmDelete(false)}
					>{t`Cancel`}</Button>
				</div>
			) : (
				<Button
					variant="ghost"
					disabled={busy}
					onClick={() => setConfirmDelete(true)}
				>{t`Delete conversation`}</Button>
			)}
		</section>
	)
}
