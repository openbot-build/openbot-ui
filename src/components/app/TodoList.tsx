import { useAtomValue } from "@effect/atom-react"
import { CircleCheckIcon, CircleIcon, ListTodoIcon } from "lucide-react"
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Spinner } from "@/components/ui/spinner"
import { todosAtom } from "@/atoms/chat"
import { cn, resultValue } from "@/lib/utils"

/**
 * The todo list that the Bot keeps while it works. It hides when it is empty.
 * Closed, it is one 44px row, too short for the screen corner, so it is a pill.
 */
export function TodoList({ id }: { readonly id: string }) {
	const todos = resultValue(useAtomValue(todosAtom(id)))?.items ?? []
	if (todos.length === 0) return null
	const done = todos.filter((todo) => todo.status === "done").length
	const current = todos.find((todo) => todo.status === "in_progress")
	return (
		<Collapsible className="rounded-screen bg-card text-sm data-closed:rounded-full">
			<CollapsibleTrigger className="flex w-full items-center gap-2 px-6 py-3 text-left data-panel-open:pt-6">
				<ListTodoIcon className="size-4 text-muted-foreground" />
				<span className="min-w-0 flex-1 truncate">
					{current?.content ??
						(done === todos.length ? "All steps are done" : "Steps")}
				</span>
				<span className="text-xs text-muted-foreground tabular-nums">
					{done}/{todos.length}
				</span>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<ul className="flex flex-col gap-1.5 px-6 pt-1 pb-6">
					{todos.map((todo) => (
						<li key={todo.id} className="flex items-start gap-2">
							{todo.status === "done" ? (
								<CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-emerald-500" />
							) : todo.status === "in_progress" ? (
								<Spinner className="mt-0.5 shrink-0 text-sky-500" />
							) : (
								<CircleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
							)}
							<span
								className={cn(
									todo.status === "done" &&
										"text-muted-foreground line-through",
								)}
							>
								{todo.content}
							</span>
						</li>
					))}
				</ul>
			</CollapsibleContent>
		</Collapsible>
	)
}
