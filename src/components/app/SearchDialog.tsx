import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react"
import {
	SlidersHorizontalIcon,
	HistoryIcon,
	MessageSquareIcon,
	SettingsIcon,
	ShieldCheckIcon,
	SquarePenIcon,
} from "lucide-react"
import { useNavigate } from "react-router"
import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
	CommandShortcut,
} from "@/components/ui/command"
import { botsAtom } from "@/atoms/bots"
import { chatName, chatsAtom, lastActivity } from "@/atoms/chats"
import { searchOpenAtom, settingsTabAtom } from "@/atoms/ui"
import { modKey, resultValue } from "@/lib/utils"

/** Finds a chat by its name, or goes to a page. */
export function SearchDialog() {
	const navigate = useNavigate()
	const [open, setOpen] = useAtom(searchOpenAtom)
	const setSettingsTab = useAtomSet(settingsTabAtom)
	const chats = resultValue(useAtomValue(chatsAtom)) ?? []
	const bots = resultValue(useAtomValue(botsAtom))?.bots ?? []
	const go = (to: string) => {
		setOpen(false)
		navigate(to)
	}
	return (
		<CommandDialog
			open={open}
			onOpenChange={setOpen}
			title="Search"
			description="Find a Bot, chat, or page"
		>
			<Command>
				<CommandInput placeholder="Search Bots, chats, and pages" />
				<CommandList>
					<CommandEmpty>Nothing found.</CommandEmpty>
					<CommandGroup heading="Actions">
						<CommandItem onSelect={() => go("/")}>
							<SquarePenIcon /> Message a Bot
							<CommandShortcut>{modKey()} ⇧ O</CommandShortcut>
						</CommandItem>
						<CommandItem onSelect={() => go("/bots")}>
							<SlidersHorizontalIcon /> Manage Bots
						</CommandItem>
						<CommandItem onSelect={() => go("/requests")}>
							<ShieldCheckIcon /> Requests
						</CommandItem>
						<CommandItem onSelect={() => go("/history")}>
							<HistoryIcon /> History
						</CommandItem>
						<CommandItem
							onSelect={() => {
								setOpen(false)
								setSettingsTab("general")
							}}
						>
							<SettingsIcon /> Settings
						</CommandItem>
					</CommandGroup>
                    <CommandGroup heading="Bots">
                      {bots.map(bot => <CommandItem key={bot.id} value={`bot ${bot.name} ${bot.id}`} onSelect={() => {
                        const direct = chats.find(item => item.chat.kind === "direct" && item.chat.bot === bot.id)
                        go(direct ? `/c/${direct.chat.id}` : `/?bot=${encodeURIComponent(bot.id)}`)
                      }}>{bot.name}</CommandItem>)}
                    </CommandGroup>
					{chats.length > 0 ? (
						<>
							<CommandSeparator />
							<CommandGroup heading="Chats">
								{chats.map((item) => (
									<CommandItem
										key={item.chat.id}
										value={`${chatName(item.chat, bots)} ${item.chat.id}`}
										onSelect={() => go(`/c/${item.chat.id}`)}
									>
										<MessageSquareIcon />
										<span className="truncate">
											{chatName(item.chat, bots)}
										</span>
										<CommandShortcut>
											{lastActivity(item) > 0
												? new Date(lastActivity(item)).toLocaleDateString()
												: ""}
										</CommandShortcut>
									</CommandItem>
								))}
							</CommandGroup>
						</>
					) : null}
				</CommandList>
			</Command>
		</CommandDialog>
	)
}
