import { cn } from "@/lib/utils"

/** The OpenBot mark: a round face with two eyes. */
export function LogoMark({ className }: { readonly className?: string }) {
	return (
		<svg
			viewBox="0 0 32 32"
			fill="none"
			aria-hidden="true"
			className={cn("size-6", className)}
		>
			<rect
				x="3"
				y="5"
				width="26"
				height="22"
				rx="11"
				stroke="currentColor"
				strokeWidth="2.5"
			/>
			<circle cx="12" cy="16" r="2.25" fill="currentColor" />
			<circle cx="20" cy="16" r="2.25" fill="currentColor" />
			<path
				d="M16 5V1.5"
				stroke="currentColor"
				strokeWidth="2.5"
				strokeLinecap="round"
			/>
		</svg>
	)
}

/** The mark and the name. */
export function Logo({ className }: { readonly className?: string }) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-2 text-lg font-semibold tracking-tight",
				className,
			)}
		>
			<LogoMark />
			OpenBot
		</span>
	)
}
