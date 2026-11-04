import { Schema } from "effect"
import { useSyncExternalStore } from "react"
import { storageKey } from "../lib/runtime"

export const Appearance = Schema.Literals(["system", "light", "dark"])
export type Appearance = typeof Appearance.Type

function readAppearance(): Appearance {
	try {
		const saved = localStorage.getItem(storageKey("openbot.theme"))
		return Schema.is(Appearance)(saved) ? saved : "system"
	} catch { return "system" }
}

function subscribeAppearance(notify: () => void) {
	window.addEventListener("kai-appearance", notify)
	window.addEventListener("storage", notify)
	return () => {
		window.removeEventListener("kai-appearance", notify)
		window.removeEventListener("storage", notify)
	}
}

function subscribeSystem(notify: () => void) {
	const media = matchMedia("(prefers-color-scheme: dark)")
	media.addEventListener("change", notify)
	return () => media.removeEventListener("change", notify)
}

function readSystemDark() {
	return matchMedia("(prefers-color-scheme: dark)").matches
}

export function setAppearance(appearance: Appearance) {
	if (appearance === "system") localStorage.removeItem(storageKey("openbot.theme"))
	else localStorage.setItem(storageKey("openbot.theme"), appearance)
	window.dispatchEvent(new Event("kai-appearance"))
}

export function useAppearance() {
	const appearance = useSyncExternalStore(subscribeAppearance, readAppearance)
	const systemDark = useSyncExternalStore(subscribeSystem, readSystemDark)
	return {
		appearance,
		dark: appearance === "dark" || (appearance === "system" && systemDark),
	}
}
