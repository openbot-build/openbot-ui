import { dual } from "effect/Function"

export interface UnconfirmedChange {
	readonly operation: string
	readonly title: string
}

/** Keep an interrupted write visible after navigation without retaining its payload. */
export const changeKey: {
	(user: string, organization: string): string
	(organization: string): (user: string) => string
} = dual(
	2,
	(user: string, organization: string) =>
		`kay:unconfirmed-change:${encodeURIComponent(user)}:${encodeURIComponent(organization)}`,
)

type ReadStorage = Pick<Storage, "getItem">
type WriteStorage = Pick<Storage, "setItem" | "removeItem">
export const readUnconfirmed: {
	(storage: ReadStorage, key: string): UnconfirmedChange | null
	(key: string): (storage: ReadStorage) => UnconfirmedChange | null
} = dual(2, (storage: ReadStorage, key: string): UnconfirmedChange | null => {
	try {
		const raw = storage.getItem(key)
		if (raw === null) return null
		const value: unknown = JSON.parse(raw)
		if (
			typeof value !== "object" ||
			value === null ||
			!("operation" in value) ||
			!("title" in value)
		)
			return null
		return typeof value.operation === "string" &&
			typeof value.title === "string"
			? { operation: value.operation, title: value.title }
			: null
	} catch {
		return null
	}
})

export const writeUnconfirmed: {
	(storage: WriteStorage, key: string, value: UnconfirmedChange | null): void
	(
		key: string,
		value: UnconfirmedChange | null,
	): (storage: WriteStorage) => void
} = dual(
	3,
	(
		storage: WriteStorage,
		key: string,
		value: UnconfirmedChange | null,
	): void => {
		try {
			if (value === null) storage.removeItem(key)
			else
				storage.setItem(
					key,
					JSON.stringify({ operation: value.operation, title: value.title }),
				)
		} catch {
			/* The current view still retains the warning when browser storage is unavailable. */
		}
	},
)

/** Remove unset optional properties before passing a form through the product JSON contract. */
export function jsonValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(jsonValue)
	if (typeof value !== "object" || value === null) return value
	return Object.fromEntries(
		Object.entries(value)
			.filter(([, entry]) => entry !== undefined)
			.map(([key, entry]) => [key, jsonValue(entry)]),
	)
}
