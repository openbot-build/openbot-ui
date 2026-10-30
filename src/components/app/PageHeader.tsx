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
				"sticky top-0 z-10 flex min-h-20 shrink-0 items-center gap-3 bg-background px-(--sheet-action-inset) py-4 md:min-h-[110px] md:px-(--frame-action-inset) md:py-(--frame-action-inset)",
				className,
			)}
		>
			{isMobile || state === "collapsed" ? <SidebarTrigger className="size-11 [&_svg]:size-5" /> : null}
			<div className="min-w-0 flex-1 truncate text-title-large">{title}</div>
			{actions ? (
				<div className="flex items-center gap-1">{actions}</div>
			) : null}
		</header>
	)
}
