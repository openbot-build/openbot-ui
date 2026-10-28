import { useAtomValue } from "@effect/atom-react"
import type { Config } from "@openbot-build/client/Core"
import {
	BrainIcon,
	CheckIcon,
	ChevronDownIcon,
	SparklesIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { type CatalogModel, modelCatalogAtom, selectionOf } from "@/atoms/chats"
import { cn, resultValue } from "@/lib/utils"

const sameModel = (
	model: CatalogModel,
	selection: Config.Selection | undefined,
) =>
	selection !== undefined &&
	model.provider === selection.provider &&
	model.id === selection.model

/**
 * Picks the model of a chat, and how hard it thinks. Without a choice, the
 * Bot uses its default model. A live chat picks from the Live models.
 */
export function ModelPicker({
	value,
	onChange,
	disabled = false,
	type = "language",
}: {
	readonly value: Config.Selection | undefined
	readonly onChange: (selection: Config.Selection) => void
	readonly disabled?: boolean
	readonly type?: "language" | "live"
}) {
	const models = resultValue(useAtomValue(modelCatalogAtom(type)))
	if (models === undefined || models.length === 0) return null
	const current = models.find((model) => sameModel(model, value))
	const efforts = current?.reasoningEfforts ?? []
	const providers = [...new Set(models.map((model) => model.providerName))]

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				disabled={disabled}
				render={
					<Button
						variant="ghost"
						size="lg"
						className="h-9 max-w-56 rounded-full px-3 text-sm text-muted-foreground"
					/>
				}
			>
				<SparklesIcon className="size-4 shrink-0" />
				<span className="truncate">{current?.name ?? "Default"}</span>
				{value?.reasoningEffort ? (
					<span className="text-xs text-muted-foreground capitalize">
						· {value.reasoningEffort}
					</span>
				) : null}
				<ChevronDownIcon className="size-3.5 shrink-0" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-72">
				{providers.map((provider, index) => (
					<DropdownMenuGroup key={provider}>
						{index > 0 ? <DropdownMenuSeparator /> : null}
						<DropdownMenuLabel>{provider}</DropdownMenuLabel>
						{models
							.filter((model) => model.providerName === provider)
							.map((model) => (
								<DropdownMenuItem
									key={`${model.provider}/${model.id}`}
									onClick={() => onChange(selectionOf(model))}
									className="py-2"
								>
									<span className="flex min-w-0 flex-1 flex-col">
										<span className="truncate text-sm">{model.name}</span>
										{model.contextWindow ? (
											<span className="text-[0.7rem] text-muted-foreground">
												{Math.round(model.contextWindow / 1000)}k context
											</span>
										) : null}
									</span>
									<CheckIcon
										className={cn(
											"size-4",
											sameModel(model, value) ? "opacity-100" : "opacity-0",
										)}
									/>
								</DropdownMenuItem>
							))}
					</DropdownMenuGroup>
				))}
				{current !== undefined && efforts.length > 0 ? (
					<DropdownMenuGroup>
						<DropdownMenuSeparator />
						<DropdownMenuLabel className="flex items-center gap-1.5">
							<BrainIcon className="size-3.5" /> Thinking
						</DropdownMenuLabel>
						{efforts.map((effort) => (
							<DropdownMenuItem
								key={effort}
								onClick={() => onChange(selectionOf(current, effort))}
							>
								<span className="flex-1 capitalize">{effort}</span>
								<CheckIcon
									className={cn(
										"size-4",
										value?.reasoningEffort === effort
											? "opacity-100"
											: "opacity-0",
									)}
								/>
							</DropdownMenuItem>
						))}
					</DropdownMenuGroup>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
