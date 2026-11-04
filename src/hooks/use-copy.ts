import { useCallback, useEffect, useRef, useState } from "react"
import { writeClipboard } from "@/lib/runtime"

/** Copies text to the clipboard. `copied` is true for a short time after. */
export function useCopy(timeout = 1500) {
	const [copied, setCopied] = useState(false)
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
	useEffect(() => () => clearTimeout(timer.current), [])
	const copy = useCallback(
		(text: string) => {
			void writeClipboard(text).then(() => {
				setCopied(true)
				clearTimeout(timer.current)
				timer.current = setTimeout(() => setCopied(false), timeout)
			}).catch(() => setCopied(false))
		},
		[timeout],
	)
	return { copied, copy }
}
