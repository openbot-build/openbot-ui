import type { ReactNode } from "react"
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

/** The bar at the top of a page. It shows the side bar button when the side bar is closed. */
export function PageHeader({
	title,
	actions,
	className,
}: {
	readonly title?: ReactNode
	readonly actions?: ReactNode
	readonly className?: string
}) {
	const { state, isMobile } = useSidebar()
	return (
		<header
			className={cn(
				"sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 bg-background/80 px-3 backdrop-blur",
				className,
			)}
		>
			{isMobile || state === "collapsed" ? <SidebarTrigger /> : null}
			<div className="min-w-0 flex-1 truncate text-sm font-medium">{title}</div>
			{actions ? (
				<div className="flex items-center gap-1">{actions}</div>
			) : null}
		</header>
	)
}
