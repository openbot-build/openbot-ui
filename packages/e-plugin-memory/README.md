# @kaicom/e-plugin-memory

Learned memory for Effect 4 Sessions. Entries, source Item IDs, retractions and processing cursors belong to each Session’s immutable Memory. `use` and `generate` switches belong to Session settings. Legacy negotiation JSON remains readable as an archive; the package provides no new Merge or negotiation executor.

```ts
import { Store, SessionStoreMemory } from "@kaicom/e-core"
import {
	Memory,
	MemoryOperations,
	MemoryRules,
	LanguageModelMemory,
} from "@kaicom/e-plugin-memory"
import { Effect } from "effect"

const program = Effect.scoped(
	Effect.gen(function* () {
		const definition = yield* Store.define({
			schemaVersion: "memory/1",
			stores: Memory.stores,
		})
		const store = yield* SessionStoreMemory.make(definition)
		return MemoryOperations.make({
			store,
			policy: MemoryRules.policy,
			model: LanguageModelMemory.model,
		})
	}),
)
```

Construct operations within the repository's host Scope. Construction calls no model. Provide `LanguageModel` only when consolidating. `MemoryPolicy` and `MemoryModel` are replaceable contracts; `MemoryRules` and `LanguageModelMemory` provide their implementations. Persistent hosts supply SessionStoreRepository with the same adapter used by execution.

`read(session)` reads current learned memory. `update(position, command)` takes a Session position with both revision and Memory head. Remember and Forget edit Memory without a model; Configure updates Session switches without creating a Memory Version. `consolidate(session, { enabled? })` uses the Session switch by default; a host can pass the accepted Turn's frozen choice. It processes committed Items not present in `processed`, validates their identities and commits changes and cursor together. Failed extraction or invalid evidence leaves the cursor unchanged. Retractions can only be reactivated by an explicit Remember command.

`MemoryRules.policy.project(state)` includes the active entries in the supplied Session state. Independent Sessions have separate entries; Fork inherits the selected Memory. Platform injects that text when an accepted Turn enables memory, and consolidates after completed Turns when generation is enabled. The accepted Turn freezes its settings.

Fork and restore call no memory model. Fork inherits entries from the selected checkpoint, with no future evidence or Session switches copied as Memory. Retractions suppress future use while immutable old evidence remains readable. Explicit Agent-record migration separates old switches and preserves the original archive; `Memory.store` declares memory scope and Schema revision 2.
