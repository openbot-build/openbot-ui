import { t } from "@lingui/core/macro"
import * as Product from "@kaicom/kay-contracts"
import { RequestFailed, type Client } from "@kaicom/kay-contracts/Client"
import { Schema } from "effect"
import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "../../components/ui/button"
import type { Attachment } from "../Model"
import type { FeatureInput } from "./FeatureData"
import {
	changeKey,
	jsonValue,
	readUnconfirmed,
	writeUnconfirmed,
	type UnconfirmedChange,
} from "./RequestState"
import "./Workflow.css"

const activeWrites = new Set<string>()

export interface WorkflowProps {
	readonly client?: Client | undefined
	readonly bootstrap?: Product.Bootstrap | undefined
	readonly onOpenChat: (id: string) => void
	readonly onStartConversation: (prompt?: string) => void
	readonly onUseFile?: ((attachment: Attachment) => void) | undefined
	readonly onAttachFile?:
		| ((
				attachment: Attachment,
				chatId: string,
				signal: AbortSignal,
		  ) => Promise<void>)
		| undefined
	readonly conversationId?: string | undefined
}

/** Product pages share the existing transport and account-scoped write receipt. */
export function useWorkspaceWorkflow({
	client,
	bootstrap,
}: Pick<WorkflowProps, "client" | "bootstrap">) {
	const preview = client === undefined
	const owner =
		bootstrap === undefined
			? "preview"
			: changeKey(bootstrap.identity.userId, bootstrap.identity.organizationId)
	const [catalog, setCatalog] = useState<
		ReadonlyArray<Product.FeatureOperation>
	>([])
	const [ready, setReady] = useState(preview)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [unconfirmed, setUnconfirmed] = useState<UnconfirmedChange | null>(
		() => (preview ? null : readUnconfirmed(sessionStorage, owner)),
	)
	const [reviewed, setReviewed] = useState(false)
	const receiptRef = useRef(unconfirmed)
	const receiptVersion = useRef(0)
	const lock = useRef(false)
	const current = useRef({ owner, client, alive: true })
	useEffect(() => {
		const scope = { owner, client, alive: true }
		current.current = scope
		setReady(preview)
		setCatalog([])
		setError(null)
		setReviewed(false)
		receiptRef.current = preview ? null : readUnconfirmed(sessionStorage, owner)
		setUnconfirmed(receiptRef.current)
		if (client !== undefined)
			void client
				.featureCatalog()
				.then((value) => {
					if (scope.alive) {
						setCatalog(value)
						setReady(true)
					}
				})
				.catch((failure) => {
					if (scope.alive) {
						setError(
							failure instanceof Error
								? failure.message
								: t`Available features could not be loaded.`,
						)
						setReady(true)
					}
				})
		return () => {
			scope.alive = false
		}
	}, [client, owner, preview])
	const can = useCallback(
		(id: string) => preview || catalog.some((operation) => operation.id === id),
		[catalog, preview],
	)
	const operation = useCallback(
		(id: string) => {
			if (
				!current.current.alive ||
				current.current.client !== client ||
				current.current.owner !== owner
			)
				throw new Error("This workspace is no longer active.")
			if (client === undefined)
				throw new Error("The design preview cannot call a service.")
			const found = catalog.find((item) => item.id === id)
			if (found === undefined)
				throw new Error(t`This action is not available for this account.`)
			return found
		},
		[client, catalog, owner],
	)
	const report = useCallback(
		(failure: unknown, scope: typeof current.current, signal?: AbortSignal) => {
			if (current.current === scope && scope.alive && signal?.aborted !== true)
				setError(
					failure instanceof Error
						? failure.message
						: t`This request could not be completed.`,
				)
		},
		[],
	)
	const read = useCallback(
		async (
			id: string,
			input: FeatureInput = {},
			signal?: AbortSignal,
		): Promise<unknown> => {
			const scope = current.current
			const version = receiptVersion.current
			try {
				if (operation(id).method !== "GET")
					throw new Error("A read must not change a resource.")
				const value = await client!.featureCall(
					id,
					Schema.decodeUnknownSync(Product.FeatureInput)(jsonValue(input)),
					signal,
				)
				if (
					current.current !== scope ||
					!scope.alive ||
					signal?.aborted === true
				)
					throw new Error("This workspace is no longer active.")
				if (version === receiptVersion.current && !activeWrites.has(owner))
					setReviewed(true)
				setError(null)
				return value
			} catch (failure) {
				report(failure, scope, signal)
				throw failure
			}
		},
		[client, operation, report, owner],
	)
	const download = useCallback(
		async (
			id: string,
			input: FeatureInput = {},
			signal?: AbortSignal,
		): Promise<Blob> => {
			const scope = current.current
			try {
				const action = operation(id)
				if (action.method !== "GET" || action.transport !== "binary")
					throw new Error("A download must read binary content.")
				const response = await client!.featureResponse(
					id,
					Schema.decodeUnknownSync(Product.FeatureInput)(jsonValue(input)),
					signal,
				)
				const blob = await response.blob()
				if (
					current.current !== scope ||
					!scope.alive ||
					signal?.aborted === true
				)
					throw new Error("This workspace is no longer active.")
				return blob
			} catch (failure) {
				report(failure, scope, signal)
				throw failure
			}
		},
		[client, operation, report],
	)
	const call = useCallback(
		async (
			id: string,
			input: FeatureInput = {},
			file?: File,
		): Promise<unknown> => {
			const scope = current.current
			const action = operation(id)
			if (action.method === "GET") return read(id, input)
			if (
				lock.current ||
				activeWrites.has(owner) ||
				receiptRef.current !== null ||
				readUnconfirmed(sessionStorage, owner) !== null
			)
				throw new Error(
					t`Check the previous change before trying another action.`,
				)
			const command = Schema.decodeUnknownSync(Product.FeatureInput)(
				jsonValue(input),
				{ onExcessProperty: "error" },
			)
			if (action.transport === "multipart" && file === undefined)
				throw new Error(t`Choose a file to upload.`)
			const receipt = { operation: id, title: action.title }
			lock.current = true
			activeWrites.add(owner)
			setBusy(true)
			setError(null)
			setReviewed(false)
			receiptRef.current = receipt
			receiptVersion.current++
			writeUnconfirmed(sessionStorage, owner, receipt)
			setUnconfirmed(receipt)
			const clearReceipt = () => {
				writeUnconfirmed(sessionStorage, owner, null)
				if (current.current === scope && scope.alive) {
					receiptRef.current = null
					setUnconfirmed(null)
				}
			}
			try {
				const value =
					action.transport === "multipart"
						? await client!.featureUpload(id, file!, command)
						: await client!.featureCall(id, command)
				clearReceipt()
				if (current.current !== scope || !scope.alive)
					throw new Error("This workspace is no longer active.")
				return value
			} catch (failure) {
				if (
					failure instanceof RequestFailed &&
					failure.problem.code !== "outcome_unknown"
				)
					clearReceipt()
				report(failure, scope)
				throw failure
			} finally {
				lock.current = false
				activeWrites.delete(owner)
				if (current.current === scope && scope.alive) setBusy(false)
			}
		},
		[client, operation, owner, read, report],
	)
	const confirmReviewed = useCallback(() => {
		if (!reviewed || lock.current || activeWrites.has(owner)) return
		receiptRef.current = null
		receiptVersion.current++
		writeUnconfirmed(sessionStorage, owner, null)
		setUnconfirmed(null)
		setReviewed(false)
		setError(null)
	}, [owner, reviewed])
	const clearError = useCallback(() => setError(null), [])
	return {
		preview,
		ready,
		loading: !ready,
		busy,
		error,
		catalog,
		can,
		read,
		call,
		download,
		unconfirmed,
		reviewed,
		confirmReviewed,
		clearError,
	}
}

export function WorkflowNotice({
	workflow,
}: {
	readonly workflow: ReturnType<typeof useWorkspaceWorkflow>
}) {
	return (
		<>
			{workflow.error !== null && (
				<div className="workflow-notice" role="alert">
					{workflow.error}
				</div>
			)}
			{workflow.unconfirmed !== null && !workflow.busy && (
				<div className="workflow-notice" role="alert">
					<p>{t`The outcome is not confirmed. Refresh the resource or operation record before sending another change.`}</p>
					<p>{workflow.unconfirmed.title}</p>
					<Button
						variant="outline"
						disabled={!workflow.reviewed}
						onClick={workflow.confirmReviewed}
					>{t`I checked the current state`}</Button>
				</div>
			)}
		</>
	)
}
