# OpenBot UI

The MIT web app for [OpenBot](https://github.com/openbot-build/openbot).
Use it with your own OpenBot server or with OpenBot Cloud. It is a single-page
app built with Vite, React Router, shadcn/ui, and Effect Atom.

## Start

Use Node.js 26 and pnpm 9.15.9, or use the included devenv shell.

```sh
devenv shell -- pnpm install --frozen-lockfile
devenv shell -- pnpm dev
```

Open http://localhost:5173. The dev server sends `/v1`, `/auth`, and `/health`
to the OpenBot server at http://localhost, including WebSockets. To use another
server, set `OPENBOT_DEV_PUBLIC_ORIGIN` when you start Vite:

```sh
devenv shell -- env OPENBOT_DEV_PUBLIC_ORIGIN=http://localhost:8080 pnpm dev
```

Use the public origin of the server. OpenBot checks this origin on writes and
WebSockets. The test sign-in button needs a server in development mode.

## Check and build

```sh
devenv shell -- pnpm build
devenv shell -- pnpm typecheck
devenv shell -- pnpm test
```

`dist` holds static files. Serve them on the same origin as the OpenBot server.
Send API and auth paths to the server. Send other paths that are not files to
`index.html`. `pnpm preview` serves the build for a local preview; it does not
start or proxy an OpenBot server.

## Client

The app uses only `@openbot-build/client` for OpenBot imports. Its `/Api` entry
exports the API contract; `/Core` exports the chat schemas. The client bundles
its OpenBot dependencies and their types under MIT. The other OpenBot packages
keep their own licenses.

Until the client is on npm, `vendor` holds its installable package. A fresh clone
needs no OpenBot source checkout to build. `vendor/client.json` records the
source commit and checksum. The package includes its license and source maps.

For local work, keep `openbot`, `openbot-ui`, and `openbot-cloud` next to each
other. After a client change, rebuild the bundled client and update this app:

```sh
devenv shell -- bash scripts/update-client.sh ../openbot
```

## Layout

- `src/pages`: pages and routes.
- `src/components/ui`: shadcn/ui components.
- `src/components/app`: app components.
- `src/atoms`: shared state and API calls with Effect Atom.
- `test`: chat and execution tests.

## License

MIT. See [LICENSE](./LICENSE). Third-party packages keep their own licenses.
The Effect patch changes MIT-licensed Effect code. Its copyright notice is in
[patches/LICENSE.effect](./patches/LICENSE.effect).
