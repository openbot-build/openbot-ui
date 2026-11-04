# @kaicom/e-platform-api

Effect 4.0.5 Schema contracts shared by Platform and its ordinary clients. `PlatformApi` generates the server routes, typed HTTP client and OpenAPI document. Importing this package performs no I/O. Protected operations require a signed-in session Cookie; writes also require the configured public Origin.

## Sessions, Turns and Items

| Request                                                  | Behavior                                                                               |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `POST /v1/sessions`                                      | `{ title?, settings? }`; 201 idle Session, no model call                               |
| `GET /v1/sessions?archived=`                             | Session summaries without Memory or output payloads                                    |
| `GET /v1/sessions/:id`                                   | Current Session, Memory, latest response and activity                                  |
| `PATCH /v1/sessions/:id`                                 | `{ expected: revision, title?, archived? }`                                            |
| `PUT /v1/sessions/:id/settings`                          | Revision-checked Session settings                                                      |
| `DELETE /v1/sessions/:id`                                | Remove the reference, retaining shared Memory                                          |
| `POST /v1/sessions/:id/turns`                            | `{ expected: revision, input, overrides?, stream?, background? }`; 202 JSON or 200 SSE |
| `GET /v1/sessions/:id/turns?after=&limit=`               | Paginated own and inherited read-only Turn records                                     |
| `GET /v1/sessions/:id/turns/:turnId`                     | Stable Turn record and its response                                                    |
| `GET /v1/sessions/:id/turns/:turnId/items?after=&limit=` | Paginated Items belonging to that Turn                                                 |
| `POST /v1/sessions/:id/turns/:turnId/steer`              | `{ input }`; guidance for the exact active Turn                                        |
| `POST /v1/sessions/:id/queue`                            | `{ input, expected?: revision }`; persist input for a later Turn                       |
| `POST /v1/sessions/:id/turns/:turnId/interrupt`          | Interrupt the exact Turn                                                               |
| `POST /v1/sessions/:id/resume`                           | Reload the same Session without scheduling work                                        |
| `GET /v1/sessions/:id/wait?after=&timeoutMs=`            | Observe revision changes, including settings-only changes                              |

`Session.Id`, `Turn.Id`, `Item.Id`, `Memory.VersionId` and `Session.Revision` have separate meanings. A tool loop with several model steps remains one business Turn. Settings changes affect subsequent Turns; an accepted Turn retains its effective settings. A stale revision, busy Session or delayed Turn control fails without replacing active work.

Input is nonempty text or an array of user messages with string content or `input_text` parts. Unknown fields, unsupported roles/media and `background: false` fail validation. `background` defaults to true and `stream` to false. Accepted execution belongs to Platform; closing an HTTP observer does not cancel it or resubmit the input.

A Session View contains `session`, `state`, nullable `response` and `activity`. Session settings, metadata, queue, Turn records and business values live in `session`. `state.value.memory` contains history and prompt/native context; Memory-scoped plugins use their own namespaces. `activity` distinguishes active execution, inactivity and unfinished historical records. Reading or restoring a record executes no models, tools, queues or approvals.

## Memory Fork and records

| Request                                 | Behavior                                                              |
| --------------------------------------- | --------------------------------------------------------------------- |
| `GET /v1/sessions/:id/versions`         | Reachable immutable Memory headers, with zero or one direct parent    |
| `GET /v1/sessions/:id/history?version=` | Current or reachable historical Memory                                |
| `POST /v1/sessions/:id/fork`            | Optional `version`, `title`, `settings`; 201 independent idle Session |
| `GET /v1/sessions/:id/record`           | Complete format-3 Session record                                      |
| `PUT /v1/sessions/:id/record`           | `{ record, expected: fullRefOrNull }`; atomic restore                 |

Fork selects a coherent closed boundary; omission selects the latest eligible boundary even while the source runs. The target inherits Memory and read-only Turn provenance. It receives no Goal, pending input, approval continuation, active execution or resource authority. Target settings can be chosen independently. Historical reads do not move the source head, and Fork never replays tools.

Restore requires matching path/record Session IDs. `expected: null` imports a new reference; replacement requires the existing full reference. The record contains complete Memory parents, original Item IDs and Turn result pointers, so it remains usable after removing its source Session. Normal decoding accepts format 3. Earlier Agent formats are not supported. Agent-wide Merge routes and automatic negotiation executors have been removed.

## Models, modes and learned memory

`GET /v1/sessions/:id/models` returns the host's selectable provider/model catalog without credentials. `PUT /v1/sessions/:id/model` accepts `{ expected: revision, selection }`; `PUT /v1/sessions/:id/mode` accepts `{ expected: revision, mode: "default" | "plan" }`. Settings may include `memoryEnabled` and `memoryGenerationEnabled`. Valid saves advance revision without creating Memory Versions or changing an earlier Turn's result. Model incompatibility is handled when context is used for a subsequent Turn. Mode does not grant tool permissions.

`GET /v1/sessions/:id/memory` reads learned entries and progress. Updates at `POST` take `{ expected: memoryHead, revision, command }`. Commands are `Remember`, `Forget`, `Configure` and `Refresh`. Manual entries and retractions create Memory checkpoints; Configure changes only Session switches. Refresh needs a model and atomically commits validated changes with its processed Item cursor. Completed Turns can consolidate automatically when generation is enabled. Fork inherits only entries at its selected boundary; revoked entries do not reactivate from old evidence.

## Approvals

`GET /v1/sessions/:id/approvals` lists pending native requests with their Turn and tool-call identities. `POST /v1/sessions/:id/turns/:turnId/approvals/:approvalId` accepts `{ expected: revision, approved, reason? }` and returns a 202 response continuing the same Turn. Decisions do not start another business Turn. Repeated, historical, delayed and foreign decisions cannot execute tools. A Fork or restored record has no effective approval continuation. Historical requests remain visible as evidence; Resume marks orphaned unfinished work interrupted.

## Responses and SSE

The JSON receipt uses a Responses-style text projection: `id` is the stable Turn ID, `session` identifies its owner and `version` points to its accepted/current result checkpoint. Final results retain the Turn's committed end pointer even after later settings or learned-memory changes. Native `usage` is included when available. `output` contains stable Item IDs and assistant `output_text` content; status is `in_progress`, `completed`, `incomplete`, `failed` or `cancelled`. Length/content-filter endings retain their native incomplete reason.

SSE and JSON derive from the same Turn execution. `SessionResponseEvent` and `SessionResponseSseEvent` expose the native codec. Event and `data.type` agree; `sequence_number` increases from zero. The stream emits created/in_progress, Item/content added, text delta/done, content/Item done and exactly one response terminal event before EOF. Each event carries `session` and `turn`; model output events also carry their numeric `step`. Each model output keeps its Item identity across deltas. Empty text still has a valid added/done structure. Cancellation uses the Platform extension `response.cancelled`. No `[DONE]` marker, tool-event transport, Last-Event-ID replay or automatic write retry is provided.

Disconnecting releases only the observation buffer. Reopen using get/wait to read committed results. Direct core execution has separate cancellation ownership; the HTTP observer never owns the host Turn. Received external receipts survive interruption, and unknown tool outcomes are not reported as rolled back.

## Typed client and failures

```ts
import { Client } from "@kaicom/e-client"
import { Effect, Stream } from "effect"

const program = Effect.gen(function* () {
	const client = yield* Client
	const created = yield* client.api.sessions.createSession({
		payload: { title: "My work" },
	})
	const params = { sessionId: created.session.id }
	const result = yield* client.api.sessions.startTurn({
		params,
		payload: {
			expected: created.session.revision,
			input: "Hello",
			stream: true,
		},
	})
	if (Stream.isStream(result)) yield* Stream.runDrain(result)
	return yield* client.api.sessions.getSession({ params })
})
// Provide the public Client Layer at the application entry point.
```

Validation failures return 400; inaccessible Sessions return `SessionNotFound` (404); busy or stale operations return 409; storage and missing execution capabilities return 503. Rejection before acceptance changes no state. A model failure after acceptance is a persisted failed Turn, available through successful reads. Specific public error Schemas retain their tagged identities for Effect handling.

`OpenApi.fromApi(PlatformApi)` generates the shared contract; the server serves it at `/openapi.json` with a reference UI at `/docs`. Authentication and deployment are documented in the [Platform guide](../../platform/README.md).

Wait requests can include the previously observed activity (`afterActive` in core, `afterActivity` in HTTP). Execution-scope release then wakes observers even when the Session revision and Memory head are unchanged, so completed work becomes available for the next Turn immediately.

The preferences contract retains `assistantName` and accepts optional `workspace.companions` for private companion identities. Each companion has an `id`, a name of 1–20 Unicode characters, a six-digit hexadecimal `color` and its Session identifiers. A workspace has one to thirty companions, begins with the default `k` identity, and does not assign a Session to multiple companions. Changes to an existing companion collection, including its default name, follow the concurrency rules below. Optional `workspace.pinnedSessions` stores up to 500 unique pinned Session identifiers. Optional `workspace.projects` stores up to 100 private groups with unique ids, names of 1–60 Unicode characters, and Session identifiers assigned to at most one project. Pins and project membership may coexist. Omitting either field preserves the stored value; an explicit empty array clears it. These fields organize references only and grant no access to their Sessions. The legacy optional `dockMagnificationAmount` integer records navigation magnification and displacement from 0 (off) to 100 (the existing maximum effect), defaulting to 100. It is saved per account and retained when omitted. The `dockMagnification` boolean remains available for existing callers; sending an amount also sets the enabled state. The Web Sidebar ignores the retained magnification fields. Display preferences do not grant access to a Session or alter its Agent execution.

`PATCH /v1/preferences` applies one owner-scoped intent in a database transaction: `SetPin`, `MoveToProject`, `CreateProject`, `CreateCompanion`, `UpdateCompanion`, `AssignCompanion`, `InheritOrganization`, or `SetDeveloperCenter`. Send `{ "change": { "_tag": "SetPin", "sessionId": "...", "pinned": true } }`, using an actual accessible Session identifier. Independent updates read the latest saved state under the same account lock instead of replacing a cached workspace. Session deletion removes its companion, pin and project references in the same transaction. PATCH also removes historical references to missing Sessions before applying its change. Regenerated continuations inherit the source companion and project, not its pin.

Legacy PUT may initialize a workspace. Later changes to its effective content, including the normalized Kay name derived from `assistantName`, require `expectedWorkspace` equal to the latest saved workspace. An unchanged effective workspace or an update that leaves it unchanged remains compatible; stale or unverifiable replacements return `PreferencesConflict` (409). Missing Session references fail explicitly. Omitting pin/project fields retains their saved values; callers clearing or replacing them must supply the matching workspace baseline or use PATCH.
