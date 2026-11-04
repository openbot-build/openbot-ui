import { useEffect, type RefObject } from "react"
import { registerBackDismiss } from "@/lib/back"

/** Use the component's close action so controlled state and focus stay in sync. */
export function useBackDismiss(open: boolean, actions: RefObject<{ close: () => void } | null>) {
	useEffect(() => {
		if (open) return registerBackDismiss(() => actions.current?.close())
	}, [open, actions])
}
