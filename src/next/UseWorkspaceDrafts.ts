import { AtomRegistry } from "effect/reactivity"
import { useEffect, useState } from "react"
import * as Drafts from "../Drafts.ts"

export interface WorkspaceDrafts {
	readonly restore: (owner: Drafts.Owner) => void
	readonly read: (key: string) => string
	readonly set: (key: string, value: string) => void
	readonly acknowledge: (key: string, sent: string) => boolean
	readonly clear: () => void
}

/** Keep the workspace's confirmed identity independent of the legacy State registry. */
export const makeWorkspaceDrafts = (
	storage?: Parameters<typeof Drafts.make>[0],
): WorkspaceDrafts & { readonly dispose: () => void } => {
	const model = Drafts.make(storage)
	let registry: AtomRegistry.AtomRegistry | undefined
	let confirmed = false
	const context = () => (registry ??= AtomRegistry.make())
	const read = (key: string) =>
		confirmed ? context().get(model.drafts(key)) : ""
	const set = (key: string, value: string) => {
		if (confirmed) context().set(model.drafts(key), value)
	}
	return {
		restore: (owner) => {
			model.restore(context(), owner)
			confirmed = true
		},
		read,
		set,
		acknowledge: (key, sent) => {
			if (!confirmed || read(key).trim() !== sent) return false
			set(key, "")
			return true
		},
		clear: () => {
			confirmed = false
			model.clear(context())
		},
		dispose: () => {
			confirmed = false
			registry?.dispose()
			registry = undefined
		},
	}
}

/** Call restore after bootstrap confirms identity, and persist reducer edits synchronously. */
export function useWorkspaceDrafts(): WorkspaceDrafts {
	const [drafts] = useState(() => makeWorkspaceDrafts())
	useEffect(() => () => drafts.dispose(), [drafts])
	return drafts
}
