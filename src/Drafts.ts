import { HashMap, Option, Schema } from "effect"
import { Atom } from "effect/reactivity"

const Owner = Schema.Struct({ tenantId: Schema.String, userId: Schema.String })
export type Owner = typeof Owner.Type
const Record = Schema.Struct({
	version: Schema.Literal(1),
	owner: Schema.NullOr(Owner),
	values: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
})
export const storageKey = "kay:drafts:v1"

type StorageAccess = () => Pick<Storage, "getItem" | "setItem" | "removeItem">
type Context = {
	readonly get: <A>(atom: Atom.Atom<A>) => A
	readonly set: <R, W>(atom: Atom.Writable<R, W>, value: W) => void
}
type DraftState = {
	readonly owner: Owner | null | undefined
	readonly values: HashMap.HashMap<string, string>
}

const sameOwner = (first: DraftState["owner"], second: Owner | null) =>
	first === second ||
	(first !== undefined &&
		first !== null &&
		second !== null &&
		first.tenantId === second.tenantId &&
		first.userId === second.userId)

/** Restore tab-local drafts only after the server has identified their owner. */
export const make = (
	storage: StorageAccess = () => globalThis.sessionStorage,
) => {
	const state = Atom.make<DraftState>({
		owner: undefined,
		values: HashMap.empty(),
	}).pipe(Atom.keepAlive)
	const discard = () => {
		try {
			storage().removeItem(storageKey)
		} catch {
			try {
				storage().setItem(storageKey, "")
			} catch {
				// Storage restrictions must not prevent editing or signing out.
			}
		}
	}
	const read = () => {
		try {
			const input = storage().getItem(storageKey)
			return input === null
				? undefined
				: Option.getOrUndefined(
						Schema.decodeUnknownOption(Record)(JSON.parse(input)),
					)
		} catch {
			return undefined
		}
	}
	const persist = ({ owner, values }: DraftState) => {
		if (owner === undefined) return
		// Remove the previous snapshot first so a failed write cannot revive sent text.
		discard()
		const entries = Array.from(values).filter(([, value]) => value !== "")
		if (entries.length === 0) return
		try {
			storage().setItem(
				storageKey,
				JSON.stringify({ version: 1, owner, values: entries }),
			)
		} catch {
			// Keep the current draft in memory when tab storage is unavailable or full.
		}
	}
	const drafts = Atom.family((id: string) =>
		Atom.writable(
			(get) => Option.getOrElse(HashMap.get(get(state).values, id), () => ""),
			(ctx, value: string) => {
				const previous = ctx.get(state)
				const next = {
					...previous,
					values: HashMap.set(previous.values, id, value),
				}
				ctx.set(state, next)
				persist(next)
			},
		).pipe(Atom.withLabel(`draft:${id}`)),
	)
	const restore = (ctx: Context, owner: Owner | null) => {
		const previous = ctx.get(state)
		if (sameOwner(previous.owner, owner)) return
		const saved = previous.owner === undefined ? read() : undefined
		const restored =
			saved !== undefined && sameOwner(saved.owner, owner)
				? HashMap.fromIterable(saved.values)
				: HashMap.empty<string, string>()
		const next = {
			owner,
			values:
				previous.owner === undefined
					? HashMap.union(restored, previous.values)
					: previous.owner === null && owner !== null
						? previous.values
						: HashMap.empty<string, string>(),
		}
		ctx.set(state, next)
		persist(next)
	}
	const clear = (ctx: Context) => {
		ctx.set(state, { owner: null, values: HashMap.empty() })
		discard()
	}
	return { drafts, restore, clear }
}
