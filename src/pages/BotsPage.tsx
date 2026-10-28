import { useAtomSet, useAtomValue } from "@effect/atom-react"
import {
	ArchiveIcon,
	BotIcon,
	EllipsisIcon,
	MessageSquarePlusIcon,
	PencilIcon,
	PlusIcon,
	StarIcon,
	UsersIcon,
} from "lucide-react"
import { useState } from "react"
import { useNavigate, useSearchParams } from "react-router"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
	Dialog,
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
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty"
import {
	Field,
	FieldDescription,
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
	ItemMedia,
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
	const [params] = useSearchParams()
	const [editing, setEditing] = useState<Bot | "new" | undefined>(
		params.get("new") === "1" ? "new" : undefined,
	)
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
			<div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
				<div className="flex flex-col gap-1">
					<h1 className="text-2xl font-semibold tracking-tight">Bots</h1>
					<p className="text-sm text-muted-foreground">
						Your default Bot works for you and gives work to the other Bots.
						Each Bot has its own job, memory and model.
					</p>
				</div>
				{bots === undefined ? (
					result._tag === "Failure" ? (
						<p className="text-sm text-muted-foreground">
							{errorMessage(result.cause)}
						</p>
					) : (
						<div className="flex flex-col gap-2">
							{[0, 1, 2].map((index) => (
								<Skeleton key={index} className="h-16 w-full rounded-2xl" />
							))}
						</div>
					)
				) : bots.length === 0 ? (
					<Empty className="bg-muted/50">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<BotIcon />
							</EmptyMedia>
							<EmptyTitle>No Bots yet</EmptyTitle>
							<EmptyDescription>
								Make a Bot for a job that comes back, such as research or
								reports.
							</EmptyDescription>
						</EmptyHeader>
						<EmptyContent>
							<Button onClick={() => setEditing("new")}>
								<PlusIcon /> New Bot
							</Button>
						</EmptyContent>
					</Empty>
				) : (
					<ItemGroup className="gap-2">
						{bots.map((bot) => (
							<Item key={bot.id} variant="outline">
								<ItemMedia variant="icon">
									{bot.owner._tag === "Organization" ? (
										<UsersIcon />
									) : (
										<BotIcon />
									)}
								</ItemMedia>
								<ItemContent>
									<ItemTitle className="text-sm">
										{bot.name}
										{isDefault(bot) ? (
											<Badge variant="secondary">Default</Badge>
										) : null}
										{bot.owner._tag === "Organization" ? (
											<Badge variant="outline">Shared</Badge>
										) : null}
									</ItemTitle>
									<ItemDescription>{bot.role || "No role yet"}</ItemDescription>
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
				onClose={() => setEditing(undefined)}
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
			<DialogContent className="sm:max-w-lg">
				<form
					className="grid gap-4"
					onSubmit={(event) => {
						event.preventDefault()
						save()
					}}
				>
					<DialogHeader>
						<DialogTitle>
							{existing ? `Edit ${existing.name}` : "New Bot"}
						</DialogTitle>
						<DialogDescription>
							Give the Bot a clear job. It keeps its own memory as it works.
						</DialogDescription>
					</DialogHeader>
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor="bot-name">Name</FieldLabel>
							<Input
								id="bot-name"
								value={name}
								required
								maxLength={100}
								onChange={(event) => setName(event.target.value)}
								placeholder="Researcher"
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor="bot-role">Role</FieldLabel>
							<Input
								id="bot-role"
								value={role}
								maxLength={500}
								onChange={(event) => setRole(event.target.value)}
								placeholder="Finds sources and writes short reports"
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
								placeholder="How the Bot works, what it must check, and how it reports."
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
									<FieldDescription>
										Everyone in the organization can use it.
									</FieldDescription>
								</div>
							</Field>
						)}
					</FieldGroup>
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
