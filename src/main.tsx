import { RegistryProvider } from "@effect/atom-react"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "react-router"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { router } from "@/router"
import { watchViewport } from "@/lib/viewport"
import { consumeBackPress } from "@/lib/back"
import { nativeRuntime } from "@/lib/runtime"
import { ConnectionGate } from "@/components/app/ConnectionSettings"
import "./styles.css"

const root = document.getElementById("root")
if (root === null) throw new Error("The page has no root element.")
const stopViewport = watchViewport(window)
if (import.meta.hot) import.meta.hot.dispose(stopViewport)
const backListener = nativeRuntime()?.onBackPress?.(consumeBackPress)
backListener?.catch((error: unknown) => console.error("Could not set up the Back button.", error))
if (import.meta.hot) import.meta.hot.dispose(() => { void backListener?.then((stop) => stop()) })

createRoot(root).render(
	<StrictMode>
		<RegistryProvider>
			<TooltipProvider>
				<ConnectionGate><RouterProvider router={router} /></ConnectionGate>
				<Toaster position="top-center" />
			</TooltipProvider>
		</RegistryProvider>
	</StrictMode>,
)
