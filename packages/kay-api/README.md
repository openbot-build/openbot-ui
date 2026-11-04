# Kay API

Kay API keeps the existing Web client contract while routing execution to e or
OpenBot. It owns product preferences and cross-service operation receipts. It
never opens the OpenBot database, executes an Agent, or stores App credentials.

Run `pnpm --filter @kaicom/kay-api build`, `test`, or `start` inside the repository
devenv. The production image bundles the service and its schema migration entry
point. Apply schema changes explicitly before starting it; startup never moves
accounts or authentication data.

## Routing and authentication

`KAY_BACKEND_ROUTING=e` and `KAY_AUTH_BACKEND=e` provide the initial extraction.
Both become `ledger` only after the source accounts, global identity row, runtime
fences and watchdog have been initialized. Missing or inconsistent ledger state
fails closed. Business requests forward the user's actual cookie and verified
epoch. Browser identity and routing headers are discarded.

e owns sign-in during extraction. OpenBot takes authority after explicit identity
activation. Kay retains the original cookie names, callback paths and
redirects, and distinguishes 401 from permission-denied 403. Private SDK session
verification and durable revocation receipts let a verified sign-out interrupt
an identity migration. Uncertain revocations retain their leases; retry or the
private reconciliation endpoint confirms deletion before releasing them.

The compatibility projection converts complete history, refs, snapshots, Turn
settings, manual App identities and navigation results. User messages, MCP input,
results and configuration are opaque. The frontend layout, animation and catalog
assets are unchanged.

## Current OpenBot contracts

The adapter targets the native Agent and Request model introduced through upstream
157034c. Old approval paths use native Requests and the existing committed-history
parser; they do not store a second approval queue. Request IDs remain opaque to the
Web, and the native service checks revision and call occurrence before a decision.
Only reads are repeated while waiting for a decision to reach the Session.

Session lists request direct conversations so internal review/delegation Sessions
do not appear as duplicate Sidebar entries. Record restore supplies a verified native
host binding from the current Session or the caller's Main Agent. Imported identity,
ancestry and review fields never become authority. The latest native schema requires
an empty OpenBot target database; do not apply its replacement baseline over an old
initialized OpenBot database.

## Writes and recovery

Session create/fork/delete and App reset record `Prepared`, `Sending`, `Applied`,
`Completed` or `OutcomeUnknown` in Kay's own database. An `Applied` operation can
finish product bookkeeping without resending its external operation. An uncertain
operation is only queried. Preference reset holds the same account transaction
lock as edits and compares the saved baseline, so delayed compensation cannot
remove newer settings.

The private authority grants durable admission/write/send leases. Freezing and
activation hold the same account row lock and recheck leases. Deadlines are not
proof of completion. Old epochs cannot write or send tools. The runtime release
controller checks both live work and unopened durable approvals/input/unknown
operations before stopping an instance.

## Operational checks

`GET /internal/metrics` is available only on the private authority listener with
its bearer credential. The public router does not expose `/internal/*`.

- Process counters cover requests, rejected authentication, failed login,
  permission denial, failed approval, interrupted streams, uncertain product
  writes and rejected execution epochs.
- Bounded latency samples cover request time and streamed time to first text.
  The latter starts at the Turn POST and detects the first text event without
  retaining message payloads. Runtime `turn_first_text` structured logs also
  cover clients that poll instead of streaming.
- Database aggregates report migration phases, current freeze age and unresolved
  product operations. Migration phase/epoch audit records survive process restarts.
- OpenBot records `oauth_refresh_failed`; its existing request logs expose
  approval/authentication status. Inspect durable `Sending`/`OutcomeUnknown`
  App operations through the OpenBot API, never by retrying them.

Counters and samples reset on process restart. They are local observations, not a
new metrics database or a claim of production acceptance. Export these private
snapshots and structured logs to the company's existing monitoring. Any ownership
mismatch, duplicate external write or migration validation difference stops rollout.

## Acceptance

`OPENBOT_SOURCE_DIR=/path/to/pinned/OpenBot pnpm --filter @kaicom/kay-api test:integration`
runs real isolated PostgreSQL, signed OIDC, a TLS MCP fixture, OpenBot, Kay API and
the unchanged e SDK. It retains all functional assertions. `KAY_BENCHMARK_OUTPUT`
saves diagnostic read/TTFT samples and gateway stages, event-loop pauses and GC
intervals. Its client and both HTTP services share one Node.js heap, so these
samples are not the release performance gate: a GC triggered by any participant
can pause all three and fall on only one experimental arm.

`test:integration:fencing` runs the client, Kay gateway/authority and OpenBot in
three independent Node.js processes against real PostgreSQL. It uses real signed
OIDC, the unchanged session cookie and authentication/execution/write/send gates.
It verifies a live database send lease, rejects stale epochs without creating a
Turn or calling the provider, and checks that all authentication and execution
leases are released. Both direct and gateway paths retain runtime fencing.
`KAY_FENCING_BENCHMARK_OUTPUT` saves samples and per-process diagnostics.
`KAY_ENFORCE_PERFORMANCE=1` makes this fixture the release performance gate:

- Read requests keep the paired p95 additional-latency limit of 50 ms.
- TTFT compares both p50 and p95 between the gateway and direct OpenBot. Each
  gateway percentile may exceed the matching direct percentile by at most the
  larger of 50 ms or 10% of that direct percentile.

The gate retains 40 measured pairs after four warmup pairs, alternates request
order, and keeps growing conversations with the same deterministic 25 ms model.
Sampling uses HTTP only; process-control IPC occurs before or after the measured
loops. Each SSE is consumed to EOF, and the existing Session-inactive and durable
lease checks run before the next Turn. No extra settling delay is added. Process
isolation separates heaps and event loops, but host CPU and I/O are still shared.
Child-process event-loop and GC summaries cover startup through the end of
sampling; their maximum can include module imports. Timestamped GC, model and
gateway observations allow individual probes to be inspected separately.

Reports preserve paired TTFT differences as well as both endpoint distributions.
Paired differences are diagnostic: sequential requests do not share the same GC
or scheduling event, so the p95 of their differences is not the regression of
their p95 TTFT. This measures added gateway cost against direct OpenBot, not the
full latency difference between legacy e and OpenBot. A passing comparison does
not claim that the gateway is faster or that production latency is proven.

The CI integration job verifies and extracts the exact release source archive;
it does not follow an upstream branch or `latest` image. It runs after repository
checks, then runs functional acceptance followed by the independent-process
fencing/performance gate without overlapping either workload.

Local and CI success does not replace production comparison, real mobile
keyboard acceptance, the first-runtime maintenance prerequisite, or the required
24-hour observation at each rollout stage. See the migration job README and the
OpenSpec migration tasks for the remaining release gates.

Native Sessions without a title project to the old empty-string title. Empty create/fork titles use the native unnamed state; an empty rename explicitly clears the native title. Other user text and stored historical titles remain unchanged.

During mixed execution rollout, both App and Developer OAuth callbacks resolve their owner from the runtimes' private stored-flow lookup, then select the account's current execution route. The global authentication authority does not choose the callback's business backend. The lookup requires the internal bearer token and returns only an account ID; ambiguous or unavailable ownership fails closed.

## Native Chat workspace

`KAY_NEXT_ENABLED=true` enables `/api/kay/v1` only for accounts whose ledger is
already `OPENBOT_ACTIVE`. It is off by default. This release assembles the pinned
`@kaicom/kay-openbot` bridge alongside the existing compatibility router. Turning
on the flag does not migrate an account or replace its authentication authority.

The product contract lives in `@kaicom/kay-contracts`. It covers direct and
independent conversations, immutable branches, revision-based reads, native
started/steered/queued delivery, and committed-history recovery. The browser
client never retries a write to recover a stream. Feature catalog operations
reuse native services for tasks, approvals, files, connections, automation,
channels, computers, vaults, models and administration. Availability of an entry
does not grant permission or configure a provider; the core remains responsible
for both authorization and resource state.

Conversation titles and archive flags use `kay_chat_metadata` with account,
organization and revision checks. Pinning, projects and colors use the existing
preference service and concurrency rules. The metadata schema is installed by
the explicit business migration command. Every metadata target is checked
through the native Chat API, and list responses only include accessible Chats.

The feature HTTP router validates operation IDs, methods and native request
schemas. File uploads have a 16 MiB gateway limit, and download/SSE streams retain
backpressure. The native Live route upgrades only after same-origin identity and
account admission, then periodically rechecks the account epoch. Shutdown closes
upgraded sockets before stopping the HTTP server.

The catalog only presents organization and platform management actions allowed
by the current native identity and capability response. Reloading the catalog
reads permissions again. Actual operations always pass through native RBAC;
this presentation check is not a replacement for it.

Create and fork use their client `requestId` in the existing operation ledger.
A duplicate cannot resend a core write. A fork records the successful core
response before inheriting its companion, project and custom title. That Kay
update and the operation's completion share one transaction, so parallel
reconciliation cannot overwrite later user edits. The read-only
`GET /api/kay/v1/operations/:requestId` reports its phase and known Chat ID.
`POST /api/kay/v1/operations/:requestId/reconcile` only finishes an `Applied`
Kay update; it never resends `Prepared`, `Sending` or `OutcomeUnknown` operations.

CI installs the pinned internal SDK with `docker/with-npm-auth.py`. It uses the
existing cross-project `CI_JOB_TOKEN`, or an explicitly configured masked,
read-only `KAY_OPENBOT_PACKAGE_TOKEN`. The helper writes a temporary mode-0600
npm configuration and removes it after the child command exits. No registry
credential belongs in the repository, build context or package archives.

When the native Chat workspace starts an App or Developer authorization, Kay
records only the flow ID, verified account and same-origin return path in the
existing navigation store. A callback with a browser session must match that
account; an anonymous callback uses the stored reference only for routing.
OpenBot still validates state, issuer, ownership and completion. A callback is
admitted as a write, so a frozen account cannot exchange credentials. Legacy
flows retain their private runtime lookup. A navigation save failure after an
accepted authorization is an unknown result, never permission to start it again.
Reading the known authorization state can restore its navigation reference.

### Native workspace validation

The 2026-10-26 isolated exercise used OpenBot
`ef02e7b76a85d2518a407a0bd391714726c0066c` and the published SDK
`0.1.0-kay.ef02e7b76a85`. The product contracts, bridge and Kay API passed
9, 7 and 69 tests respectively, and all three package builds and the full Kay
workspace typecheck passed.

A separate-process exercise used a TLS reverse proxy, Kay API, the native
BrowserHost with real PostgreSQL and signed test identities, and the native App
OAuth fixture. Discovery, connection creation, CIMD metadata and S256 PKCE ran
through the real API boundary. A different signed-in account was rejected with 403. An anonymous callback returned 303 to `/next?panel=apps` with the flow
reference, without exchanging a token. The owner then completed authorization
successfully. A repeated completion was rejected with 422 and the provider
observed exactly one token exchange. The exercise preserved production HTTPS
validation and used no shared administrator credential.

These results cover the isolated services and test providers. They do not prove
production KAI login, a real model's latency, a third-party provider's behavior,
account data migration, mobile Safari interaction, or the production rollout
and observation gates.

### Native platform feedback validation

After building Kay and the compatible pinned OpenBot checkout, run this explicit
opt-in test from the Kay repository's devenv shell:

```sh
OPENBOT_NATIVE_SOURCE_DIR=/path/to/built/OpenBot \
  pnpm --filter @kaicom/kay-api exec node --test test/FeedbackNative.integration.mjs
```

It uses isolated PostgreSQL databases, signed test identities, a local TLS MCP
endpoint and the real native connector, discovery, exact Bot grant and tool-call
path. A deterministic model selects the discovered tool; no paid model, external
provider or production service is called. Repeated reports must persist once,
and ordinary members must be rejected from administrator reads and status
changes. The fixture closes its HTTP services, database processes and runtimes.
This file is not included in the default `test/*.test.ts` suite.

Apply `006_feedback.sql` through the existing migration command before exposing
the reporting endpoint. It adds two Kay tables and an inbox index without
converting existing records or touching OpenBot storage. Migration reruns preserve
those tables; an older Kay version ignores them. Keep the service secret stable
across releases so saved personal connection credentials remain reproducible.
General readiness does not inspect the feedback tables: verify the migration and
the administrator inbox separately. A local fixture pass is not a production
report submission or a model-provider acceptance result.

## Private basic task broker

Memberships belong to Kay's business database. Precious is USD 200/month and
Flawless is USD 2,000/month; purchasing is disabled. The configured stable
`KAY_MEMBERSHIP_CODE_MANAGER_ACCOUNT_ID` must also have current native platform
administrator permission to create, inspect or revoke codes. Any authenticated
member can redeem an available code. Codes are unbound until atomic redemption,
single-use and stored only as SHA-256 digests. Creation reveals the random code
once; its request receipt cannot reveal it again. Terms are 1–12 natural UTC
months, defaulting to one. Active subscriptions only renew the same plan.

The basic task broker is a separate, single-instance host process. It connects
each member's native Computer to a disposable Docker workspace. It does not run
an Agent, open a public port, or use an administrator's OpenBot token. Apply the
Kay membership and basic compute migrations explicitly before starting it.

After building this package, the operator can run
`pnpm --filter @kaicom/kay-api start:basic-compute` with exactly these service
settings:

| Setting                      | Purpose                                                      |
| ---------------------------- | ------------------------------------------------------------ |
| `KAY_DATABASE_URL`           | Kay business database; never the OpenBot database.           |
| `KAY_OPENBOT_ORIGIN`         | Private HTTP or HTTPS origin of the pinned OpenBot core.     |
| `KAY_BASIC_COMPUTE_SOCKET`   | Absolute path to the private Unix control socket.            |
| `KAY_BASIC_COMPUTE_KEY_FILE` | Absolute path to a persistent 32-byte binary encryption key. |

Use a directory owned by the service account with mode `0700` for the socket.
The socket uses mode `0600`. Kay API must run under an account that can access
that socket and the same key file. Keep the key file at mode `0600`, outside the
repository and task workspace, and back it up as a service secret. Never print
it, replace it on restart, or supply it to a task container. Losing the key
requires explicit connector credential repair; existing ciphertext cannot be
recovered by generating a new key. The broker requires no `KAY_INTERNAL_TOKEN`,
membership code manager identity, public origin, or legacy execution settings.

The trusted host process needs noninteractive access to `sudo -n docker` and the
exact digest-pinned image in `BasicComputeDocker.ts`. Prepare that image through
the normal operator release process. The broker never pulls an image. Its health
check verifies a Linux Docker daemon and the local pinned image before setup can
proceed. Do not put the broker itself inside a user task container or expose its
Docker access through a network endpoint.

Tasks run as UID/GID `65532`, with a read-only root filesystem, no direct network, no
capabilities, no new privileges, Docker's default AppArmor profile, and no host
files or Docker socket. Only the lease's public HTTP/HTTPS proxy socket is mounted.
Each container has 0.5 CPU, 512 MiB memory with no swap,
32 processes, a 64 MiB workspace and 64 MiB temporary directory. Both memory
filesystems count toward the same 512 MiB limit. Each command is
limited to 120 seconds and 64 KiB combined output; downloads can be up to 10 MiB.
PTYs, desktops and public ports
are unavailable. This is limited shared-kernel container execution, not VM
isolation or a general computer provider.

Only one task container can be active across members. The broker checks the
current member's subscription before actual command, file and input operations;
membership expiry ends that member's lease. Workspaces are temporary. A stopped,
expired or failed lease discards its files. Commands and file operations are not
automatically repeated after a lost response.

For an eligible member, messages to the default Kay Bot or its Chats prepare the
personal Computer connector automatically. This reuses the same account and
provisioning record; it does not create a container for each message. The first
computer tool call creates the container. Failed computer preparation does not
prevent ordinary text conversations, and unknown credential operations are not
repeated automatically.

The core reports work for the Computer's granted Bots in its authenticated
connector heartbeat. Running, queued and pending task work keep the workspace,
including time spent waiting for a model. Confirmed idle starts a five-minute
cleanup period; new work cancels it. Unknown activity is not evidence of idle.
Subscription expiry and explicit release still stop the workspace. Browser
activity and open tabs do not renew it. A file call arriving during a command
waits on the same lease, for at most 90 seconds, with at most eight waiting file
calls. Membership and lease ownership are checked again before it starts.

Provisioning keeps the real member's core credentials and uses native command
receipts. A lost create response is resolved by reading the saved command. An
explicit continuation uses the same request and command key; a process that lost
its local operation lock cannot attach a Computer or begin token issuance. Once
token issuance begins, its lock is never reclaimed by elapsed time. An explicit
repair retires the old Computer through its native deletion receipt, confirms
that the old ID is gone, and creates a replacement before issuing a new token.
Late token responses belong to the retired Computer and cannot overwrite the
new generation. Do not clear operation locks or copy plaintext connector tokens
as a recovery shortcut.

Generic Computer management cannot rotate, share or regrant a managed basic
workspace. During the brief creation interval before its ID is known, the
member's other Computer management changes return a retryable setup conflict;
ordinary command and file calls remain available. Reading the creation receipt
ends that temporary restriction. Native authorization still checks every caller
and the personal Bot's grant before a connector operation reaches the broker.

`SIGTERM` and `SIGINT` stop the broker, close its workspaces and then dispose its
database runtime. Removal must be confirmed before the global lease is released.
If shutdown fails, retain the database lease and inspect the exact named
container before restarting. Startup also cleans up the saved lease rather than
adopting old processes. If container creation was never confirmed, an empty
container lookup does not prove that a delayed creation has stopped. Retain that
lease until its outcome and removal can be confirmed. An existing socket is
never unlinked automatically:
verify that its previous broker has exited before removing a stale socket. Run
only one broker against this Kay database; do not run overlapping replacements
or configure an automatic failover instance.

These instructions describe the local entry and its operational requirements.
They do not indicate that the broker has been enabled or accepted in production.
