export interface PendingConversation {
	readonly requestId: string
	readonly kind: "create" | "fork"
}

export const recoveryKey = (identity: string): string =>
	"kay:conversation-operation:" + encodeURIComponent(identity)

/** A reload retains the operation ID, never the message or an API credential. */
export const readPendingConversation = ({
	storage,
	key,
}: {
	readonly storage: Pick<Storage, "getItem">
	readonly key: string
}): PendingConversation | null => {
	try {
		const raw = storage.getItem(key)
		if (raw === null) return null
		const value: unknown = JSON.parse(raw)
		if (
			typeof value !== "object" ||
			value === null ||
			!("requestId" in value) ||
			!("kind" in value)
		)
			return null
		return typeof value.requestId === "string" &&
			/^[A-Za-z0-9_-]{1,160}$/.test(value.requestId) &&
			(value.kind === "create" || value.kind === "fork")
			? { requestId: value.requestId, kind: value.kind }
			: null
	} catch {
		return null
	}
}

export const writePendingConversation = ({
	storage,
	key,
	value,
}: {
	readonly storage: Pick<Storage, "setItem" | "removeItem">
	readonly key: string
	readonly value: PendingConversation | null
}): void => {
	try {
		if (value === null) storage.removeItem(key)
		else
			storage.setItem(
				key,
				JSON.stringify({ requestId: value.requestId, kind: value.kind }),
			)
	} catch {
		/* The current view retains the pending operation without browser storage. */
	}
}
