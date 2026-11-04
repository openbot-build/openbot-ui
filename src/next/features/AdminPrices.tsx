import { t } from "@lingui/core/macro"
import { useEffect, useRef, useState } from "react"
import { Button } from "../../components/ui/button"
import { adminRecordKey, adminRecordName, formatMoney } from "./AdminData"
import { rowsOf } from "./FeatureData"
import { objectOf, type JsonObject } from "./SchemaValues"
import type { useWorkspaceWorkflow } from "./Workflow"

const rateKeys = [
	"inputUncached",
	"inputCacheRead",
	"inputCacheWrite",
	"output",
	"outputReasoning",
] as const
type Rates = Readonly<Record<string, string>>
export function AdminPrices({
	provider,
	platform,
	workflow,
	models,
}: {
	readonly provider: JsonObject
	readonly platform: boolean
	readonly workflow: ReturnType<typeof useWorkspaceWorkflow>
	readonly models: ReadonlyArray<JsonObject>
}) {
	const providerId = adminRecordKey(provider)
	const read = platform
		? "platform.listPlatformModelPrices"
		: "modelProviders.listModelPrices"
	const write = platform
		? "platform.setPlatformModelPrice"
		: "modelProviders.setModelPrice"
	const [prices, setPrices] = useState<ReadonlyArray<JsonObject>>([])
	const [loadedProvider, setLoadedProvider] = useState<string | null>(null)
	const [snapshot, setSnapshot] = useState<JsonObject | null>(null)
	const [editing, setEditing] = useState<string | null>(null)
	const [tiers, setTiers] = useState<ReadonlyArray<Rates>>([])
	const [error, setError] = useState<string | null>(null)
	const scope = useRef(providerId)
	const readVersion = useRef(0)
	scope.current = providerId
	const labels = [
		t`Input`,
		t`Cached input`,
		t`Cache writes`,
		t`Output`,
		t`Reasoning output`,
	]
	const links = rowsOf(provider["models"]).map(objectOf)
	const refresh = async (signal?: AbortSignal) => {
		if (!workflow.can(read)) return
		const current = ++readVersion.current
		setLoadedProvider(null)
		try {
			const result = await workflow.read(
				read,
				{ params: { providerId } },
				signal,
			)
			if (
				signal?.aborted !== true &&
				scope.current === providerId &&
				current === readVersion.current
			) {
				setPrices(rowsOf(result).map(objectOf))
				setLoadedProvider(providerId)
			}
		} catch {
			/* Shared notice reports the read failure. */
		}
	}
	useEffect(() => {
		const controller = new AbortController()
		setEditing(null)
		setPrices([])
		setSnapshot(null)
		setLoadedProvider(null)
		void refresh(controller.signal)
		return () => {
			controller.abort()
			readVersion.current++
		}
	}, [providerId, platform])
	const edit = (model: string) => {
		if (loadedProvider !== providerId) return
		setEditing(model)
		setError(null)
		const price = prices.find((item) => item["model"] === model)
		setSnapshot(price ?? { model, timeZone: "UTC", periods: [] })
		const old = rowsOf(price?.["tiers"])
		setTiers(
			(old.length === 0
				? [
						{
							upToInputTokens: null,
							inputUncached: 0,
							inputCacheRead: 0,
							inputCacheWrite: 0,
							output: 0,
							outputReasoning: null,
						},
					]
				: old
			).map((tier) =>
				Object.fromEntries([
					["upToInputTokens", String(objectOf(tier)["upToInputTokens"] ?? "")],
					...rateKeys.map((key) => [
						key,
						objectOf(tier)[key] === null
							? ""
							: String(Number(objectOf(tier)[key] ?? 0) / 1_000_000),
					]),
				]),
			),
		)
	}
	const save = async () => {
		if (editing === null || snapshot === null || loadedProvider !== providerId)
			return
		const model = editing
		try {
			const original = snapshot
			const next = tiers.map((tier) =>
				Object.fromEntries([
					[
						"upToInputTokens",
						tier["upToInputTokens"] === ""
							? null
							: Number(tier["upToInputTokens"]),
					],
					...rateKeys.map((key) => {
						if (key === "outputReasoning" && tier[key] === "")
							return [key, null]
						const value = Number(tier[key])
						if (!Number.isFinite(value) || value < 0)
							throw new Error(
								t`Enter a price of zero or more for each token type.`,
							)
						return [key, Math.round(value * 1_000_000)]
					}),
				]),
			)
			await workflow.call(write, {
				params: { providerId },
				payload: {
					model,
					timeZone: original?.["timeZone"] ?? "UTC",
					tiers: next,
					periods: original?.["periods"] ?? [],
				},
			})
			if (scope.current !== providerId) return
			setEditing(null)
			await refresh()
		} catch (failure) {
			if (scope.current === providerId)
				setError(
					failure instanceof Error
						? failure.message
						: t`This request could not be completed.`,
				)
		}
	}
	if (!workflow.can(read)) return null
	return (
		<section className="admin-vault">
			<div className="admin-resource-heading">
				<h4>{t`Model pricing`}</h4>
				<Button
					variant="ghost"
					disabled={workflow.busy}
					onClick={() => void refresh()}
				>{t`Refresh`}</Button>
			</div>
			<p className="admin-section-hint">{t`Prices are in USD per million tokens. Changes apply to future calls; previous usage keeps its recorded cost.`}</p>
			{links.length === 0 ? (
				<p>{t`Connect models to this provider before setting prices.`}</p>
			) : (
				<div className="admin-price-list">
					{links.map((link) => {
						const model = String(link["model"])
						const price = prices.find((row) => row["model"] === model)
						const tier = objectOf(rowsOf(price?.["tiers"])[0])
						return (
							<div key={model}>
								<strong>
									{adminRecordName(
										models.find(
											(entry) =>
												entry["id"] === model &&
												entry["owner"] === link["modelOwner"],
										) ?? { name: model },
										model,
									)}
								</strong>
								<span>
									{t`Input`}:{" "}
									{loadedProvider === providerId
										? formatMoney(tier["inputUncached"] ?? 0)
										: "—"}{" "}
									· {t`Output`}:{" "}
									{loadedProvider === providerId
										? formatMoney(tier["output"] ?? 0)
										: "—"}
								</span>
								{workflow.can(write) && (
									<Button
										variant="outline"
										disabled={
											loadedProvider !== providerId ||
											workflow.busy ||
											workflow.unconfirmed !== null
										}
										onClick={() => edit(model)}
									>{t`Edit prices`}</Button>
								)}
							</div>
						)
					})}
				</div>
			)}
			{editing !== null && (
				<form
					className="admin-editor"
					onSubmit={(event) => {
						event.preventDefault()
						void save()
					}}
				>
					<h4>{t`Edit prices`}</h4>
					<p>{t`Existing context tiers and scheduled prices are preserved. These fields change the standard rates only.`}</p>
					{tiers.map((tier, index) => (
						<fieldset
							className="admin-secret-fields"
							key={index}
							disabled={workflow.busy}
						>
							<legend>
								{tier["upToInputTokens"] === ""
									? t`Remaining context lengths`
									: t`Up to ${tier["upToInputTokens"] ?? ""} input tokens`}
							</legend>
							<div className="admin-price-fields">
								{rateKeys.map((key, i) => (
									<label key={key}>
										<span>{labels[i]}</span>
										<input
											type="number"
											step="0.000001"
											min="0"
											required={key !== "outputReasoning"}
											value={tier[key] ?? ""}
											onChange={(event) =>
												setTiers((old) =>
													old.map((row, j) =>
														j === index
															? { ...row, [key]: event.target.value }
															: row,
													),
												)
											}
										/>
									</label>
								))}
							</div>
						</fieldset>
					))}
					<p>{t`Leave reasoning output empty to use the output price.`}</p>
					{error !== null && (
						<p role="alert" className="admin-form-error">
							{error}
						</p>
					)}
					<div className="admin-actions">
						<Button
							type="submit"
							disabled={
								loadedProvider !== providerId ||
								workflow.busy ||
								workflow.unconfirmed !== null
							}
						>{t`Save prices`}</Button>
						<Button
							type="button"
							variant="ghost"
							disabled={workflow.busy}
							onClick={() => setEditing(null)}
						>{t`Cancel`}</Button>
					</div>
				</form>
			)}
		</section>
	)
}
