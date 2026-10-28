import * as Atom from "effect/reactivity/Atom"

/** Whether the search dialog is open. */
export const searchOpenAtom = Atom.make(false)

/** The open tab of the settings dialog, or none when the dialog is closed. */
export type SettingsTab = "general" | "account" | "tokens"
export const settingsTabAtom = Atom.make<SettingsTab | undefined>(undefined)
