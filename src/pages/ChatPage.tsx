import {
	useAtomMount,
	useAtomRefresh,
	useAtomSet,
	useAtomValue,
} from "@effect/atom-react"
import { EllipsisIcon, MessageSquareOffIcon } from "lucide-react"
import { useEffect, useMemo, useRef } from "react"
import { Link, useParams, useSearchParams } from "react-router"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty"
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { Spinner } from "@/components/ui/spinner"
import {
	type Attachment,
	chatAtom,
	chatWatcherAtom,
	isBusy,
	loadChatAtom,
	selectModeAtom,
	selectModelAtom,
	sendMessageAtom,
	stopTurnAtom,
	todosAtom,
} from "@/atoms/chat"
import { botsAtom } from "@/atoms/bots"
import { chatName, pendingRequestsAtom } from "@/atoms/chats"
import {
	AssistantMessage,
	StreamingMessage,
	UserMessage,
} from "@/components/app/ChatMessages"
import { ChatMenu } from "@/components/app/ChatMenu"
import { Composer } from "@/components/app/Composer"
import { ExecutionDecisions } from "@/components/app/ExecutionDecisions"
import { LiveControls } from "@/components/app/LiveControls"
import { ModeToggle } from "@/components/app/ModeToggle"
import { ModelPicker } from "@/components/app/ModelPicker"
import { PageHeader } from "@/components/app/PageHeader"
import { RequestCard } from "@/components/app/RequestCard"
import { TodoList } from "@/components/app/TodoList"
import { useLiveTalk } from "@/hooks/use-live-talk"
import { errorMessage, organizationAtom } from "@/lib/api"
import { buildRows, type FileRef, type Row } from "@/lib/conversation"
import { resultValue } from "@/lib/utils"

/** The files of a message, in the form that the message list shows. */
const fileRefs = (files: ReadonlyArray<Attachment>): ReadonlyArray<FileRef> =>
	files.map((file) => ({
		id: file.id,
		name: file.filename,
		mediaType: file.mediaType,
	}))

/** The uploaded files of a message, to send them again. */
const attachments = (
	files: ReadonlyArray<FileRef>,
): ReadonlyArray<Attachment> =>
	files.flatMap((file) =>
		file.id === undefined
			? []
			: [
					{
						id: file.id as Attachment["id"],
						filename: file.name,
						mediaType: file.mediaType,
					},
				],
	)

/**
 * One chat: its history, the answer that streams now, and the composer. A live
 * chat has a Live talk in the composer: the person talks, and the Bot answers
 * with sound.
 */
export function ChatPage() {
	const { chatId = "" } = useParams()
	return <Chat key={chatId} id={chatId} />
}

function Chat({ id }: { readonly id: string }) {
	const state = useAtomValue(chatAtom(id))
	const load = useAtomSet(loadChatAtom)
	const reload = useAtomSet(loadChatAtom, { mode: "promise" })
	const organization = useAtomValue(organizationAtom)
	const talk = useLiveTalk({
		chatId: id,
		organization,
		onTurnEnd: () => reload(id),
	})
	const [params, setParams] = useSearchParams()
	const autoStarted = useRef(false)
	const send = useAtomSet(sendMessageAtom)
	const stop = useAtomSet(stopTurnAtom, { mode: "promise" })
	const selectMode = useAtomSet(selectModeAtom, { mode: "promise" })
	const selectModel = useAtomSet(selectModelAtom, { mode: "promise" })
	const bots = resultValue(useAtomValue(botsAtom))?.bots ?? []
	const refreshRequests = useAtomRefresh(pendingRequestsAtom)
	const refreshTodos = useAtomRefresh(todosAtom(id))
	const requests = (
		resultValue(useAtomValue(pendingRequestsAtom)) ?? []
	).filter((request) => request.chat === id)
	useAtomMount(chatWatcherAtom(id))

	useEffect(() => {
		load(id)
		refreshRequests()
	}, [id, load, refreshRequests])

	// The todo list changes while the answer streams.
	const streamed = state.streaming?.text.length ?? 0
	useEffect(() => {
		if (streamed > 0) refreshTodos()
	}, [Math.floor(streamed / 400), refreshTodos])

	const view = state.view
	const isLive = view?.chat.kind === "live"

	// "Talk" on the start page opens a new live chat with `?talk=1`. The talk
	// starts at once, so the person does not click twice.
	useEffect(() => {
		if (!isLive || autoStarted.current || params.get("talk") === null) return
		autoStarted.current = true
		talk.start()
		const next = new URLSearchParams(params)
		next.delete("talk")
		setParams(next, { replace: true })
	}, [isLive, params, setParams, talk.start])

	const rows = useMemo(
		() => buildRows(state.history, state.turns, state.operations),
		[state.history, state.turns, state.operations],
	)
	const streaming = state.streaming
	const busy =
		isBusy(view) || (streaming !== undefined && streaming.status !== "failed")
	const lastUser = rows.findLast((row) => row.kind === "user")
	const showStreamingInput =
		streaming !== undefined &&
		!(
			lastUser?.kind === "user" &&
			lastUser.text === streaming.input &&
			streaming.status !== "starting"
		)
	const talking = talk.state.status !== "idle"
	const showTalk =
		talking &&
		(talk.state.heard.length > 0 ||
			talk.state.answer.length > 0 ||
			talk.state.working)

	const fail = (cause: unknown) => toast.error(errorMessage(cause))
	const onSend = (text: string, files: ReadonlyArray<Attachment>) =>
		send({ id, text, files })
	const retry = (text: string, files: ReadonlyArray<Attachment>) =>
		send({ id, text, files })

	if (state.loading && view === undefined)
		return (
			<div className="flex h-full flex-col">
				<PageHeader />
				<div className="flex flex-1 items-center justify-center">
					<Spinner className="size-6 text-muted-foreground" />
				</div>
			</div>
		)
	if (view === undefined)
		return (
			<div className="flex h-full flex-col">
				<PageHeader />
				<Empty className="flex-1">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<MessageSquareOffIcon />
						</EmptyMedia>
						<EmptyTitle>This chat did not load</EmptyTitle>
						<EmptyDescription>{state.error}</EmptyDescription>
					</EmptyHeader>
					<EmptyContent className="flex-row justify-center">
						<Button variant="outline" onClick={() => load(id)}>
							Try again
						</Button>
						<Button nativeButton={false} render={<Link to="/" />}>
							Go home
						</Button>
					</EmptyContent>
				</Empty>
			</div>
		)

	const name = chatName(view.chat, bots)
	// A Turn can fail before the Bot writes anything, such as when the model
	// does not take the input. No row has it then, so it gets its own row.
	const turn = view.turn
	const failedTurn =
		turn?.status._tag === "Failed" &&
		streaming === undefined &&
		!rows.some((row) => row.kind === "assistant" && row.turn?.id === turn.id)
			? turn
			: undefined
	const shownRows: ReadonlyArray<Row> =
		failedTurn === undefined
			? rows
			: [
					...rows,
					{
						kind: "assistant",
						id: `turn-${failedTurn.id}`,
						turn: failedTurn,
						segments: [],
					},
				]
	const lastAssistant = shownRows.findLast((row) => row.kind === "assistant")

	return (
		<div className="flex h-full min-h-0 flex-col">
			<PageHeader
				title={name}
				actions={
					<ChatMenu
						id={id}
						name={name}
						bot={view.chat.bot}
						align="end"
						trigger={
							<Button variant="ghost" size="icon" aria-label="Chat actions">
								<EllipsisIcon />
							</Button>
						}
					/>
				}
			/>
			<MessageScrollerProvider autoScroll defaultScrollPosition="end">
				<MessageScroller className="flex-1">
					<MessageScrollerViewport>
						<MessageScrollerContent className="mx-auto w-full max-w-4xl gap-10 px-5 pt-6 pb-10 sm:px-9">
							{rows.length === 0 && streaming === undefined && !showTalk ? (
								<p className="py-16 text-center text-body-medium text-muted-foreground">
									{isLive
										? "Start talking, and the Bot answers with sound."
										: "Send a message to start."}
								</p>
							) : null}
							{shownRows.map((row) => (
								<MessageScrollerItem
									key={row.id}
									messageId={row.id}
									scrollAnchor={row.kind === "user"}
									className="group/row"
								>
									{row.kind === "user" ? (
										<UserMessage text={row.text} files={row.files} />
									) : (
										<AssistantMessage
											row={row}
											chat={id}
											onRetry={
												row === lastAssistant &&
												row.turn?.status._tag === "Failed" &&
												lastUser?.kind === "user" &&
												!busy &&
												!isLive
													? () =>
															retry(lastUser.text, attachments(lastUser.files))
													: undefined
											}
										/>
									)}
								</MessageScrollerItem>
							))}
							{streaming !== undefined ? (
								<>
									{showStreamingInput ? (
										<MessageScrollerItem
											messageId="streaming-input"
											scrollAnchor
										>
											<UserMessage
												text={streaming.input}
												files={fileRefs(streaming.files)}
												pending={streaming.status === "starting"}
											/>
										</MessageScrollerItem>
									) : null}
									<MessageScrollerItem messageId="streaming-answer">
										<StreamingMessage
											text={streaming.text}
											error={streaming.error}
										/>
										{streaming.status === "failed" ? (
											<div className="mt-2">
												<Button
													variant="outline"
													onClick={() =>
														retry(streaming.input, streaming.files)
													}
												>
													Try again
												</Button>
											</div>
										) : null}
									</MessageScrollerItem>
								</>
							) : null}
							{showTalk ? (
								<>
									{talk.state.heard.length > 0 ? (
										<MessageScrollerItem messageId="talk-heard" scrollAnchor>
											<UserMessage text={talk.state.heard} pending />
										</MessageScrollerItem>
									) : null}
									{talk.state.answer.length > 0 || talk.state.working ? (
										<MessageScrollerItem messageId="talk-answer">
											<StreamingMessage
												text={talk.state.answer}
												error={undefined}
											/>
										</MessageScrollerItem>
									) : null}
								</>
							) : null}
						</MessageScrollerContent>
					</MessageScrollerViewport>
					<MessageScrollerButton />
				</MessageScroller>
			</MessageScrollerProvider>
			<div className="mx-auto flex w-full max-w-4xl shrink-0 flex-col gap-3 px-4 pb-5 sm:px-8">
				<ExecutionDecisions operations={state.operations} />
				{requests.map((request) => (
					<RequestCard key={request.id} request={request} />
				))}
				<TodoList id={id} />
				{isLive ? (
					<>
						{talk.state.error !== undefined ? (
							<p
								role="alert"
								className="px-4 text-center text-body-medium text-destructive"
							>
								{talk.state.error}
							</p>
						) : null}
						<Composer
							busy={talk.state.working}
							disabled={talk.state.status !== "open" || !talk.state.canType}
							onSend={(text) => talk.sendText(text)}
							onStop={talk.cancel}
							placeholder={
								talk.state.status === "open"
									? talk.state.canType
										? "Talk, or type a message"
										: "Talk to the Bot"
									: "Start talking to send a message"
							}
							tools={
								<>
									<LiveControls
										state={talk.state}
										disabled={busy}
										onStart={talk.start}
										onEnd={talk.stop}
										onMute={talk.setMuted}
									/>
									<span className="ml-auto" />
									<ModelPicker
										type="live"
										value={view.chat.settings.model}
										disabled={talking || busy}
										onChange={(selection) =>
											void selectModel({ id, selection }).catch(fail)
										}
									/>
								</>
							}
						/>
					</>
				) : (
					<Composer
						autoFocus
						attachments
						busy={busy}
						onSend={onSend}
						onStop={() => void stop(id).catch(fail)}
						placeholder="Keep the conversation going…"
						tools={
							<>
								<ModeToggle
									mode={view.chat.settings.mode}
									disabled={busy}
									onChange={(mode) => void selectMode({ id, mode }).catch(fail)}
								/>
								<span className="ml-auto" />
								<ModelPicker
									value={view.chat.settings.model}
									disabled={busy}
									onChange={(selection) =>
										void selectModel({ id, selection }).catch(fail)
									}
								/>
							</>
						}
					/>
				)}
			</div>
		</div>
	)
}
