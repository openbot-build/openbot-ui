import { useAtomSet, useAtomValue } from "@effect/atom-react"
import {
	ArchiveIcon,
	EllipsisIcon,
	MessageSquarePlusIcon,
	PencilIcon,
	PlusIcon,
	StarIcon,
} from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
	Empty,
	EmptyContent,
	EmptyHeader,
	EmptyTitle,
} from "@/components/ui/empty"
import {
	Field,
	FieldGroup,
	FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@/components/ui/item"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
	type Bot,
	botsAtom,
	createBotAtom,
	setDefaultBotAtom,
	updateBotAtom,
} from "@/atoms/bots"
import { PageHeader } from "@/components/app/PageHeader"
import { errorMessage } from "@/lib/api"
import { resultValue } from "@/lib/utils"

/** The Bots of the person. Each Bot has its own job, memory and model. */
export function BotsPage() {
	const navigate = useNavigate()
	const result = useAtomValue(botsAtom)
	const loaded = resultValue(result)
	const bots = loaded?.bots
	const isDefault = (bot: Bot) => bot.id === loaded?.defaultBot
	const update = useAtomSet(updateBotAtom, { mode: "promise" })
	const setDefault = useAtomSet(setDefaultBotAtom, { mode: "promise" })
	// The start page links here with `?new=1` to make the first Bot.
	const [params, setParams] = useSearchParams()
	const [editing, setEditing] = useState<Bot | "new" | undefined>(
		params.get("new") === "1" ? "new" : undefined,
	)
	useEffect(() => {
		if (params.get("new") === "1") setEditing("new")
	}, [params])
	const closeDialog = () => {
		setEditing(undefined)
		if (params.has("new")) {
			const next = new URLSearchParams(params)
			next.delete("new")
			setParams(next, { replace: true })
		}
	}
	const fail = (cause: unknown) => toast.error(errorMessage(cause))

	return (
		<div className="flex h-full flex-col overflow-y-auto">
			<PageHeader
				title="Bots"
				actions={
					<Button onClick={() => setEditing("new")}>
						<PlusIcon /> New Bot
					</Button>
				}
			/>
			<div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-8 sm:px-10">
				<div className="flex flex-col gap-1">
					<h1 className="text-display-small">Bots</h1>
				</div>
				{bots === undefined ? (
					result._tag === "Failure" ? (
						<p className="text-body-medium text-muted-foreground">
							{errorMessage(result.cause)}
						</p>
					) : (
						<div className="flex flex-col gap-2">
							{[0, 1, 2].map((index) => (
								<Skeleton key={index} className="h-16 w-full rounded-row" />
							))}
						</div>
					)
				) : bots.length === 0 ? (
					<Empty className="bg-muted/50">
						<EmptyHeader>
							<EmptyTitle>No Bots yet</EmptyTitle>
						</EmptyHeader>
						<EmptyContent>
							<Button onClick={() => setEditing("new")}>
								<PlusIcon /> New Bot
							</Button>
						</EmptyContent>
					</Empty>
				) : (
					<ItemGroup className="gap-2 bg-card p-(--group-inset)">
						{bots.map((bot) => (
							<Item key={bot.id} variant="outline" className="bg-muted/60">
								<ItemContent>
									<ItemTitle className="text-title-large">
										{bot.name}
										{isDefault(bot) ? (
											<Badge variant="secondary">Default</Badge>
										) : null}
										{bot.owner._tag === "Organization" ? (
											<Badge variant="outline">Shared</Badge>
										) : null}
									</ItemTitle>
									<ItemDescription>{bot.role || "Open to anything"}</ItemDescription>
								</ItemContent>
								<ItemActions>
									<Button
										variant="outline"
										onClick={() =>
											navigate(isDefault(bot) ? "/" : `/?bot=${bot.id}`)
										}
									>
										<MessageSquarePlusIcon /> Chat
									</Button>
									<DropdownMenu>
										<DropdownMenuTrigger
											render={
												<Button
													variant="ghost"
													size="icon"
													aria-label="Bot actions"
												/>
											}
										>
											<EllipsisIcon />
										</DropdownMenuTrigger>
										<DropdownMenuContent align="end">
											{/* A Bot from another organization changes only there. */}
											{bot.source ? null : (
												<DropdownMenuItem onClick={() => setEditing(bot)}>
													<PencilIcon /> Edit
												</DropdownMenuItem>
											)}
											{isDefault(bot) ? null : (
												<DropdownMenuItem
													onClick={() =>
														setDefault(bot).then(
															() => toast.success("Default Bot set"),
															fail,
														)
													}
												>
													<StarIcon /> Make default
												</DropdownMenuItem>
											)}
											{isDefault(bot) ? null : (
												<DropdownMenuItem
													onClick={() =>
														update({ bot, archived: true }).then(
															() => toast.success("Bot archived"),
															fail,
														)
													}
												>
													<ArchiveIcon /> Archive
												</DropdownMenuItem>
											)}
										</DropdownMenuContent>
									</DropdownMenu>
								</ItemActions>
							</Item>
						))}
					</ItemGroup>
				)}
			</div>
			<BotDialog
				key={
					editing === undefined
						? "closed"
						: editing === "new"
							? "new"
							: editing.id
				}
				bot={editing}
				onClose={closeDialog}
			/>
		</div>
	)
}

function BotDialog({
	bot,
	onClose,
}: {
	readonly bot: Bot | "new" | undefined
	readonly onClose: () => void
}) {
	const create = useAtomSet(createBotAtom, { mode: "promise" })
	const update = useAtomSet(updateBotAtom, { mode: "promise" })
	const existing = bot !== undefined && bot !== "new" ? bot : undefined
	const [name, setName] = useState(existing?.name ?? "")
	const [role, setRole] = useState(existing?.role ?? "")
	const [instructions, setInstructions] = useState(existing?.instructions ?? "")
	const [shared, setShared] = useState(false)
	const [busy, setBusy] = useState(false)

	const save = () => {
		setBusy(true)
		const work = existing
			? update({ bot: existing, name, role, instructions })
			: create({ name, role, instructions, shared })
		work
			.then(
				() => {
					toast.success(existing ? "Bot saved" : "Bot made")
					onClose()
				},
				(cause: unknown) => toast.error(errorMessage(cause)),
			)
			.finally(() => setBusy(false))
	}

	return (
		<Dialog
			open={bot !== undefined}
			onOpenChange={(open) => !open && onClose()}
		>
			<DialogContent>
				<form
					className="flex min-h-0 flex-1 flex-col gap-4"
					onSubmit={(event) => {
						event.preventDefault()
						save()
					}}
				>
					<DialogHeader>
						<DialogTitle>
							{existing ? `Edit ${existing.name}` : "New Bot"}
						</DialogTitle>
						<DialogDescription className="sr-only">
							Give your Bot a name and tell it how you want it to help.
						</DialogDescription>
					</DialogHeader>
					<DialogBody>
						<FieldGroup>
							<Field>
								<FieldLabel htmlFor="bot-name">Name</FieldLabel>
								<Input
									id="bot-name"
									value={name}
									required
									maxLength={100}
									onChange={(event) => setName(event.target.value)}
									placeholder="Travel, learning, everyday…"
								/>
							</Field>
							<Field>
								<FieldLabel htmlFor="bot-role">Purpose</FieldLabel>
								<Input
									id="bot-role"
									value={role}
									maxLength={500}
									onChange={(event) => setRole(event.target.value)}
									placeholder="Helps me learn something new each day"
								/>
							</Field>
							<Field>
								<FieldLabel htmlFor="bot-instructions">Instructions</FieldLabel>
								<Textarea
									id="bot-instructions"
									value={instructions}
									maxLength={20000}
									rows={6}
									onChange={(event) => setInstructions(event.target.value)}
									placeholder="What should it know? How would you like it to respond?"
								/>
							</Field>
							{existing ? null : (
								<Field orientation="horizontal">
									<Switch
										id="bot-shared"
										checked={shared}
										onCheckedChange={setShared}
									/>
									<div className="flex flex-col gap-0.5">
										<FieldLabel htmlFor="bot-shared">
											Share with the organization
										</FieldLabel>
									</div>
								</Field>
							)}
						</FieldGroup>
					</DialogBody>
					<DialogFooter>
						<Button type="button" variant="ghost" onClick={onClose}>
							Cancel
						</Button>
						<Button type="submit" disabled={busy || name.trim().length === 0}>
							{existing ? "Save" : "Create"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
