import { MicIcon, MicOffIcon, PhoneOffIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip"
import type { TalkState } from "@/hooks/use-live-talk"
import { cn } from "@/lib/utils"

/** A short word for what happens in the talk now. */
const talkLabel = (state: TalkState) => {
	if (state.status === "connecting") return "Connecting"
	if (state.muted) return "Muted"
	if (state.speaking) return "Speaking"
	if (state.hearing) return "Hearing you"
	if (state.working) return "Thinking"
	return "Listening"
}

/**
 * The controls of a Live talk, in the lower row of the composer: start the
 * talk, or mute the microphone and end the talk. All are pills, so they sit
 * concentric in the corner of the composer.
 */
export function LiveControls({
	state,
	onStart,
	onEnd,
	onMute,
	disabled = false,
}: {
	readonly state: TalkState
	readonly onStart: () => void
	readonly onEnd: () => void
	readonly onMute: (muted: boolean) => void
	readonly disabled?: boolean
}) {
	if (state.status === "idle")
		return (
			<Button
				variant="secondary"
				size="lg"
				disabled={disabled}
				onClick={onStart}
				className="h-9 rounded-full px-4 text-sm"
			>
				<MicIcon /> Start talking
			</Button>
		)
	const open = state.status === "open"
	return (
		<>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant={state.muted ? "destructive" : "secondary"}
							size="icon-lg"
							disabled={!open}
							aria-pressed={state.muted}
							aria-label={state.muted ? "Turn on the microphone" : "Mute"}
							onClick={() => onMute(!state.muted)}
							className="size-9 rounded-full"
						/>
					}
				>
					{state.muted ? <MicOffIcon /> : <MicIcon />}
				</TooltipTrigger>
				<TooltipContent>
					{state.muted ? "Turn on the microphone" : "Mute"}
				</TooltipContent>
			</Tooltip>
			<Button
				variant="destructive"
				size="lg"
				onClick={onEnd}
				className="h-9 rounded-full px-4 text-sm"
			>
				<PhoneOffIcon /> End
			</Button>
			<span
				role="status"
				className="ml-2 flex items-center gap-2 text-sm text-muted-foreground"
			>
				{open ? (
					<span
						aria-hidden="true"
						className={cn(
							"size-2 rounded-full",
							state.muted
								? "bg-destructive"
								: state.speaking || state.hearing
									? "animate-pulse bg-sky-500"
									: "bg-emerald-500",
						)}
					/>
				) : (
					<Spinner className="size-3.5" />
				)}
				{talkLabel(state)}
			</span>
		</>
	)
}
