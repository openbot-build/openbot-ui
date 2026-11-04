# Kay OpenBot bridge

This package pins the native SDK at `0.1.0-kay.ef02e7b76a85`, built from
OpenBot commit `ef02e7b76a85d2518a407a0bd391714726c0066c`. Archive digests are
recorded in `native-source.json`; the private project registry supplies the
packages. Source and the upstream AGPL license travel with each SDK archive.

The bridge runs with native Effect 4.0.6. Kay uses Effect 4.0.5 and imports only
the plain `NativeClient` contract. No Effect value, schema class or runtime
service crosses this boundary. Requests use the native typed client and native
schemas. Only admitted session, organization and execution-fence headers reach
the core; browsers cannot choose arbitrary target URLs or identity headers.

`pnpm --filter @kaicom/kay-openbot generate:features` regenerates the product
catalog and static typed dispatch from the pinned SDK. The generator explicitly
includes product service groups and excludes authentication callbacks, machine
hooks and credit mutations. Each operation has self-contained JSON Schema for
forms, and the gateway checks its ID and HTTP method before dispatch. Multipart
files and streaming response bytes retain their native transport. Live upgrades
use the separately authenticated same-origin Kay WebSocket route.

Run `build` and `test` inside the repository devenv. The HTTP tests verify native
request encoding, credential forwarding, authorization failures, immediate SSE,
self-contained catalog references and multipart uploads. They are transport
fixtures, not production provider or end-user acceptance.

The visible catalog reads the current native session and organization
capabilities. Management action requirements are generated from the native
`Required` and `GroupRequired` annotations, so Kay does not infer permissions
from role names or turn a read permission into write access. Platform admin
visibility comes from the native session. Object-specific authorization remains
with its native endpoint. The static dispatch catalog is kept separate from
visibility checks so ordinary requests do not load every management permission.
