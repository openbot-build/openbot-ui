import { useAtomSet } from "@effect/atom-react"
import type { RequestsApi } from "@openbot-build/client/Api"
import {
	CheckIcon,
	ChevronDownIcon,
	ShieldAlertIcon,
	XIcon,
} from "lucide-react"
import { useState } from "react"
import { Link } from "react-router"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemFooter,
	ItemMedia,
	ItemTitle,
} from "@/components/ui/item"
import { resolveRequestAtom } from "@/atoms/chats"
import { errorMessage } from "@/lib/api"
import { showValue } from "@/lib/conversation"
import { cn } from "@/lib/utils"

type Request = RequestsApi.CapabilityRequest

/** The words for a limit of delegated work. */
const limitLabel: Record<string, string> = {
	time: "its time limit",
	steps: "its step limit",
	budget: "its budget",
}

/** The limit that paused work reached, from the arguments of its request. */
const reachedLimit = (args: unknown) =>
	typeof args === "object" &&
	args !== null &&
	"limit" in args &&
	typeof args.limit === "string"
		? limitLabel[args.limit]
		: undefined

/** Says in plain words what a Bot wants to do. */
export const describeRequest = (request: Request): string => {
	const { action, target } = request.capability
	switch (action) {
		case "tools.call":
			return `Use the tool “${target}”`
		case "apps.call":
			return `Use the App “${target}”`
		case "bots.create":
			return "Make a new Bot"
		case "bots.delegate":
			return `Give work to “${target}”`
		case "plans.run":
			return "Carry out its plan"
		case "channels.send":
			return `Post in the Channel “${target}”`
		case "delegations.continue":
			return `Go on with work that reached ${reachedLimit(request.capability.arguments) ?? "a limit"}`
		case "computers.acquire":
			return `Use the Computer “${target}”`
		case "computers.create":
			return `Make a new Computer at “${target}”`
		case "computers.delete":
			return `Delete the Computer “${target}”`
		case "computers.expose":
			return `Open a port of the Computer “${target}” to the internet`
	}
}

const statusLabel: Record<Request["status"], string> = {
	pending: "Waiting",
	allowed: "Allowed",
	denied: "Denied",
	expired: "Expired",
	cancelled: "Cancelled",
}

/** One request of a Bot. A pending request has buttons to allow or deny it. */
export function RequestCard({
	request,
	showChat = false,
}: {
	readonly request: Request
	readonly showChat?: boolean
}) {
	const resolve = useAtomSet(resolveRequestAtom, { mode: "promise" })
	const [busy, setBusy] = useState(false)
	const pending = request.status === "pending"

	const decide = (
		decision: "allow" | "deny",
		scope?: "once" | "chat" | "lifetime",
	) => {
		setBusy(true)
		resolve({ id: request.id, revision: request.revision, decision, scope })
			.then(
				() => toast.success(decision === "allow" ? "Allowed" : "Denied"),
				(cause: unknown) => toast.error(errorMessage(cause)),
			)
			.finally(() => setBusy(false))
	}

	// A decided request with only a title uses less space.
	const oneLine =
		!pending && !showChat && !request.reason && !request.capability.arguments

	return (
		<Item
			variant="outline"
			className={cn(
				"items-start gap-x-3 gap-y-5 bg-card",
				oneLine
					? "rounded-lg px-4 py-3"
					: "content-center rounded-panel nested-controls p-(--surface-inset)",
			)}
		>
			<ItemMedia variant="icon" className="mt-0.5">
				<ShieldAlertIcon className={pending ? "text-amber-500" : undefined} />
			</ItemMedia>
			<ItemContent className="min-w-0 gap-1">
				<ItemTitle className="text-body-medium">
					{describeRequest(request)}
					{pending ? null : (
						<Badge variant="secondary">{statusLabel[request.status]}</Badge>
					)}
				</ItemTitle>
				{request.reason ? (
					<ItemDescription className="line-clamp-none text-body-medium">
						{request.reason}
					</ItemDescription>
				) : null}
				{request.capability.arguments ? (
					<pre className="mt-2 max-h-40 overflow-auto rounded-control bg-muted/50 p-3 font-mono text-body-small text-muted-foreground">
						{showValue(request.capability.arguments)}
					</pre>
				) : null}
			</ItemContent>
			{pending || showChat ? (
				<ItemFooter className="gap-3">
					{showChat ? (
						<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-body-small text-muted-foreground">
							<span>{new Date(request.createdAt).toLocaleString()}</span>
							<Link
								to={`/c/${request.chat}`}
								className="underline underline-offset-4 hover:text-foreground"
							>
								Open chat
							</Link>
						</div>
					) : null}
					{pending ? (
						<ItemActions className="ml-auto">
							<Button
								variant="outline"
								size="lg"
								disabled={busy}
								onClick={() => decide("deny")}
								className="h-9 px-4"
							>
								<XIcon /> Deny
							</Button>
							<ButtonGroup>
								<Button
									size="lg"
									disabled={busy}
									onClick={() => decide("allow", "once")}
									className="h-9 px-4"
								>
									<CheckIcon /> Allow
								</Button>
								<DropdownMenu>
									<DropdownMenuTrigger
										render={
											<Button
												size="icon-lg"
												disabled={busy}
												aria-label="More choices"
												className="size-9"
											/>
										}
									>
										<ChevronDownIcon />
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end" className="w-52">
										<DropdownMenuItem onClick={() => decide("allow", "once")}>
											Allow once
										</DropdownMenuItem>
										<DropdownMenuItem onClick={() => decide("allow", "chat")}>
											Allow in this chat
										</DropdownMenuItem>
										<DropdownMenuItem
											onClick={() => decide("allow", "lifetime")}
										>
											Always allow
										</DropdownMenuItem>
										<DropdownMenuItem
											variant="destructive"
											onClick={() => decide("deny", "lifetime")}
										>
											Always deny
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</ButtonGroup>
						</ItemActions>
					) : null}
				</ItemFooter>
			) : null}
		</Item>
	)
}
