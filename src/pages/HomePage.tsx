import { useAtomSet, useAtomValue } from "@effect/atom-react"
import {
	BotIcon,
	CalendarClockIcon,
	ChevronDownIcon,
	CodeIcon,
	FileSearchIcon,
	LightbulbIcon,
	MicIcon,
	PlusIcon,
} from "lucide-react"
import { useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@/components/ui/empty"
import { accountAtom } from "@/atoms/account"
import { type Bot, botsAtom } from "@/atoms/bots"
import {
	type Attachment,
	createLiveChatAtom,
	messageBotAtom,
	sendMessageAtom,
} from "@/atoms/chat"
import { chatsAtom, modelCatalogAtom } from "@/atoms/chats"
import { Composer } from "@/components/app/Composer"
import { LogoMark } from "@/components/app/Logo"
import { PageHeader } from "@/components/app/PageHeader"
import { errorMessage } from "@/lib/api"
import { resultValue } from "@/lib/utils"

const ideas = [
	{ icon: FileSearchIcon, label: "Research", text: "Find and compare " },
	{ icon: CodeIcon, label: "Write code", text: "Write a script that " },
	{
		icon: CalendarClockIcon,
		label: "Plan my week",
		text: "Help me plan my week. ",
	},
	{ icon: LightbulbIcon, label: "Brainstorm", text: "Give me ten ideas for " },
] as const

const greeting = (hour: number) =>
	hour < 5
		? "Good night"
		: hour < 12
			? "Good morning"
			: hour < 18
				? "Good afternoon"
				: "Good evening"

/** The start page: a big composer that starts a new chat. */
export function HomePage() {
	const navigate = useNavigate()
	const [params, setParams] = useSearchParams()
	const account = resultValue(useAtomValue(accountAtom))
	const loaded = resultValue(useAtomValue(botsAtom))
	const bots = loaded?.bots ?? []
	const chats = resultValue(useAtomValue(chatsAtom)) ?? []
	const messageBot = useAtomSet(messageBotAtom, { mode: "promise" })
	const createLiveChat = useAtomSet(createLiveChatAtom, { mode: "promise" })
	const send = useAtomSet(sendMessageAtom)
	const liveModels = resultValue(useAtomValue(modelCatalogAtom("live"))) ?? []
	const [busy, setBusy] = useState(false)
	const [seed, setSeed] = useState<{
		readonly text: string
		readonly key: number
	}>()

	const botId = params.get("bot") ?? loaded?.defaultBot ?? bots[0]?.id
	const bot = bots.find((item) => item.id === botId)
	const firstName = account?.profile.name?.split(" ")[0]

	// You have one direct Chat with each Bot. A message goes on in that Chat.
	const start = (text: string, files: ReadonlyArray<Attachment>) => {
		if (bot === undefined) {
			toast.error("Make a Bot first.")
			return
		}
		const existing = chats.find(
			(item) => item.chat.kind === "direct" && item.chat.bot === bot.id,
		)
		if (existing !== undefined) {
			// The answer streams in the background. The chat page shows it.
			send({ id: existing.chat.id, text, files })
			navigate(`/c/${existing.chat.id}`)
			return
		}
		setBusy(true)
		messageBot({ bot: bot.id, text, files })
			.then((chat) => navigate(`/c/${chat}`))
			.catch((cause: unknown) => {
				toast.error(errorMessage(cause))
				setBusy(false)
			})
	}

	// Each talk with sound is a new live Chat. Its page starts the talk.
	const talk = () => {
		if (bot === undefined) return
		setBusy(true)
		createLiveChat(bot.id)
			.then((chat) => navigate(`/c/${chat}?talk=1`))
			.catch((cause: unknown) => {
				toast.error(errorMessage(cause))
				setBusy(false)
			})
	}

	return (
		<div className="flex h-full flex-col">
			<PageHeader />
			<div className="flex flex-1 flex-col items-center justify-center px-4 pb-[12vh]">
				<div className="flex w-full max-w-3xl flex-col items-center gap-8">
					<div className="flex flex-col items-center gap-4 text-center">
						<LogoMark className="size-12" />
						<h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
							{greeting(new Date().getHours())}
							{firstName ? `, ${firstName}` : ""}
						</h1>
					</div>
					{loaded !== undefined && bots.length === 0 ? (
						// OpenBot makes no Bot for a new member. Show how to start.
						<Empty className="bg-muted/50">
							<EmptyHeader>
								<EmptyTitle>Make your first Bot</EmptyTitle>
								<EmptyDescription>
									A Bot does work for you. Give it a name and a job, and then
									send it a message here.
								</EmptyDescription>
							</EmptyHeader>
							<EmptyContent>
								<Button nativeButton={false} render={<Link to="/bots?new=1" />}>
									<PlusIcon /> New Bot
								</Button>
							</EmptyContent>
						</Empty>
					) : (
						<>
							<Composer
								key={seed?.key}
								autoFocus
								attachments
								disabled={busy}
								onSend={start}
								initialText={seed?.text}
								placeholder={
									bot ? `Ask ${bot.name}` : "What do you want to get done?"
								}
								tools={
									<>
										<BotPicker
											bots={bots}
											defaultBot={loaded?.defaultBot ?? null}
											current={bot}
											onChange={(id) => {
												const next = new URLSearchParams(params)
												if (id === loaded?.defaultBot) next.delete("bot")
												else next.set("bot", id)
												setParams(next, { replace: true })
											}}
										/>
										{bot !== undefined && liveModels.length > 0 ? (
											<Tooltip>
												<TooltipTrigger
													render={
														<Button
															variant="ghost"
															size="lg"
															disabled={busy}
															onClick={talk}
															className="h-9 rounded-full px-3 text-sm text-muted-foreground"
														/>
													}
												>
													<MicIcon /> Talk
												</TooltipTrigger>
												<TooltipContent>
													Talk with {bot.name} with your voice
												</TooltipContent>
											</Tooltip>
										) : null}
									</>
								}
							/>
							<div className="flex flex-wrap justify-center gap-2">
								{ideas.map((idea) => (
									<Button
										key={idea.label}
										variant="outline"
										size="lg"
										className="h-9 rounded-full px-4 text-sm text-muted-foreground"
										onClick={() =>
											setSeed({ text: idea.text, key: Date.now() })
										}
									>
										<idea.icon /> {idea.label}
									</Button>
								))}
							</div>
						</>
					)}
				</div>
			</div>
		</div>
	)
}

function BotPicker({
	bots,
	defaultBot,
	current,
	onChange,
}: {
	readonly bots: ReadonlyArray<Bot>
	readonly defaultBot: string | null
	readonly current: Bot | undefined
	readonly onChange: (id: string) => void
}) {
	if (bots.length <= 1) return null
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						variant="ghost"
						size="lg"
						className="h-9 max-w-48 rounded-full px-3 text-sm text-muted-foreground"
					/>
				}
			>
				<BotIcon />
				<span className="truncate">{current?.name ?? "Bot"}</span>
				<ChevronDownIcon />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-64">
				<DropdownMenuLabel>Who works on it</DropdownMenuLabel>
				<DropdownMenuSeparator />
				{bots.map((bot) => (
					<DropdownMenuItem
						key={bot.id}
						onClick={() => onChange(bot.id)}
						className="py-2"
					>
						<span className="flex min-w-0 flex-col">
							<span className="truncate text-sm">
								{bot.id === defaultBot ? `${bot.name} (Default)` : bot.name}
							</span>
							{bot.role ? (
								<span className="truncate text-xs text-muted-foreground">
									{bot.role}
								</span>
							) : null}
						</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
