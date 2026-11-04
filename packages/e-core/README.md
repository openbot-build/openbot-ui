# @kaicom/e-core

Effect 4 contracts and implementations for reusable Agent capabilities, persistent Sessions, business Turns and immutable Memory. This unreleased 0.1.0 package uses `effect@4.0.5`.

An `Agent.Definition` configures tools, middleware, providers and compaction. One definition can serve several Sessions. `SessionStore.Store<P>` owns Session references and Memory persistence; `SessionRuntime.make({ store, agent })` owns execution and observation within its host Scope. Importing or constructing capabilities performs no model or tool calls.

## Create a Session and complete a Turn

```ts
import {
	MemoryState,
	SessionRuntime,
	SessionStoreMemory,
	Store,
} from "@kaicom/e-core"
import { Effect } from "effect"
import { Toolkit } from "effect/ai"

const program = Effect.scoped(
	Effect.gen(function* () {
		const definition = yield* Store.define({
			stores: {},
			schemaVersion: "memory/1",
		})
		const store = yield* SessionStoreMemory.make(definition)
		const runtime = yield* SessionRuntime.make({
			store,
			agent: { toolkit: Toolkit.empty },
		})
		const initial = yield* store.create({
			metadata: { title: "Closures" },
			value: MemoryState.initial({}),
		})
		const first = yield* runtime.execute({
			base: { session: initial.session.id, revision: initial.session.revision },
			input: "Explain closures",
		})
		return yield* runtime.execute({
			base: { session: first.session.id, revision: first.session.revision },
			input: "Give an example",
		})
	}),
)
// Provide LanguageModel and any tool handlers, then run program at the host entry point.
```

Each accepted input creates one `Turn.Id`. A Turn can contain several model steps and tool calls. `Item.Id` identifies a history item; `Memory.VersionId` identifies a checkpoint; `Session.Revision` controls changes to the mutable Session reference. These identities are distinct. Settings are captured on Turn acceptance, so later selection changes apply to the next Turn.

`execute` returns a committed `Session.View`; `stream` accepts the same input and emits `VersionCreated`, `TurnStarted`, `ModelStepStarted`, native `ResponsePart`, `TurnWaitingApproval` and `TurnCompleted`. Both use the same execution loop. Events include the current Session position, stable Turn/Item identities and numeric model step. `TurnCompleted` follows a committed terminal record; approval suspension uses `TurnWaitingApproval`. Read results from `Session.currentTurn(view.session)` or the Turn records, not from Memory.

A Session has one active execution slot. Other Sessions can execute concurrently with the same Agent definition. Stale revisions and busy starts fail before model calls. Typed model, tool and plugin failures remain in `E`; defects and interruption retain Effect semantics. Direct execution owns its cancellation scope. `start` instead returns an acceptance receipt and runs in the host Scope. Observing `events` or `wait` does not own that execution.

## Session management and Memory Fork

Management needs no model or Runtime:

```ts
const fork =
	yield *
	store.fork({
		source: initial.session.id,
		version: initial.session.head,
		metadata: {
			title: "Alternative",
		},
		settings: { mode: "plan", memoryEnabled: false },
	})
const renamed =
	yield *
	store.updateMetadata({
		expected: fork.session,
		metadata: { ...fork.session.metadata, title: "Experiment" },
	})
const record = yield * store.export(renamed.id)
const independent = yield * SessionStoreMemory.make(definition)
const restored = yield * independent.import({ record, expected: null })
```

A Fork creates a new Session from a reachable, coherent Memory boundary. Omitting `version` selects the latest closed boundary, including while the source is active. An explicit active or incomplete tool boundary is rejected. The target starts idle, with empty pending input and Session business values. It inherits historical Turn groups as read-only provenance. Goal, approval continuation, execution fibers, connections and process handles are not inherited. Fork does not execute, consolidate or stop the source.

Ordinary context is inherited with the selected history. Compatible native provider context can be reused. A different provider/model rebuilds ordinary context from complete selected history without replaying tools. Earlier boundaries never receive future summaries, learned entries or Item groups.

`session.settings`, `pending`, `turns`, `business` and metadata belong to the Session. Their updates advance revision without manufacturing a Memory Version. `state.value.memory` contains complete history, current prompt/native context and the closed-boundary marker. Memory-scoped plugin values sit beside `memory` under their Plugin IDs. Known Session plugin values cannot be encoded into Memory.

`updateSettings` and `updateMetadata` compare the expected reference revision. `modifyEffect({ session, expectedRevision?, expectedHead?, update })` serializes a callback over the latest View. Return `[result, Option.some({ value?, session? })]` to commit, or `[result, Option.none()]` to skip. Callbacks preserve their precise failures and requirements and must not re-enter Store writes or mutate input values. No-op Memory updates create no Version.

`get` and `getVersion` are optional reference/header lookups. `read(session)` materializes the current View; `read(session, version)` reads a reachable historical Memory; `readVersion(version)` reads immutable Memory by ID. `log({ from })` traverses the single-parent history in child-before-parent order; `diff({ base, target })` compares unpacked Memory JSON. `remove(ref)` preserves shared immutable content. There is no Agent-wide Merge or automatic negotiation executor.

## Control and recovery

`steer({ session, turn, input })` adds guidance to the active Turn at its next safe model boundary. `enqueue({ session, message, expectedRevision? })` stores ordinary pending input. `runQueued(session)` explicitly accepts pending input as a new Turn; successful background execution can drain the next queued input. Reading, importing and Resume do not drain queues.

`approve({ session, turn, approval, approved, expectedRevision })` persists a native approval response and resumes that same Turn. Repeated, historical and delayed decisions fail. The loaded runtime owns effective approval continuations; restoring their recorded requests cannot recreate that authority. `canApprove({ session, turn })` reports that ownership without executing. `interrupt({ session, turn })` targets an exact Turn, releases resources and persists interruption. Already received external tool receipts remain in history; unfinished tool results are recorded as unavailable, without claiming their external effects were undone.

`Session.pendingApprovals(view)` returns only unresolved client tool requests recorded by the current Session and Turn. Each request includes its zero-based occurrence of the call ID, so a later model step can reuse an ID without inheriting an earlier result or decision. `Agent.Context.toolCallCount(id)` reads the committed occurrence count for the current Turn independently of context compaction. Both the request and its call need matching Item provenance; inherited, earlier-Turn and provenance-free records cannot authorize execution. The runtime applies the same rule even when a caller supplies the current Turn ID with a historical approval ID.

Before accepting another Turn or resuming an idle record, the runtime closes unfinished historical tool interactions as observations. It restores an available original result into the context or records an unavailable outcome with the original call identity. This never invokes a historical handler or resubmits an uncertain write. A retained receipt is copied only when the call is uniquely identifiable in both history and context; identical repeated calls remain unknown. Recovery searches every retained occurrence, including earlier calls whose IDs were later reused; each receipt remains attached to its original call. Approval execution distinguishes call occurrences even when a later Turn reuses a model call ID, retaining the original ID in its result.

`resume(session)` reloads the same Session identity. It returns an already active instance without a second execution slot and marks a persisted unfinished Turn interrupted when its old execution scope no longer exists. Goals and queues remain inactive until explicit work is requested. `wait({ session, after, timeout })` observes Session revisions, including settings-only changes.

## Persistence

`SessionStoreRepository.make({ definition, persistence, onCommit?, onRemove? })` captures Codec services and shares one write boundary. Host overrides must atomically save the delta into the same persistence; changed content, Memory checkpoint and Session reference become visible only after saving succeeds. Failed writes publish no success. `MemoryPersistence.make` supplies the in-memory adapter. Repositories cache at most 64 decoded Memory Versions.

`changes({ session? })` emits `VersionCommitted`, `RefUpdated` and `RefRemoved` after successful writes. Observation resources belong to their Scope. `RecordSerialization.make()` exposes encode/decode/materialize/compare against a Definition. Format-3 Session records contain the Session reference, immutable snapshots and complete parent/content closure. Media bytes/URLs, opaque native provider items, unknown Memory namespaces and inherited provenance survive round trips. Replacing a Session requires its current expected reference and valid first-parent advancement.

Only current format-3 Session records are accepted. Earlier Agent formats have no conversion path. Each Memory Version has zero or one direct parent.

## Plugin state and execution context

`Plugin.make({ id })(() => Effect.succeed(middleware))` defines a reusable capability. For a stateful plugin, use `Plugin.make({ id, store })(({ store }) => Effect.succeed(middleware))`; the constructor receives its own Store service key. Store declarations specify `scope: "memory" | "session"` and their current Codec. Memory declarations are inheritable; Session declarations persist under `session.business` and start empty on Fork.

Pass `plugin.stores` to `Store.define`, construct the repository, then inject it into `PluginState.make({ store, plugin })` and `SessionRuntime.make({ store, agent: { plugin } })`. Provide the resulting own Store service as `plugin.store`. It exposes the safe SynchronizedRef methods over `Option<A>`, including conditional and effectful updates. `snapshot` returns the value and Session position; `setAt({ base, value })` compares revision and Memory head. All operations return after durable success and preserve unrelated namespaces.

`SessionRuntime.make` runs the plugin constructor once in the host Scope and reuses the returned middleware across Turns and Sessions. Constructors can acquire resources and use `Effect.forkScoped` to start resident services; closing the host Scope interrupts those services and runs their finalizers. Each runtime builds its own resources from the same reusable definition. Construction errors and dependencies (`BuildE`, `BuildR`) are separate from middleware execution errors and dependencies (`E`, `R`). Constructors read host services; current Session/Turn context is available when the returned middleware executes.

`agent.hostPlugin` accepts an ordinary `Plugin.make` definition whose dynamic tools own their handlers inside execution middleware. Its `HostTools` type contributes to streamed events without requiring those internal handlers in the caller execution Layer. The base `toolkit` and `plugin` keep their caller-provided handlers and execution dependencies. The host plugin must provide its handlers and codecs before calling the next middleware, and acquire Turn resources in that execution Scope.

`PluginComposition.merge` constructs left then right before composing the returned middleware. Defining or combining plugins does not run their constructors. A plain plugin returns its existing middleware with `Effect.succeed`.

```ts
const plugin = Plugin.make({ id: Plugin.Id.make("resident") })(() =>
	Effect.gen(function* () {
		const service = yield* BackgroundService
		yield* Effect.forkScoped(service.run)
		return (next, options) => next(options)
	}),
)
```

`BackgroundService` is a caller-provided service. Its `run` program and any acquired resources belong to the same host Scope as the constructed middleware. Ending a Turn does not stop it.

Middleware and native handlers read automatically supplied `Agent.Context`: `at`, stable `turn`, numeric `step`, options and history. `PluginComposition.merge(A, B)` places A outside B. Each execution scope enters the middleware once; approvals continue the same Turn in a fresh scope. Native finalizers release resources on completion, failure and cancellation. Generic runtime/Store Layers accept caller-defined `Context.Service` keys so concrete tool, Codec, failure and requirement types remain precise.

## Models, skills and compaction

`ConfigurationOperations.modelConfiguration` validates provider/model/options and saves Session settings. `executionMode` updates Session mode. `Config.Selection` and catalog metadata remain separate from provider credentials and executable `Model` Layers. An accepted Turn freezes its selection; automatic compaction uses that selection.

`Agent.Definition` accepts providers, models, model catalog, tool options and compaction. `Config.Compaction.Native()` uses the host's native compaction service; `Config.Compaction.NonNative({ model?, keepRecentMessages? })` summarizes older context without tools while preserving recent linked tool messages and media. The default recent count is eight. Explicit `runtime.compact` takes a Session, target token count, request and optional expected Memory head. The full history remains intact. Invalid limits, provider failures, unmet targets and stale heads do not commit a new window.

`ContextCompaction` counts the complete request, including instructions, toolkit and selection. Configured automatic compaction runs at the model request boundary, normally at 90% of the usable context limit. `ConversationContextOperations` provides load, summarize and compact; summarize does not commit. Native windows retain ordered opaque provider items and later Prompt content. Provider/model incompatibility rebuilds ordinary context. See [OpenAI provider](../e-provider-openai/README.md) for native counting and compaction.

`SkillMap.Catalog` is an Effect `Chunk<Skill.Descriptor>`; later catalogs replace matching IDs while retaining their original position. Integrators supply skill discovery, loading and invocation. `@kaicom/e-plugin-turn-limiter` counts model steps within a Turn.

Public modules are exported from the root and their corresponding package subpaths. The [core sample](../../samples/e-core/README.md) demonstrates a multi-step Turn without network access.

Wait requests can include the previously observed activity (`afterActive` in core, `afterActivity` in HTTP). Execution-scope release then wakes observers even when the Session revision and Memory head are unchanged, so completed work becomes available for the next Turn immediately.

`runtime.startAction({ base, action: { name, arguments, source? }, turn? })` admits an exact host-selected tool action through the ordinary Session revision, tool validation, native approval, Item and cancellation rules. It does not require a model service. Without `turn` it creates a Turn; an explicitly related resident Turn queues the action behind its current work. Other busy or historical Turns reject the action. The receipt includes its stable tool call ID. `approveAction` uses the same pending approval records without model inference. Ordinary `approve` remains available for model-driven work.

The runtime feeds the selection through the native Chat/tool handler pipeline with an internal deterministic driver. It never asks a provider to choose parameters, loads no model catalog for that phase, emits no `ModelStepStarted` for it, and records no model usage or model step. Each related action re-enters the existing middleware in the same resident Turn with current `Agent.Context.options.action`; its resources close with that phase and the shared execution owns cancellation. The action's optional `source` is opaque provenance data, not a permission grant. Imported and forked records retain history but have no resident approval continuation.
