import { useAtomSet } from "@effect/atom-react"
import { Trash2Icon } from "lucide-react"
import { type ReactElement, useState } from "react"
import { useNavigate } from "react-router"
import { toast } from "sonner"
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { clearChatAtom } from "@/atoms/chats"
import { errorMessage } from "@/lib/api"

/**
 * The actions of one chat. A Chat belongs to a Bot, so it cannot be renamed or
 * copied. Deleting it takes away the Chat and its history. The next message to
 * the Bot starts a new Chat, so an open chat page goes back to the start page.
 */
export function ChatMenu({
	id,
	name,
	bot,
	trigger,
	align = "start",
}: {
	readonly id: string
	readonly name: string
	/** The Bot of the chat. The start page talks to it after a delete. */
	readonly bot: string
	readonly trigger: ReactElement
	readonly align?: "start" | "end"
}) {
	const clear = useAtomSet(clearChatAtom, { mode: "promise" })
	const navigate = useNavigate()
	const [deleting, setDeleting] = useState(false)

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger render={trigger} />
				<DropdownMenuContent align={align} className="w-44">
					<DropdownMenuItem
						variant="destructive"
						onClick={() => setDeleting(true)}
					>
						<Trash2Icon /> Delete history
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<AlertDialog open={deleting} onOpenChange={setDeleting}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete history?</AlertDialogTitle>
						<AlertDialogDescription>
							This deletes the history of your chat with “{name}”. Work that is
							running stops. You cannot undo it.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={() =>
								clear(id).then(
									() => {
										setDeleting(false)
										toast.success("History deleted")
										if (globalThis.location.pathname === `/c/${id}`)
											navigate(`/?bot=${bot}`)
									},
									(cause: unknown) => toast.error(errorMessage(cause)),
								)
							}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}
