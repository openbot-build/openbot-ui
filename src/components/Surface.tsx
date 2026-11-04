import {
	useRef,
	useLayoutEffect,
	useSyncExternalStore,
	type ReactNode,
	type ComponentProps,
} from "react"
import { Drawer } from "@base-ui/react/drawer"
import { useBackDismiss } from "../hooks/use-back-dismiss"
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetDescription,
} from "./ui/sheet"
import "./Surface.css"

const subscribe = (listener: () => void) => {
	const media = matchMedia("(max-width: 1279px)")
	media.addEventListener("change", listener)
	return () => media.removeEventListener("change", listener)
}
export function useNarrow() {
	return useSyncExternalStore(
		subscribe,
		() => matchMedia("(max-width: 1279px)").matches,
		() => false,
	)
}

const portraitMedia =
	"(max-width: 767px), (max-width: 1279px) and (orientation: portrait)"
const subscribePortrait = (listener: () => void) => {
	const media = matchMedia(portraitMedia)
	media.addEventListener("change", listener)
	return () => media.removeEventListener("change", listener)
}
export function usePortraitLayout() {
	return useSyncExternalStore(
		subscribePortrait,
		() => matchMedia(portraitMedia).matches,
		() => false,
	)
}
export function Surface({
	open,
	onOpenChange,
	title,
	titleLeading,
	description,
	children,
	wide = false,
	navigation = false,
	finalFocus,
}: {
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
	readonly title: string
	readonly titleLeading?: ReactNode
	readonly description?: string | undefined
	readonly children: ReactNode
	readonly wide?: boolean
	readonly finalFocus?: ComponentProps<typeof SheetContent>["finalFocus"]
	readonly navigation?: boolean
}) {
	const narrow = useNarrow()
	const dismiss = useRef({ close: () => onOpenChange(false) })
	dismiss.current.close = () => onOpenChange(false)
	useBackDismiss(open, dismiss)
	const panelRef = useRef<HTMLDivElement>(null)
	const previousNavigation = useRef(navigation)
	useLayoutEffect(() => {
		const leavingNavigation = previousNavigation.current && !navigation
		previousNavigation.current = navigation
		if (open && leavingNavigation)
			panelRef.current?.focus({ preventScroll: true })
	}, [open, navigation])
	const previous = useRef({ title, description, children, wide, navigation })
	if (open)
		previous.current = { title, description, children, wide, navigation }
	const content = open
		? { title, description, children, wide, navigation }
		: previous.current
	const sidebar = narrow && content.navigation

	return (
		<Sheet
			open={open}
			onOpenChange={onOpenChange}
			swipeDirection={sidebar ? "left" : "down"}
		>
			<SheetContent
				ref={panelRef}
				data-mascot-boundary="surface"
				data-mascot-closing={!open || undefined}
				finalFocus={finalFocus}
				presentation={sidebar ? "sidebar" : narrow ? "drawer" : "dialog"}
				className={
					!narrow && content.wide
						? "surface-panel sm:max-w-4xl"
						: "surface-panel"
				}
			>
				<SheetHeader
					className={
						narrow
							? "surface-header shrink-0 px-4 pt-0 pb-3"
							: "surface-header p-0 pr-8"
					}
					data-has-title-leading={titleLeading !== undefined || undefined}
				>
					<div className="surface-title-row">
						{titleLeading}
						<SheetTitle>{content.title}</SheetTitle>
					</div>
					<SheetDescription
						className={
							content.description !== undefined ? undefined : "sr-only"
						}
					>
						{content.description ?? content.title}
					</SheetDescription>
				</SheetHeader>
				<Drawer.Content
					data-surface-scroll={narrow ? "" : undefined}
					data-base-ui-swipe-ignore={!narrow ? "" : undefined}
					className={
						narrow
							? "surface-body"
							: "grid min-w-0 content-start items-start gap-2"
					}
				>
					<div
						className={narrow ? "surface-body-inner" : "contents"}
						data-navigation={content.navigation || undefined}
					>
						{content.children}
					</div>
				</Drawer.Content>
			</SheetContent>
		</Sheet>
	)
}
