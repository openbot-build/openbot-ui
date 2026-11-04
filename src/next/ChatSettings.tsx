import { useEffect, useRef, useState } from "react"
import { useLingui } from "@lingui/react"
import { t } from "@lingui/core/macro"
import { Schema } from "effect"
import type { Conversation } from "@kaicom/kay-contracts"
import { RequestFailed, type Client } from "@kaicom/kay-contracts/Client"
import { Button } from "../components/ui/button"
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "../components/ui/field"
import {
	NativeSelect,
	NativeSelectOption,
} from "../components/ui/native-select"
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group"

const Catalog = Schema.Struct({
	selected: Schema.optionalKey(Schema.JsonObject),
	providers: Schema.Array(
		Schema.Struct({ id: Schema.String, name: Schema.String }),
	),
	models: Schema.Array(
		Schema.Struct({
			provider: Schema.String,
			id: Schema.String,
			name: Schema.String,
		}),
	),
})
const Current = Schema.Struct({
	chat: Schema.Struct({
		revision: Schema.Natural,
		settings: Schema.Struct({
			mode: Schema.optionalKey(Schema.Literals(["build", "plan"])),
			model: Schema.optionalKey(Schema.JsonObject),
		}),
	}),
})
type Snapshot = {
	catalog: typeof Catalog.Type
	revision: number
	selected: Schema.JsonObject | undefined
}
const modelKey = (provider: string, model: string) =>
	JSON.stringify([provider, model])

/** Model changes affect later messages. Every save uses the revision that was read. */
export function ChatSettings({
	client,
	chat,
	onChanged,
	disabled,
}: {
	readonly client: Client
	readonly chat: Conversation
	readonly onChanged: () => Promise<unknown>
	readonly disabled: boolean
}) {
	useLingui()
	const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
	const [selection, setSelection] = useState("")
	const [mode, setMode] = useState<"build" | "plan">("build")
	const [error, setError] = useState<string | null>(null)
	const [saving, setSaving] = useState(false)
	const [refresh, setRefresh] = useState(0)
	const [mustRead, setMustRead] = useState(false)
	const [saved, setSaved] = useState(false)
	const [canWrite, setCanWrite] = useState(false)
	const busy = useRef(false)
	const mounted = useRef(false)
	useEffect(() => {
		mounted.current = true
		const controller = new AbortController()
		setSnapshot(null)
		setError(null)
		void Promise.all([
			client.featureCall(
				"chats.chatModels",
				{ params: { chatId: chat.id } },
				controller.signal,
			),
			client.featureCall(
				"chats.getChat",
				{ params: { chatId: chat.id } },
				controller.signal,
			),
			client.featureCatalog(),
		])
			.then(([models, current, operations]) => {
				if (controller.signal.aborted) return
				const catalog = Schema.decodeUnknownSync(Catalog)(models)
				const value = Schema.decodeUnknownSync(Current)(current)
				const selected = value.chat.settings.model
				setSnapshot({ catalog, revision: value.chat.revision, selected })
				setSelection(
					selected !== undefined &&
						typeof selected["provider"] === "string" &&
						typeof selected["model"] === "string"
						? modelKey(selected["provider"], selected["model"])
						: "",
				)
				setMode(value.chat.settings.mode ?? "build")
				setCanWrite(operations.some((entry) => entry.id === "chats.updateChat"))
				setMustRead(false)
			})
			.catch((failure: unknown) => {
				if (!controller.signal.aborted)
					setError(
						failure instanceof Error
							? failure.message
							: t`Could not read model settings.`,
					)
			})
		return () => {
			mounted.current = false
			controller.abort()
		}
	}, [client, chat.id, chat.revision, refresh])
	const save = async () => {
		if (snapshot === null || busy.current || mustRead || disabled || !canWrite)
			return
		const model = snapshot.catalog.models.find(
			(entry) => modelKey(entry.provider, entry.id) === selection,
		)
		if (selection !== "" && model === undefined) return
		busy.current = true
		setSaving(true)
		setSaved(false)
		setError(null)
		try {
			const previous = snapshot.selected
			const choice =
				model === undefined
					? null
					: previous !== undefined &&
						  previous["provider"] === model.provider &&
						  previous["model"] === model.id
						? previous
						: {
								_tag: "Config.Selection",
								provider: model.provider,
								model: model.id,
							}
			await client.featureCall("chats.updateChat", {
				params: { chatId: chat.id },
				payload: { expected: snapshot.revision, model: choice, mode },
			})
			await onChanged()
			if (mounted.current) {
				setSaved(true)
				setRefresh((value) => value + 1)
			}
		} catch (failure) {
			if (mounted.current) {
				setError(
					failure instanceof Error
						? failure.message
						: t`Kay could not finish this request.`,
				)
				setMustRead(
					failure instanceof RequestFailed &&
						failure.problem.code === "outcome_unknown",
				)
			}
		} finally {
			busy.current = false
			if (mounted.current) setSaving(false)
		}
	}
	return (
		<section className="next-management">
			<h3>{t`Model and mode`}</h3>
			{error === null ? null : <p role="alert">{error}</p>}
			{snapshot === null ? (
				<Button
					variant="ghost"
					onClick={() => setRefresh((value) => value + 1)}
				>{t`Refresh`}</Button>
			) : (
				<FieldGroup>
					<Field data-disabled={disabled || saving || !canWrite || undefined}>
						<FieldLabel htmlFor={`model-${chat.id}`}>{t`Model`}</FieldLabel>
						<NativeSelect
							id={`model-${chat.id}`}
							value={selection}
							disabled={disabled || saving || !canWrite}
							onChange={(event) => {
								setSelection(event.target.value)
								setSaved(false)
							}}
						>
							<NativeSelectOption value="">{t`Follow Bot default`}</NativeSelectOption>
							{snapshot.catalog.providers.map((provider) => (
								<optgroup key={provider.id} label={provider.name}>
									{snapshot.catalog.models
										.filter((model) => model.provider === provider.id)
										.map((model) => (
											<NativeSelectOption
												key={model.id}
												value={modelKey(model.provider, model.id)}
											>
												{model.name}
											</NativeSelectOption>
										))}
								</optgroup>
							))}
						</NativeSelect>
						<FieldDescription>{t`These settings apply to future messages in this conversation.`}</FieldDescription>
					</Field>
					<Field>
						<FieldLabel>{t`Mode`}</FieldLabel>
						<ToggleGroup
							aria-label={t`Mode`}
							value={[mode]}
							disabled={disabled || saving || !canWrite}
							onValueChange={(values) => {
								const value = values[0]
								if (value === "build" || value === "plan") {
									setMode(value)
									setSaved(false)
								}
							}}
						>
							<ToggleGroupItem value="build">{t`Build`}</ToggleGroupItem>
							<ToggleGroupItem value="plan">
								{t({ message: "Plan", context: "conversation mode" })}
							</ToggleGroupItem>
						</ToggleGroup>
					</Field>
					<Field orientation="horizontal">
						<Button
							disabled={disabled || saving || mustRead || !canWrite}
							onClick={() => {
								void save()
							}}
						>{t`Save settings`}</Button>
						{mustRead || error !== null ? (
							<Button
								variant="ghost"
								disabled={saving}
								onClick={() => setRefresh((value) => value + 1)}
							>{t`Refresh`}</Button>
						) : null}
					</Field>
				</FieldGroup>
			)}
			{saved ? <p role="status">{t`Settings saved.`}</p> : null}
		</section>
	)
}
