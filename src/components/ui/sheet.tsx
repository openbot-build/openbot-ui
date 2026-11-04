"use client"

import { t } from "@lingui/core/macro"

import * as React from "react"
import { Drawer as SheetPrimitive } from "@base-ui/react/drawer"
import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

const SheetHeightContext = React.createContext<(height: number) => void>(
	() => {},
)

function SheetLayout({ children }: { readonly children: React.ReactNode }) {
	const [height, setHeight] = React.useState(0)
	const style: React.CSSProperties & { readonly "--sheet-height": string } = {
		"--sheet-height": `${height}px`,
	}
	return (
		<SheetPrimitive.Provider>
			<SheetHeightContext.Provider value={setHeight}>
				<div className="workbench-viewport" style={style}>
					{children}
				</div>
			</SheetHeightContext.Provider>
		</SheetPrimitive.Provider>
	)
}

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
	return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
	return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
	return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
	return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
	return (
		<SheetPrimitive.Backdrop
			data-slot="sheet-overlay"
			className={cn(
				"fixed inset-0 z-50 bg-black/30 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-sm",
				className,
			)}
			{...props}
		/>
	)
}

function SheetContent({
	className,
	children,
	presentation = "drawer",
	showCloseButton = true,
	style,
	...props
}: SheetPrimitive.Popup.Props & {
	presentation?: "drawer" | "dialog" | "sidebar"
	showCloseButton?: boolean
}) {
	const drawer = presentation === "drawer"
	const sidebar = presentation === "sidebar"
	const publishHeight = React.useContext(SheetHeightContext)
	const [measure, setMeasure] = React.useState<HTMLDivElement | null>(null)
	const [height, setHeight] = React.useState<number>()
	React.useLayoutEffect(() => {
		if (!drawer || measure === null) return
		const update = () => {
			const next = measure.getBoundingClientRect().height + 1
			setHeight(next)
			publishHeight(next)
		}
		update()
		const observer = new ResizeObserver(update)
		observer.observe(measure)
		return () => {
			observer.disconnect()
			publishHeight(0)
		}
	}, [drawer, measure, publishHeight])
	return (
		<SheetPortal>
			<SheetOverlay
				className={
					drawer
						? "sheet-push-dismiss"
						: sidebar
							? "sheet-sidebar-dismiss"
							: undefined
				}
			/>
			<SheetPrimitive.VirtualKeyboardProvider>
				<SheetPrimitive.Viewport className="sheet-viewport">
					<SheetPrimitive.Popup
						data-slot={drawer || sidebar ? "sheet-content" : "dialog-content"}
						data-presentation={presentation}
						data-base-ui-swipe-ignore={!drawer && !sidebar ? "" : undefined}
						data-side={sidebar ? "left" : drawer ? "bottom" : undefined}
						className={cn(
							"sheet-panel pointer-events-auto fixed z-50 flex min-w-0 flex-col bg-popover text-[15px] text-popover-foreground outline-none",
							sidebar
								? "inset-y-0 left-0 h-dvh w-[min(86vw,350px)] overflow-hidden border-r border-sidebar-border bg-sidebar"
								: drawer
									? "inset-x-0 bottom-0 h-auto max-h-[90dvh] w-full translate-x-0 translate-y-0 overflow-hidden rounded-t-[28px] border-t border-border/70"
									: "top-1/2 left-1/2 max-h-[85dvh] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-5 overflow-y-auto overscroll-contain rounded-[28px] p-6 shadow-lg ring-1 ring-border/70 sm:max-w-sm",
							className,
						)}
						style={(state) => ({
							...(typeof style === "function" ? style(state) : style),
							...(drawer && height !== undefined ? { height } : {}),
						})}
						{...props}
					>
						<div
							ref={setMeasure}
							className={drawer ? "sheet-measure" : "contents"}
						>
							{showCloseButton && (
								<SheetPrimitive.Close
									data-slot="sheet-close"
									aria-label={t`Close`}
									className={
										drawer
											? "sheet-handle"
											: sidebar
												? "sheet-sidebar-close"
												: "absolute top-3 right-3"
									}
									render={
										drawer ? (
											<button type="button" />
										) : (
											<Button variant="ghost" size="icon-sm" />
										)
									}
								>
									{drawer ? <span aria-hidden="true" /> : <XIcon />}
								</SheetPrimitive.Close>
							)}
							{children}
						</div>
					</SheetPrimitive.Popup>
				</SheetPrimitive.Viewport>
			</SheetPrimitive.VirtualKeyboardProvider>
		</SheetPortal>
	)
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sheet-header"
			className={cn("flex flex-col gap-1.5 p-6", className)}
			{...props}
		/>
	)
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sheet-footer"
			className={cn("flex flex-wrap gap-3 p-6", className)}
			{...props}
		/>
	)
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
	return (
		<SheetPrimitive.Title
			data-slot="sheet-title"
			className={cn(
				"font-heading text-xl leading-snug font-semibold text-foreground",
				className,
			)}
			{...props}
		/>
	)
}

function SheetDescription({
	className,
	...props
}: SheetPrimitive.Description.Props) {
	return (
		<SheetPrimitive.Description
			data-slot="sheet-description"
			className={cn(
				"text-[15px] leading-relaxed text-muted-foreground",
				className,
			)}
			{...props}
		/>
	)
}

export {
	SheetLayout,
	Sheet,
	SheetTrigger,
	SheetClose,
	SheetContent,
	SheetHeader,
	SheetFooter,
	SheetTitle,
	SheetDescription,
}
