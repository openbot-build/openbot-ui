# OpenBot UI

The MIT web app for [OpenBot](https://github.com/openbot-build/openbot).
It uses Vite, React Router, shadcn/ui, and Effect Atom.

Install `@openbot-build/client` from GitHub Packages. This repository publishes
`@openbot-build/web` with its static build in `dist`.

See the [package setup and release guide](https://docs.openbot.build/contributing#package-releases)
for registry access, first installation, version tags, and commit versions.
Use `devenv shell -- bash scripts/install.sh`, then `devenv shell -- pnpm dev`.
The dev server sends API calls to `OPENBOT_DEV_PUBLIC_ORIGIN` (default `http://localhost`).
Use `devenv shell -- pnpm client:update <version>` to change the client version.

Run `devenv shell -- direnv allow` once in this folder to let direnv load the
project shell. Zed uses `.zed/settings.json`: Nix runs through `devenv lsp`,
and TypeScript and TSX use the local TypeScript 7 language server. Install the
project packages before opening TypeScript files in Zed.

MIT. See [LICENSE](./LICENSE). Installed packages keep their own licenses.

## Native shell entry

The browser remains the default. A native shell can import
`@openbot-build/web/runtime` and call `installRuntime` before the app entry runs.
The `NativeRuntime` type defines the version 1 boundary. It supplies the HTTPS
API origin, a Fetch-compatible transport, login/logout, Live WebSockets,
clipboard writes, and external URL opening. Keep long-lived credentials in the
native process. The transport must preserve cancellation and streamed responses.
Direct file uploads use `fetchResource`, which selects that native transport or
browser fetch. The shell must check file-storage destinations separately and
keep API credentials out of those requests.
Login resolves only when the new native session can make API calls; the UI then
opens the saved local return path.

`pnpm build` also builds the public runtime module and its types. The static
build contains `openbot-runtime.json`, which tells a shell which runtime version
the UI accepts, and `licenses/dependencies.md`. Ship these files with the assets.
The shell must load its adapter before the UI module. Do not rewrite the bundled
application code or point native requests at the page origin.

This is an integration entry, not a native authentication implementation. The
OpenBot One shell and the server still need a complete native login flow.

The shared layout uses CSS safe areas and the visual viewport for the keyboard.
It keeps pinch zoom available and never clears focus on resize. Dialogs and
side sheets use the same visible height as the chat. An optional `onBackPress`
runtime action lets Android close the last open dialog or sheet first. The
shell handles history and root exit when no shared surface consumes Back.

An optional `onAppStateChange` reports mobile activity changes. Live talks end
when the app becomes inactive, the page is hidden, or the chat/organization
changes. Returning to the app never starts a new talk. Pending microphone
grants and worklet setup are canceled; a late grant has its tracks stopped.
The media prompt itself cannot be withdrawn through `getUserMedia`.
