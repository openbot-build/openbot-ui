import type { MessagePage } from "@kaicom/kay-contracts"

/** Use the first saved user request, never a later tool result or assistant reply. */
export const conversationTitle = (
	page: typeof MessagePage.Type,
): string | null => {
	const first = [...page.items]
		.sort((a, b) => a.sequence - b.sequence)
		.find(
			(item) =>
				item.role === "user" &&
				item.parts.some(
					(part) => part.type === "text" && (part.text?.trim().length ?? 0) > 0,
				),
		)
	if (first === undefined) return null
	const text = first.parts
		.filter((part) => part.type === "text")
		.map((part) => part.text ?? "")
		.join(" ")
		.trim()
	// The Computer page adds this introduction before the user's actual task.
	const request =
		text
			.replace(
				/^(?:Help me with a task on my computer [“"].*?[”"]\.|帮我在电脑[“"].*?[”"]上处理一个任务[。.]|Hilf mir bei einer Aufgabe auf meinem Computer [„“"].*?[“”"]\.)\s*/u,
				"",
			)
			.trim() || text
	const line = request.split(/\r?\n/u).find((line) => line.trim() !== "") ?? ""
	const clean = line
		.replace(/^\s*#{1,6}\s+/u, "")
		.replace(/\s+/gu, " ")
		.trim()
	if (clean === "") return null
	const chars = Array.from(clean)
	return chars.length > 48 ? chars.slice(0, 47).join("") + "…" : clean
}
