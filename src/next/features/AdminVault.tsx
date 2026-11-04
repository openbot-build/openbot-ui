import { t } from "@lingui/core/macro"
import type * as Product from "@kaicom/kay-contracts"
import { useEffect, useState } from "react"
import { Plus, KeyRound, Trash2 } from "lucide-react"
import { Button } from "../../components/ui/button"
import { adminRecordKey, adminRecordName } from "./AdminData"
import { rowsOf } from "./FeatureData"
import { objectOf, type JsonObject } from "./SchemaValues"
import type { useWorkspaceWorkflow } from "./Workflow"

/** Vault contents are a credential task, never a raw values-map editor. */
export function AdminVault({
	vault,
	workflow,
	bootstrap,
}: {
	readonly vault: JsonObject
	readonly workflow: ReturnType<typeof useWorkspaceWorkflow>
	readonly bootstrap: Product.Bootstrap
}) {
	const vaultId = adminRecordKey(vault)
	const [items, setItems] = useState<ReadonlyArray<JsonObject>>([])
	const [connections, setConnections] = useState<ReadonlyArray<JsonObject>>([])
	const [granted, setGranted] = useState(false)
	const [loaded, setLoaded] = useState(false)
	const [editor, setEditor] = useState<JsonObject | "new" | null>(null)
	const [name, setName] = useState("")
	const [description, setDescription] = useState("")
	const [values, setValues] = useState<
		ReadonlyArray<{ name: string; secret: string }>
	>([{ name: "api_key", secret: "" }])
	const [exits, setExits] = useState<ReadonlyArray<unknown>>([])
	const [replace, setReplace] = useState(false)
	const [remove, setRemove] = useState<JsonObject | null>(null)
	const [error, setError] = useState<string | null>(null)
	const disabled = workflow.busy || workflow.unconfirmed !== null
	const refresh = async (signal?: AbortSignal) => {
		const results = await Promise.allSettled([
			workflow.read("vaults.listVaultItems", { params: { vaultId } }, signal),
			workflow.can("vaults.listVaultBots")
				? workflow.read("vaults.listVaultBots", { params: { vaultId } }, signal)
				: Promise.resolve([]),
			workflow.can("connections.listConnections")
				? workflow.read("connections.listConnections", {}, signal)
				: Promise.resolve([]),
		])
		if (signal?.aborted === true) return
		if (results[0].status === "fulfilled") {
			setItems(rowsOf(results[0].value).map(objectOf))
			setLoaded(true)
		}
		if (results[1].status === "fulfilled")
			setGranted(
				rowsOf(results[1].value).some(
					(item) => objectOf(item)["bot"] === bootstrap.defaultBotId,
				),
			)
		if (results[2].status === "fulfilled")
			setConnections(rowsOf(results[2].value).map(objectOf))
	}
	useEffect(() => {
		const controller = new AbortController()
		setEditor(null)
		setLoaded(false)
		setRemove(null)
		void refresh(controller.signal)
		return () => controller.abort()
	}, [vaultId, bootstrap.identity.userId, bootstrap.identity.organizationId])
	const open = (item: JsonObject | "new") => {
		setEditor(item)
		setError(null)
		setReplace(false)
		setName(item === "new" ? "" : String(item["name"] ?? ""))
		setDescription(item === "new" ? "" : String(item["description"] ?? ""))
		setExits(
			item === "new" ? [] : Array.isArray(item["exits"]) ? item["exits"] : [],
		)
		setValues(
			item === "new"
				? [{ name: "api_key", secret: "" }]
				: (Array.isArray(item["fields"]) ? item["fields"] : []).map((name) => ({
						name: String(name),
						secret: "",
					})),
		)
	}
	const save = async () => {
		if (editor === null) return
		try {
			const writingValues = editor === "new" || replace
			if (
				writingValues &&
				(values.length === 0 ||
					values.some(
						(entry) => entry.name.trim() === "" || entry.secret === "",
					) ||
					new Set(values.map((entry) => entry.name.trim())).size !==
						values.length)
			)
				throw new Error(
					t`Give each credential field a different name and enter its new value.`,
				)
			await workflow.call(
				editor === "new" ? "vaults.createVaultItem" : "vaults.updateVaultItem",
				{
					params: {
						vaultId,
						...(editor === "new" ? {} : { itemId: adminRecordKey(editor) }),
					},
					payload: {
						name: name.trim(),
						description,
						exits,
						...(editor === "new"
							? { source: { _tag: "Builtin" } }
							: { expectedVersion: editor["version"] }),
						...(writingValues
							? {
									values: Object.fromEntries(
										values.map((entry) => [entry.name.trim(), entry.secret]),
									),
								}
							: {}),
					},
				},
			)
			setEditor(null)
			setValues([])
			await refresh()
		} catch (failure) {
			setError(
				failure instanceof Error
					? failure.message
					: t`This request could not be completed.`,
			)
		}
	}
	const access = async () => {
		try {
			await workflow.call(
				granted ? "vaults.revokeVault" : "vaults.grantVault",
				{ params: { vaultId, botId: bootstrap.defaultBotId } },
			)
			await refresh()
		} catch {
			/* Shared receipt keeps unresolved writes visible. */
		}
	}
	return (
		<section className="admin-vault">
			<div className="admin-resource-heading">
				<div>
					<h4>{t`Credentials in this vault`}</h4>
					<p>{t`Save values once, then allow only the connected Apps that should receive them.`}</p>
				</div>
				{workflow.can("vaults.createVaultItem") && editor === null && (
					<Button
						variant="outline"
						disabled={disabled}
						onClick={() => open("new")}
					>
						<Plus size={16} />
						{t`Add credential`}
					</Button>
				)}
			</div>
			{workflow.can(granted ? "vaults.revokeVault" : "vaults.grantVault") && (
				<div className="admin-vault-access">
					<div>
						<strong>{t`Kay Bot access`}</strong>
						<p>
							{granted
								? t`Kay Bot can use the credentials in this vault for the Apps you allow.`
								: t`Kay Bot cannot use this vault yet.`}
						</p>
					</div>
					<Button
						variant="outline"
						disabled={disabled || !loaded}
						onClick={() => void access()}
					>
						{granted ? t`Revoke access` : t`Allow access`}
					</Button>
				</div>
			)}
			{editor === null ? (
				<div className="admin-record-list">
					{loaded && items.length === 0 && (
						<p className="admin-empty">{t`No credentials yet. Add the first one when a connected App needs it.`}</p>
					)}
					{items.map((item) => (
						<div key={adminRecordKey(item)} className="admin-vault-row">
							<button disabled={disabled} onClick={() => open(item)}>
								<KeyRound size={18} />
								<span>
									<strong>{adminRecordName(item, t`Credential`)}</strong>
									<small>
										{String(item["description"] ?? "") ||
											t`Secret values are hidden`}
									</small>
								</span>
							</button>
							{workflow.can("vaults.deleteVaultItem") && (
								<Button
									variant="ghost"
									aria-label={t`Remove credential`}
									disabled={disabled}
									onClick={() => setRemove(item)}
								>
									<Trash2 size={15} />
								</Button>
							)}
						</div>
					))}
				</div>
			) : (
				<form
					className="admin-editor"
					onSubmit={(event) => {
						event.preventDefault()
						void save()
					}}
				>
					<fieldset className="admin-form-lock" disabled={workflow.busy}>
						<h4>{editor === "new" ? t`Add credential` : t`Edit credential`}</h4>
						<div className="admin-form-fields">
							<label className="admin-field">
								<span>{t`Credential name`}</span>
								<input
									required
									value={name}
									onChange={(event) => setName(event.target.value)}
								/>
							</label>
							<label className="admin-field">
								<span>{t`What is it used for?`}</span>
								<input
									value={description}
									onChange={(event) => setDescription(event.target.value)}
								/>
							</label>
						</div>
						{editor !== "new" &&
							objectOf(editor["source"])["_tag"] === "Builtin" && (
								<label className="admin-vault-checkbox">
									<input
										type="checkbox"
										checked={replace}
										onChange={(event) => setReplace(event.target.checked)}
									/>
									{t`Replace the saved values`}
								</label>
							)}
						{(editor === "new" || replace) && (
							<fieldset className="admin-secret-fields">
								<legend>{t`Secret fields`}</legend>
								<p>{t`When replacing values, enter every field you want to keep. Previous values cannot be displayed.`}</p>
								{values.map((entry, index) => (
									<div key={index}>
										<label>
											<span>{t`Field name`}</span>
											<input
												required
												value={entry.name}
												onChange={(event) =>
													setValues((old) =>
														old.map((row, i) =>
															i === index
																? { ...row, name: event.target.value }
																: row,
														),
													)
												}
											/>
										</label>
										<label>
											<span>{t`Secret value`}</span>
											<input
												type="password"
												autoComplete="new-password"
												required
												value={entry.secret}
												onChange={(event) =>
													setValues((old) =>
														old.map((row, i) =>
															i === index
																? { ...row, secret: event.target.value }
																: row,
														),
													)
												}
											/>
										</label>
										<Button
											type="button"
											variant="ghost"
											disabled={workflow.busy}
											aria-label={t`Remove field`}
											onClick={() =>
												setValues((old) => old.filter((_, i) => i !== index))
											}
										>
											<Trash2 size={15} />
										</Button>
									</div>
								))}
								<Button
									type="button"
									variant="outline"
									onClick={() =>
										setValues((old) => [...old, { name: "", secret: "" }])
									}
								>{t`Add field`}</Button>
							</fieldset>
						)}
						<fieldset className="admin-secret-fields">
							<legend>{t`Apps allowed to receive these values`}</legend>
							<p>{t`Leave all Apps unchecked to keep the credential stored without allowing it to leave the vault.`}</p>
							{connections.map((connection) => {
								const connectionId = adminRecordKey(connection)
								const checked = exits.some(
									(exit) => objectOf(exit)["connection"] === connectionId,
								)
								return (
									<label className="admin-vault-checkbox" key={connectionId}>
										<input
											type="checkbox"
											checked={checked}
											onChange={(event) =>
												setExits((old) =>
													event.target.checked
														? [
																...old,
																{
																	_tag: "App",
																	connection: connectionId,
																	tool: null,
																},
															]
														: old.filter(
																(exit) =>
																	objectOf(exit)["connection"] !== connectionId,
															),
												)
											}
										/>
										{adminRecordName(connection, t`Connected App`)}
									</label>
								)
							})}
						</fieldset>
						{error !== null && (
							<p role="alert" className="admin-form-error">
								{error}
							</p>
						)}
						<div className="admin-actions">
							<Button
								type="submit"
								disabled={
									disabled ||
									!workflow.can(
										editor === "new"
											? "vaults.createVaultItem"
											: "vaults.updateVaultItem",
									)
								}
							>{t`Save credential`}</Button>
							<Button
								type="button"
								variant="ghost"
								onClick={() => {
									setEditor(null)
									setValues([])
								}}
							>{t`Cancel`}</Button>
						</div>
					</fieldset>
				</form>
			)}
			{remove !== null && (
				<div className="admin-remove-confirm" role="alert">
					<p>{t`Remove this credential? Work that uses it will lose access.`}</p>
					<Button
						variant="destructive"
						disabled={disabled}
						onClick={() =>
							void workflow
								.call("vaults.deleteVaultItem", {
									params: { vaultId, itemId: adminRecordKey(remove) },
								})
								.then(async () => {
									setRemove(null)
									await refresh()
								})
								.catch(() => {})
						}
					>{t`Remove credential`}</Button>
					<Button
						variant="ghost"
						onClick={() => setRemove(null)}
					>{t`Cancel`}</Button>
				</div>
			)}
		</section>
	)
}
