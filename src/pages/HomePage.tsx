import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import { MicIcon, PlusIcon } from "lucide-react"
import { useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { botsAtom } from "@/atoms/bots"
import { type Attachment, createLiveChatAtom, messageBotAtom, sendMessageAtom } from "@/atoms/chat"
import { chatsAtom, modelCatalogAtom } from "@/atoms/chats"
import { Composer } from "@/components/app/Composer"
import { PageHeader } from "@/components/app/PageHeader"
import { errorMessage } from "@/lib/api"
import { resultValue } from "@/lib/utils"

/** The start page: a big composer that starts a new chat. */
export function HomePage() {
	const navigate = useNavigate()
	const [params] = useSearchParams()
	const botsResult = useAtomValue(botsAtom)
	const loaded = resultValue(botsResult)
	const refreshBots = useAtomRefresh(botsAtom)
	const bots = loaded?.bots ?? []
	const chats = resultValue(useAtomValue(chatsAtom)) ?? []
	const messageBot = useAtomSet(messageBotAtom, { mode: "promise" })
	const createLiveChat = useAtomSet(createLiveChatAtom, { mode: "promise" })
	const send = useAtomSet(sendMessageAtom)
	const liveModels = resultValue(useAtomValue(modelCatalogAtom("live"))) ?? []
	const [busy, setBusy] = useState(false)

	const botId = params.get("bot") ?? loaded?.defaultBot ?? bots[0]?.id
	const bot = bots.find((item) => item.id === botId) ?? bots.find(item => item.id === loaded?.defaultBot) ?? bots[0]

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
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={bot?.name ?? "OpenBot"} />
      <div className="flex flex-1 flex-col overflow-y-auto px-5 pb-10 sm:px-10">
        <div className="home-stage mx-auto my-auto flex w-full max-w-4xl flex-col py-10 sm:py-14">
          <div className="mb-9 sm:mb-12">
            <h1 className="max-w-2xl text-display-small sm:text-display-large">What’s on<br />your mind?</h1>
          </div>
          {botsResult._tag === "Failure" && !loaded ? <Empty className="bg-muted">
            <EmptyHeader><EmptyTitle>Your Bots could not load</EmptyTitle><EmptyDescription>{errorMessage(botsResult.cause)}</EmptyDescription></EmptyHeader>
            <EmptyContent><Button onClick={refreshBots}>Try again</Button></EmptyContent>
          </Empty> : loaded !== undefined && bots.length === 0 ? <Empty className="items-start bg-muted p-8 sm:p-10">
            <EmptyHeader className="items-start text-left"><EmptyTitle>Your first Bot</EmptyTitle></EmptyHeader>
            <EmptyContent className="items-start"><Button nativeButton={false} render={<Link to="/bots?new=1" />}><PlusIcon /> Create a Bot</Button></EmptyContent>
          </Empty> : <>
            <Composer attachments autoFocus disabled={busy || !bot} onSend={start}
              className="home-composer" placeholder={bot ? `Message ${bot.name}…` : "Loading your Bots…"}
              tools={<>
                <span className="px-2 text-body-medium text-muted-foreground">{bot?.name ?? "Loading…"}</span>
                {bot && liveModels.length > 0 && <Button variant="ghost" size="sm" disabled={busy} onClick={talk} className="ml-auto h-9 gap-2 px-3"><MicIcon /> Talk</Button>}
              </>} />

          </>}
        </div>
      </div>
    </div>
  )
}
