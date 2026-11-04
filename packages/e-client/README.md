# @kaicom/e-client

Shared Effect 4 HTTP client for the public Platform API. The package works in browsers and desktop main processes without importing server implementations or UI dependencies.

```ts
import { Client, layer } from "@kaicom/e-client"
import { Effect } from "effect"

const program = Effect.flatMap(Client, (client) =>
	client.api.sessions.listSessions({ query: {} }),
)
await Effect.runPromise(
	program.pipe(Effect.provide(layer({ baseUrl: window.location.origin }))),
)
```

Protected requests use the browser's same-origin session Cookie. The browser supplies the Origin header for writes; Platform requires it to match its configured public origin exactly. Account operations use the same signed-in session. Platform does not provide programmatic key access.

The optional `onUnauthorized` callback runs when a protected response returns 401. It lets a UI disable access without automatically signing in or retrying a request. Keep the runtime mounted across account refreshes so completed writes are not replayed.

The package does not persist credentials or add them to URLs. `ClientError` includes typed `AuthenticationRequired` (401), `ForbiddenOrigin` (403), `AuthenticationUnavailable` (503), other public API failures, schema failures, and HTTP client failures. `make` accepts caller-provided HTTP and authentication middleware services for custom assembly: provide client middleware for `AgentAuth` and `SessionAuth`. Non-browser hosts must supply their authenticated Cookie and write Origin through the HTTP transport.

Discover an App at a known address with `client.api.apps.discoverApp({ payload: { input: "publisher.example" } })`. The result preserves the K Protocol `Single`/`Multiple` distinction. Handle `AppDiscoveryFailed` with `Effect.catchTag`; inspect `reason` for invalid input, missing publication, incompatible service or network failure. This operation only discovers candidates; it does not save or authorize a connection. Request, result and failure schemas are exported from `@kaicom/e-platform-api`.

Browse the public App Index without signing in with `client.api.appIndex.searchApps({ query: { query: "documents", limit: "20" } })`. Read configured sources through `listSources({})`; pass a source ID to restrict a search. Results merge identical Card URLs and sort by service name and Card URL. Pass `nextCursor` unchanged with the same search and source to continue. A changed source availability invalidates the cursor; restart at the first page. `issues` reports unavailable sources alongside partial results; `IndexUnavailable` means no selected source could be read. `getApp({ query: { cardUrl } })` reads public details and publication evidence. These responses never include private connections or account credentials.

Add an App through `client.api.connections.prepareConnection({ payload: { input } })`, then explicitly confirm a reviewed candidate with `createConnection`. Supply `draftId`, `revision`, `cardUrl`, `remoteIndex`, `name`, `values` and `confirmed: true`. Keep sensitive values in transient private form state. Server responses return only non-sensitive configuration and separate availability from the enabled setting. `getConnectionDraft` reopens an account-owned draft; `ConnectionConflict` requires refreshed input, while `ConnectionConfigurationInvalid` identifies missing configuration or an unsuccessful endpoint check. Repeated confirmation returns the same connection.

App account authorization uses `client.api.appAuthorization.beginAppAuthorization` with the current connection revision, requested scopes and an optional validated local `returnTo`. Review `AuthorizationStarted` before navigating to its provider URL in the current page; handle `IssuerSelectionRequired` with an explicit choice and `AuthorizationNotRequired` without inventing a grant. Read `getAppAuthorization` after returning. A `Received` flow requires `completeAppAuthorization` after sign-in. Neither operation executes an App business action. The anonymous `appAuthorizationPublic.appClientMetadata` document is independent of KAI login.

`AppViews.make` creates a credential-free MCP Apps client bound to a server-issued view. It validates standard MCP results, submits a unique action once, and observes that saved action until a final result. An optional change callback refreshes the workbench's native approval and Session projections. Closing the bridge stops observation without cancelling an already admitted server action.
