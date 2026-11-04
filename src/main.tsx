import { StrictMode, useLayoutEffect } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, useLocation, useNavigate } from "react-router"
import { LocalizationProvider } from "./components/Language"
import { Live } from "./next/Live"
import { SignIn } from "./components/SignIn"
import { ConnectionGate } from "./components/ConnectionSettings"
import { routeSearch } from "./next/RouteSearch"
import { watchViewport } from "./lib/viewport"
import { useAppearance } from "./hooks/UseAppearance"
import { consumeBackPress } from "./lib/back"
import { nativeRuntime } from "./lib/runtime"
import "./styles.css"

function ThemeSync() {
	const { dark } = useAppearance()
	useLayoutEffect(() => {
		document.documentElement.classList.toggle("dark", dark)
		document.documentElement.style.colorScheme = dark ? "dark" : "light"
	}, [dark])
	return null
}

function Workspace() {
	const location = useLocation()
	const navigate = useNavigate()
	const search = routeSearch(
		Object.fromEntries(new URLSearchParams(location.search)),
	)
	if (location.pathname === "/sign-in") return <SignIn />
	return (
		<Live
			location={search}
			onLocation={(value) => {
				const query = new URLSearchParams()
				for (const [key, item] of Object.entries(value))
					query.set(key, String(item))
				void navigate({ pathname: "/", search: query.toString() })
			}}
		/>
	)
}

const root = document.getElementById("root")
if (root === null) throw new Error("The page has no root element.")
const stopViewport = watchViewport(window)
if (import.meta.hot) import.meta.hot.dispose(stopViewport)
const backListener = nativeRuntime()?.onBackPress?.(consumeBackPress)
backListener?.catch((error: unknown) =>
	console.error("Could not set up the Back button.", error),
)
if (import.meta.hot)
	import.meta.hot.dispose(() => {
		void backListener?.then((stop) => stop())
	})

createRoot(root).render(
	<StrictMode>
		<BrowserRouter>
			<LocalizationProvider>
				<ThemeSync />
				<ConnectionGate>
					<Workspace />
				</ConnectionGate>
			</LocalizationProvider>
		</BrowserRouter>
	</StrictMode>,
)
