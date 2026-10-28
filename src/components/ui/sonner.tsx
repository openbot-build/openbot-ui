import { useAtomValue } from "@effect/atom-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import {
	CircleCheckIcon,
	InfoIcon,
	TriangleAlertIcon,
	OctagonXIcon,
	Loader2Icon,
} from "lucide-react"
import { themeAtom } from "@/atoms/account"

const Toaster = ({ ...props }: ToasterProps) => {
	const theme = useAtomValue(themeAtom)

	return (
		<Sonner
			theme={theme}
			className="toaster group"
			icons={{
				success: <CircleCheckIcon className="size-4" />,
				info: <InfoIcon className="size-4" />,
				warning: <TriangleAlertIcon className="size-4" />,
				error: <OctagonXIcon className="size-4" />,
				loading: <Loader2Icon className="size-4 animate-spin" />,
			}}
			style={
				{
					"--normal-bg": "var(--popover)",
					"--normal-text": "var(--popover-foreground)",
					"--normal-border": "var(--popover)",
					"--border-radius": "var(--radius-2xl)",
				} as React.CSSProperties
			}
			toastOptions={{
				classNames: {
					toast: "cn-toast",
				},
				style: { boxShadow: "none" },
			}}
			{...props}
		/>
	)
}

export { Toaster }
