import { t } from "@lingui/core/macro"
import { Schema } from "effect"
import { useRef, useState } from "react"
import { Button } from "../../components/ui/button"
import { ImportConnections } from "./ImportConnections"
import {
	importedConnections,
	type ImportedEntry,
} from "./ImportConnectionsData"
import { objectOf } from "./SchemaValues"
import type { useWorkspaceWorkflow } from "./Workflow"
import type { FeatureInput } from "./FeatureData"

export function ConnectionTransfer({
	workflow,
	onChanged,
}: {
	readonly workflow: ReturnType<typeof useWorkspaceWorkflow>
	readonly onChanged: () => Promise<unknown>
}) {
	const [entries, setEntries] = useState<ReadonlyArray<ImportedEntry>>([])
	const [completed, setCompleted] = useState<ReadonlyArray<string>>([])
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)
	const file = useRef<HTMLInputElement>(null)
	const disabled =
		loading ||
		workflow.busy ||
		workflow.unconfirmed !== null ||
		workflow.preview
	const report = (failure: unknown) =>
		setError(
			failure instanceof Error
				? failure.message
				: t`This request could not be completed.`,
		)
	const prepare = async (file: File) => {
		if (disabled) return
		setLoading(true)
		setError(null)
		try {
			if (file.size > 1024 * 1024)
				throw new Error(t`Choose an App export file smaller than 1 MB.`)
			const payload = Schema.decodeUnknownSync(Schema.Json)(
				JSON.parse(await file.text()),
			)
			const result = await workflow.call("appExperience.import", { payload })
			setEntries(importedConnections(result))
			setCompleted([])
		} catch (failure) {
			report(failure)
		} finally {
			setLoading(false)
		}
	}
	const download = async () => {
		setLoading(true)
		setError(null)
		try {
			const result = await workflow.read("appExperience.export")
			const url = URL.createObjectURL(
				new Blob([JSON.stringify(result, null, 2)], {
					type: "application/json",
				}),
			)
			const link = document.createElement("a")
			link.href = url
			link.download = "kay-apps.json"
			link.click()
			window.setTimeout(() => URL.revokeObjectURL(url), 1000)
		} catch (failure) {
			report(failure)
		} finally {
			setLoading(false)
		}
	}
	const create = async (command: FeatureInput) => {
		try {
			await workflow.call("connections.createConnection", command)
			const draft = objectOf(command.payload)["draftId"]
			if (typeof draft === "string")
				setCompleted((current) => [...current, draft])
			await onChanged()
		} catch (failure) {
			report(failure)
		}
	}
	if (
		!workflow.can("appExperience.import") &&
		!workflow.can("appExperience.export")
	)
		return null
	return (
		<div className="connection-transfer">
			<div className="connection-actions">
				{workflow.can("appExperience.import") && (
					<>
						<input
							ref={file}
							type="file"
							accept=".json,application/json"
							hidden
							onChange={(event) => {
								const chosen = event.target.files?.[0]
								event.target.value = ""
								if (chosen !== undefined) void prepare(chosen)
							}}
						/>
						<Button
							variant="ghost"
							disabled={disabled}
							onClick={() => file.current?.click()}
						>{t`Import apps`}</Button>
					</>
				)}
				{workflow.can("appExperience.export") && (
					<Button
						variant="ghost"
						disabled={disabled}
						onClick={() => void download()}
					>{t`Export apps`}</Button>
				)}
			</div>
			{error !== null && (
				<p className="workflow-notice" role="alert">
					{error}
				</p>
			)}
			{entries.length > 0 && (
				<ImportConnections
					entries={entries}
					completed={completed}
					disabled={disabled}
					onCreate={create}
				/>
			)}
		</div>
	)
}
