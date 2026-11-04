# OpenBot UI

The shared OpenBot web app uses React, Vite, React Router and shadcn/ui. The same
workspace serves Web and native shells. The product gateway calls OpenBot through
a bundled SDK; OpenBot remains the only execution and history store.

## Local development

Run a matching OpenBot development server first. The default API origin is
`http://localhost:3000`. It needs PostgreSQL and object storage. Its development
models return fixed answers and tool calls without a model account.

From this folder:

```sh
devenv shell -- pnpm install --frozen-lockfile
devenv shell -- pnpm build
```

Copy `.env.example` to the ignored `.env.development`. Set the product database
URL and the OpenBot organization ID from `/auth/session`. Use a separate product
database for preferences and presentation data. Set `KAY_INTERNAL_TOKEN` to a
random value with at least 32 characters. Set both services’ public origin to `http://localhost:5180`. The local Vite proxy supplies that origin for cookie-authenticated calls.

Apply the product migrations and start the gateway in one terminal:

```sh
devenv shell -- pnpm gateway:migrate
devenv shell -- pnpm gateway:start
```

Start the web app in another terminal:

```sh
devenv shell -- pnpm dev
```

Open `http://localhost:5180`. Choose **Sign in**, then **Use the local test
account** when using the OpenBot development server. That button is absent from
production builds. Ordinary sign-in uses `/auth/sign-in`.

For a production host, serve `dist` as static files, route `/api/kay` to the
product gateway, route `/auth` and `/v1` to OpenBot, and fall back to `index.html`
for client routes. All services must use the same public origin. Keep the product
server and database private. Supply model, file-storage, voice and computer
providers on the server when those capabilities are needed.

## Checks

```sh
devenv shell -- pnpm build
devenv shell -- pnpm typecheck
devenv shell -- pnpm test
devenv shell -- pnpm --filter @kaicom/kay-contracts test
devenv shell -- pnpm --filter @kaicom/kay-openbot test
devenv shell -- pnpm --filter @kaicom/kay-api test
```

## Native shells

Install `@openbot-build/web/runtime` before the UI entry. `NativeRuntime` supplies
the API origin, Fetch-compatible transport, sign-in, sign-out, clipboard, external
links and WebSockets. Keep credentials in the native process. Preserve streaming
and cancellation. The service origin must expose both `/v1` and `/api/kay/v1`.

The static build contains `openbot-runtime.json` and dependency license notices.
Ship them with the assets. The browser entry uses its ordinary session cookie;
it does not need a native adapter.

The shared app also keeps native service recovery, namespaced appearance,
viewport updates, Back button dismissal, clipboard writes and voice cleanup when
the app becomes inactive. A native service address must serve the product gateway
as well as the OpenBot API.

## Comparison workspace

The previous app is kept outside this build at `../reference/previous-openbot-ui`.
Its source and local edits were also saved before the migration. The running
comparison has a small client schema update to read independent conversations;
it keeps its original interface. To run it from this app's environment:

```sh
devenv shell -- bash -c 'cd ../reference/previous-openbot-ui; OPENBOT_DEV_PUBLIC_ORIGIN=http://localhost:5180 OPENBOT_DEV_API_ORIGIN=http://127.0.0.1:3000 pnpm exec vite --port 5181 --strictPort'
```

Open `http://localhost:5181`. Both apps use the same local session and backend.
Keep the backend public origin at `http://localhost:5180` for both proxy targets.

MIT. See [LICENSE](./LICENSE). Dependencies keep their own terms.
