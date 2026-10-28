import { useCallback, useEffect, useRef, useState } from "react"

/** Copies text to the clipboard. `copied` is true for a short time after. */
export function useCopy(timeout = 1500) {
	const [copied, setCopied] = useState(false)
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
	useEffect(() => () => clearTimeout(timer.current), [])
	const copy = useCallback(
		(text: string) => {
			void navigator.clipboard?.writeText(text).then(() => {
				setCopied(true)
				clearTimeout(timer.current)
				timer.current = setTimeout(() => setCopied(false), timeout)
			})
		},
		[timeout],
	)
	return { copied, copy }
}
