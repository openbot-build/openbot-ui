import { useAtomValue } from "@effect/atom-react"
import type { ChatSummary } from "@openbot-build/client/Api"
import { EllipsisIcon, MessageSquareIcon, SearchIcon } from "lucide-react"
import { useState } from "react"
import { Link } from "react-router"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty"
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@/components/ui/input-group"
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@/components/ui/item"
import { Skeleton } from "@/components/ui/skeleton"
import { botsAtom } from "@/atoms/bots"
import { chatName, chatsAtom, lastActivity } from "@/atoms/chats"
import { ChatMenu } from "@/components/app/ChatMenu"
import { PageHeader } from "@/components/app/PageHeader"
import { errorMessage } from "@/lib/api"
import { resultValue } from "@/lib/utils"

const kindLabel: Record<ChatSummary["chat"]["kind"], string | undefined> = {
	direct: undefined,
	channel: "Channel",
	task: "Task",
	review: "Review",
	live: "Live",
}

/** All chats, with a search box. You have one chat with each Bot. */
export function HistoryPage() {
	const [query, setQuery] = useState("")
	return (
		<div className="flex h-full flex-col overflow-y-auto">
			<PageHeader title="History" />
			<div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
				<h1 className="text-2xl font-semibold tracking-tight">History</h1>
				<InputGroup className="h-10 rounded-full">
					<InputGroupAddon>
						<SearchIcon />
					</InputGroupAddon>
					<InputGroupInput
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Search your chats"
						className="text-sm"
					/>
				</InputGroup>
				<ChatList query={query} />
			</div>
		</div>
	)
}

function ChatList({ query }: { readonly query: string }) {
	const result = useAtomValue(chatsAtom)
	const chats = resultValue(result)
	const bots = resultValue(useAtomValue(botsAtom))?.bots ?? []
	if (chats === undefined)
		return result._tag === "Failure" ? (
			<p className="text-sm text-muted-foreground">
				{errorMessage(result.cause)}
			</p>
		) : (
			<div className="flex flex-col gap-2">
				{[0, 1, 2, 3].map((index) => (
					<Skeleton key={index} className="h-14 w-full rounded-2xl" />
				))}
			</div>
		)
	const needle = query.trim().toLowerCase()
	const shown = chats.filter((item) =>
		chatName(item.chat, bots).toLowerCase().includes(needle),
	)
	if (shown.length === 0)
		return (
			<Empty className="bg-muted/50">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<MessageSquareIcon />
					</EmptyMedia>
					<EmptyTitle>
						{needle ? "No chat matches" : "No chats here"}
					</EmptyTitle>
					<EmptyDescription>
						{needle
							? "Try other words."
							: "Send a message to a Bot, and your chat shows here."}
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		)
	return (
		<ItemGroup className="gap-1">
			{shown.map((item) => {
				const kind = kindLabel[item.chat.kind]
				const name = chatName(item.chat, bots)
				const time = lastActivity(item)
				return (
					<Item
						key={item.chat.id}
						className="hover:bg-muted/50"
						render={<Link to={`/c/${item.chat.id}`} />}
					>
						<ItemContent>
							<ItemTitle className="text-sm">
								{name}
								{kind ? <Badge variant="outline">{kind}</Badge> : null}
							</ItemTitle>
							<ItemDescription>
								{time > 0 ? new Date(time).toLocaleString() : "Not started"}
							</ItemDescription>
						</ItemContent>
						<ItemActions onClick={(event) => event.preventDefault()}>
							<ChatMenu
								id={item.chat.id}
								name={name}
								bot={item.chat.bot}
								align="end"
								trigger={
									<Button variant="ghost" size="icon" aria-label="Chat actions">
										<EllipsisIcon />
									</Button>
								}
							/>
						</ItemActions>
					</Item>
				)
			})}
		</ItemGroup>
	)
}
