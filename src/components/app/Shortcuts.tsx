import { useAtomSet } from "@effect/atom-react"
import { useEffect } from "react"
import { useNavigate } from "react-router"
import { searchOpenAtom } from "@/atoms/ui"

/** The keyboard shortcuts of the app: search and a new chat. */
export function Shortcuts() {
	const navigate = useNavigate()
	const setSearchOpen = useAtomSet(searchOpenAtom)
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (!(event.metaKey || event.ctrlKey)) return
			const key = event.key.toLowerCase()
			if (key === "k") {
				event.preventDefault()
				setSearchOpen(true)
			}
			if (key === "o" && event.shiftKey) {
				event.preventDefault()
				navigate("/")
			}
		}
		window.addEventListener("keydown", onKeyDown)
		return () => window.removeEventListener("keydown", onKeyDown)
	}, [navigate, setSearchOpen])
	return null
}
