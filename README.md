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
