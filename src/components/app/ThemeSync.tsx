import { useAtomValue } from "@effect/atom-react"
import { useEffect } from "react"
import { applyTheme, themeAtom } from "@/atoms/account"

/** Keep the page in sync with the chosen theme, including system changes. */
export function ThemeSync() {
	const theme = useAtomValue(themeAtom)
	useEffect(() => {
		applyTheme(theme)
		if (theme !== "system") return
		const query = window.matchMedia("(prefers-color-scheme: dark)")
		const change = () => applyTheme(theme)
		query.addEventListener("change", change)
		return () => query.removeEventListener("change", change)
	}, [theme])
	return null
}
