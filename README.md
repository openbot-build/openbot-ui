# OpenBot UI

The MIT web app for [OpenBot](https://github.com/openbot-build/openbot).
It uses Vite, React Router, shadcn/ui, and Effect Atom.

Install `@openbot-build/client` from GitHub Packages. This repository publishes
`@openbot-build/web` with its static build in `dist`.

See the [package setup and release guide](https://openbot.build/docs/contributing#package-releases)
for registry access, first installation, version tags, and commit versions.
Use `devenv shell -- bash scripts/install.sh`, then `devenv shell -- pnpm dev`.
The dev server sends API calls to `OPENBOT_DEV_PUBLIC_ORIGIN` (default `http://localhost`).
Use `devenv shell -- pnpm client:update <version>` to change the client version.

MIT. See [LICENSE](./LICENSE). Installed packages keep their own licenses.
