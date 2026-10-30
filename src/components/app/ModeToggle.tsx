import type { Config } from "@openbot-build/client/Core"
import { ListChecksIcon } from "lucide-react"
import { Toggle } from "@/components/ui/toggle"
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip"

/** Turns plan mode on and off. In plan mode the Bot writes a plan first. */
export function ModeToggle({
	mode,
	onChange,
	disabled = false,
}: {
	readonly mode: Config.Mode
	readonly onChange: (mode: Config.Mode) => void
	readonly disabled?: boolean
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Toggle
						variant="outline"
						size="lg"
						pressed={mode === "plan"}
						disabled={disabled}
						onPressedChange={(pressed) => onChange(pressed ? "plan" : "build")}
						className="h-9 rounded-full px-3.5 text-body-medium aria-pressed:bg-sky-500/15 aria-pressed:text-sky-600 dark:aria-pressed:text-sky-300"
					/>
				}
			>
				<ListChecksIcon />
				Plan
			</TooltipTrigger>
			<TooltipContent>
				The Bot writes a plan and waits for your OK before it works
			</TooltipContent>
		</Tooltip>
	)
}
