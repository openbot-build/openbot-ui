import { RegistryProvider } from "@effect/atom-react"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "react-router"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { router } from "@/router"
import { ThemeSync } from "@/components/app/ThemeSync"
import "./styles.css"

const root = document.getElementById("root")
if (root === null) throw new Error("The page has no root element.")

createRoot(root).render(
	<StrictMode>
		<RegistryProvider>
			<ThemeSync />
			<TooltipProvider>
				<RouterProvider router={router} />
				<Toaster position="top-center" />
			</TooltipProvider>
		</RegistryProvider>
	</StrictMode>,
)
