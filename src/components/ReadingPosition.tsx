import { Array, Option, Schema } from "effect"
import { useLayoutEffect, useRef, type RefObject } from "react"
import { useMessageScroller } from "./ui/message-scroller"

const storageKey = "kay:reading-position:v1"
const SavedPosition = Schema.Struct({
	route: Schema.String,
	viewportWidth: Schema.Finite,
	viewportHeight: Schema.Finite,
	messageId: Schema.String,
	offset: Schema.Finite,
})

export function ReadingPosition({
	viewport,
	session,
}: {
	readonly viewport: RefObject<HTMLDivElement | null>
	readonly session: string
}) {
	const { scrollToMessage } = useMessageScroller()
	const attempted = useRef(false)
	useLayoutEffect(() => {
		const route = location.pathname + location.search + location.hash
		if (!attempted.current) {
			attempted.current = true
			try {
				const saved = sessionStorage.getItem(storageKey)
				sessionStorage.removeItem(storageKey)
				const navigation = performance.getEntriesByType("navigation")[0]
				if (
					saved !== null &&
					navigation instanceof PerformanceNavigationTiming &&
					["reload", "back_forward"].includes(navigation.type) &&
					document.documentElement.dataset["kayStartup"] === "skip"
				) {
					const position = Option.getOrUndefined(
						Schema.decodeUnknownOption(SavedPosition)(JSON.parse(saved)),
					)
					if (
						position !== undefined &&
						position.route === route &&
						position.viewportWidth === innerWidth &&
						position.viewportHeight === innerHeight
					) {
						const items = Array.map(
							Array.fromIterable(
								viewport.current?.querySelectorAll<HTMLElement>(
									"[data-message-id]",
								) ?? [],
							),
							(item) => ({ item, visibility: item.style.contentVisibility }),
						)
						// Intrinsic placeholders would create a false bottom spacer during restoration.
						Array.forEach(items, ({ item }) => {
							item.style.contentVisibility = "visible"
						})
						try {
							Array.forEach(items, ({ item }) => {
								item.style.containIntrinsicBlockSize = `auto ${item.getBoundingClientRect().height}px`
							})
							scrollToMessage(position.messageId, {
								align: "start",
								behavior: "instant",
								scrollMargin: position.offset,
							})
						} finally {
							Array.forEach(items, ({ item, visibility }) => {
								item.style.contentVisibility = visibility
							})
						}
					}
				}
			} catch {
				// A denied or invalid saved position leaves normal scrolling available.
			}
		}
		const save = () => {
			try {
				sessionStorage.removeItem(storageKey)
				const element = viewport.current
				// Latest-message views retain the scroller's normal following behavior.
				if (
					element === null ||
					element.dataset["scrollable"]?.split(" ").includes("end") !== true
				)
					return
				const bounds = element.getBoundingClientRect()
				const firstVisible = Option.getOrUndefined(
					Array.findFirst(
						element.querySelectorAll<HTMLElement>("[data-message-id]"),
						(item) => {
							const itemBounds = item.getBoundingClientRect()
							return (
								itemBounds.bottom > bounds.top && itemBounds.top < bounds.bottom
							)
						},
					),
				)
				if (firstVisible === undefined) return
				sessionStorage.setItem(
					storageKey,
					JSON.stringify({
						route: location.pathname + location.search + location.hash,
						viewportWidth: innerWidth,
						viewportHeight: innerHeight,
						messageId: firstVisible.dataset["messageId"],
						offset: firstVisible.getBoundingClientRect().top - bounds.top,
					}),
				)
			} catch {
				// Reading remains available when tab storage is denied.
			}
		}
		addEventListener("pagehide", save)
		return () => removeEventListener("pagehide", save)
	}, [viewport, session, scrollToMessage])
	return null
}
