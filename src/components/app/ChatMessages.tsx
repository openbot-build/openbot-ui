import { useAtomSet } from "@effect/atom-react"
import { ExecutionsApi } from "@openbot-build/client/Api"
import {
	BrainIcon,
	CheckIcon,
	CircleAlertIcon,
	CopyIcon,
	HourglassIcon,
	RotateCcwIcon,
	SquareIcon,
	WrenchIcon,
} from "lucide-react"
import { toast } from "sonner"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import {
	CodeBlock,
	CodeBlockContent,
	CodeBlockHeader,
	CodeBlockTitle,
} from "@/components/ui/code-block"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import { Message, MessageContent, MessageFooter } from "@/components/ui/message"
import { Spinner } from "@/components/ui/spinner"
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip"
import {
	Trace,
	TraceCollapsible,
	TraceCollapsibleContent,
	TraceCollapsibleTrigger,
	TraceDescription,
	TraceIcon,
	TraceLine,
	TraceTitle,
} from "@/components/ui/trace"
import { cancelOperationAtom } from "@/atoms/chat"
import { FilePreview } from "@/components/app/FilePreview"
import { Markdown } from "@/components/app/Markdown"
import { useCopy } from "@/hooks/use-copy"
import { errorMessage } from "@/lib/api"
import {
	answerText,
	errorSummary,
	type FileRef,
	type Row,
	type Segment,
	showValue,
	type ToolStep,
	toolLabel,
	turnDuration,
} from "@/lib/conversation"

const { Execution } = ExecutionsApi

/**
 * A message of the person, in a bubble on the right. Its files come first,
 * and images show as pictures.
 */
export function UserMessage({
	text,
	files = [],
	pending = false,
}: {
	readonly text: string
	readonly files?: ReadonlyArray<FileRef>
	readonly pending?: boolean
}) {
	return (
		<Message align="end" className={pending ? "opacity-70" : undefined}>
			<MessageContent>
				{files.length > 0 ? (
					<div className="flex max-w-[85%] flex-wrap items-end justify-end gap-2 self-end">
						{files.map((file, index) => (
							<FilePreview key={index} {...file} />
						))}
					</div>
				) : null}
				{text.length > 0 ? (
					<Bubble variant="secondary" align="end" className="max-w-[85%]">
						<BubbleContent className="rounded-2xl px-4 py-2.5 text-body-large whitespace-pre-wrap">
							{text}
						</BubbleContent>
					</Bubble>
				) : null}
			</MessageContent>
		</Message>
	)
}

function ReasoningTrace({
	text,
	live,
}: {
	readonly text: string
	readonly live: boolean
}) {
	return (
		<TraceCollapsible>
			<TraceCollapsibleTrigger>
				<TraceLine status={live ? "running" : undefined}>
					<TraceIcon>
						<BrainIcon />
					</TraceIcon>
					<TraceTitle>{live ? "Thinking" : "Thoughts"}</TraceTitle>
				</TraceLine>
			</TraceCollapsibleTrigger>
			<TraceCollapsibleContent>
				<Markdown
					text={text}
					className="text-body-medium text-muted-foreground"
				/>
			</TraceCollapsibleContent>
		</TraceCollapsible>
	)
}

/** Stops a tool call that runs in the background. */
function StopOperation({
	chat,
	operation,
}: {
	readonly chat: string
	readonly operation: NonNullable<ToolStep["operation"]>
}) {
	const cancel = useAtomSet(cancelOperationAtom, { mode: "promise" })
	return (
		<Button
			variant="outline"
			size="sm"
			className="w-fit"
			onClick={() =>
				void cancel({ chat, execution: operation.executionId }).catch(
					(cause: unknown) => toast.error(errorMessage(cause)),
				)
			}
		>
			<SquareIcon className="fill-current" /> Stop
		</Button>
	)
}

function ToolTrace({
	step,
	chat,
}: {
	readonly step: ToolStep
	readonly chat: string
}) {
	const unknown = step.operation?.status === "outcome_unknown"
	const status = step.result?.failed
		? "error"
		: step.waiting || unknown
			? "pending"
			: step.result === undefined
				? "running"
				: undefined
	const operation = step.operation
	const background =
		operation !== undefined &&
		("detached" in operation ? operation.detached : true) &&
		!Execution.isTerminal(operation.status)
	return (
		<TraceCollapsible>
			<TraceCollapsibleTrigger>
				<TraceLine status={status}>
					<TraceIcon>
						{step.result?.failed ? (
							<CircleAlertIcon />
						) : step.waiting || unknown ? (
							<HourglassIcon />
						) : step.result === undefined ? (
							<Spinner className="size-3.5" />
						) : (
							<WrenchIcon />
						)}
					</TraceIcon>
					<TraceTitle>{toolLabel(step.name)}</TraceTitle>
					{unknown ? (
						<TraceDescription>The result is unknown</TraceDescription>
					) : step.waiting ? (
						<TraceDescription>Waits for approval</TraceDescription>
					) : background ? (
						<TraceDescription>Runs in the background</TraceDescription>
					) : null}
				</TraceLine>
			</TraceCollapsibleTrigger>
			<TraceCollapsibleContent className="flex flex-col gap-2">
				{background && step.operation !== undefined ? (
					<StopOperation chat={chat} operation={step.operation} />
				) : null}
				<CodeBlock size="sm">
					<CodeBlockHeader>
						<CodeBlockTitle>Input</CodeBlockTitle>
					</CodeBlockHeader>
					<CodeBlockContent wrap className="max-h-64">
						{showValue(step.params)}
					</CodeBlockContent>
				</CodeBlock>
				{step.result !== undefined ? (
					<CodeBlock
						size="sm"
						variant={step.result.failed ? "destructive" : "default"}
					>
						<CodeBlockHeader>
							<CodeBlockTitle>
								{step.result.failed ? "Error" : "Result"}
							</CodeBlockTitle>
						</CodeBlockHeader>
						<CodeBlockContent wrap className="max-h-64">
							{showValue(step.result.value)}
						</CodeBlockContent>
					</CodeBlock>
				) : null}
			</TraceCollapsibleContent>
		</TraceCollapsible>
	)
}

/** The steps of an answer: thoughts and tool calls together, then the text. */
function Segments({
	segments,
	live,
	chat,
}: {
	readonly segments: ReadonlyArray<Segment>
	readonly live: boolean
	readonly chat: string
}) {
	// Steps that come one after another share one trace, like a list of work.
	const blocks = segments.reduce<Array<Array<Segment>>>((blocks, segment) => {
		const last = blocks.at(-1)
		const isStep = segment.kind === "tool" || segment.kind === "reasoning"
		const lastIsStep =
			last !== undefined &&
			(last[0]!.kind === "tool" || last[0]!.kind === "reasoning")
		if (last !== undefined && isStep && lastIsStep) last.push(segment)
		else blocks.push([segment])
		return blocks
	}, [])
	return blocks.map((block, index) => {
		const first = block[0]!
		const lastBlock = index === blocks.length - 1
		if (first.kind === "text") return <Markdown key={index} text={first.text} />
		if (first.kind === "file")
			return (
				<FilePreview
					key={index}
					id={first.id}
					name={first.name}
					mediaType={first.mediaType}
					className="w-fit"
				/>
			)
		return (
			<Trace key={index}>
				{block.map((segment, step) =>
					segment.kind === "tool" ? (
						<ToolTrace key={step} step={segment} chat={chat} />
					) : segment.kind === "reasoning" ? (
						<ReasoningTrace
							key={step}
							text={segment.text}
							live={live && lastBlock && step === block.length - 1}
						/>
					) : null,
				)}
			</Trace>
		)
	})
}

function ActionButton({
	label,
	onClick,
	children,
}: {
	readonly label: string
	readonly onClick: () => void
	readonly children: React.ReactNode
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={label}
						onClick={onClick}
						className="text-muted-foreground"
					/>
				}
			>
				{children}
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	)
}

/** An answer of the Bot: steps, text and a row of actions. */
export function AssistantMessage({
	row,
	chat,
	onRetry,
}: {
	readonly row: Extract<Row, { kind: "assistant" }>
	/** The chat of the answer. Its background work can be stopped here. */
	readonly chat: string
	readonly onRetry?: () => void
}) {
	const { copied, copy } = useCopy()
	const status = row.turn?.status
	const text = answerText(row.segments)
	const duration = turnDuration(row.turn)
	return (
		<Message>
			<MessageContent className="gap-3">
				<Segments
					segments={row.segments}
					live={status?._tag === "Running"}
					chat={chat}
				/>
				{status?._tag === "Failed" ? (
					<Marker className="text-destructive">
						<MarkerIcon>
							<CircleAlertIcon />
						</MarkerIcon>
						<MarkerContent>{errorSummary(status.message)}</MarkerContent>
					</Marker>
				) : null}
				{status?._tag === "Interrupted" ? (
					<Marker>
						<MarkerContent>You stopped this answer.</MarkerContent>
					</Marker>
				) : null}
			</MessageContent>
			{status?._tag === "Running" ? null : (
				<MessageFooter className="-ml-1.5 gap-0.5 px-0 opacity-0 transition-opacity group-hover/message:opacity-100 group-last/row:opacity-100 focus-within:opacity-100">
					{text.length > 0 ? (
						<ActionButton
							label={copied ? "Copied" : "Copy"}
							onClick={() => copy(text)}
						>
							{copied ? <CheckIcon /> : <CopyIcon />}
						</ActionButton>
					) : null}
					{onRetry ? (
						<ActionButton label="Try again" onClick={onRetry}>
							<RotateCcwIcon />
						</ActionButton>
					) : null}
					{duration ? (
						<span className="ml-1.5 text-body-small font-normal text-muted-foreground">
							Worked for {duration}
						</span>
					) : null}
				</MessageFooter>
			)}
		</Message>
	)
}

/** The answer that streams in now, before the history has it. */
export function StreamingMessage({
	text,
	error,
}: {
	readonly text: string
	readonly error: string | undefined
}) {
	return (
		<Message>
			<MessageContent className="gap-3">
				{text.length > 0 ? (
					<Markdown text={text} />
				) : error === undefined ? (
					<Trace>
						<TraceLine status="running">
							<TraceIcon>
								<Spinner className="size-3.5" />
							</TraceIcon>
							<TraceTitle>Working</TraceTitle>
						</TraceLine>
					</Trace>
				) : null}
				{error !== undefined ? (
					<Marker className="text-destructive">
						<MarkerIcon>
							<CircleAlertIcon />
						</MarkerIcon>
						<MarkerContent>{errorSummary(error)}</MarkerContent>
					</Marker>
				) : null}
			</MessageContent>
		</Message>
	)
}
