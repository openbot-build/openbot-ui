# Rules for OpenBot UI

Run every command as `devenv shell -- <command>`.

This is the MIT web app for OpenBot. Keep it a Vite single-page app with React
Router and shadcn/ui. Use the product contracts in `packages/kay-contracts`.
The product gateway in `packages/kay-api` owns presentation data. OpenBot owns
execution, history, permissions, files and model calls.

Import OpenBot through `@openbot-build/client`, including its `/Api` and `/Core`
entries. Keep native SDK use inside `packages/kay-openbot`; only JSON and Web
streams cross that boundary. A local server build may supply a packed client in
`vendor`. Build it from the same server source before updating the app. Released
clients can use `pnpm client:update <version>`.

The UI package ships `dist` and `runtime`. Serve the UI, authentication, `/v1`
and `/api/kay/v1` from one public origin. Keep browser credentials in session
cookies and native credentials in the shell's transport.

## Design

- The shared workspace lives in `src/next`. Its layout, surfaces, motion and
  spacing come from `Shell.css`, `ActivityView.css`, the feature styles and
  `src/styles.css`. Extend those patterns for new screens.
- Keep one shared interface for Web and native shells. Put system calls behind
  `src/lib/runtime.ts`.
- Use the existing shadcn components and semantic color tokens. Keep focus,
  keyboard navigation and reduced motion support.
- Keep mobile navigation, the composer and temporary surfaces inside the visual
  viewport. Test desktop and mobile layouts in a browser.
- Do not add source labels or a second product shell. Previous versions are
  kept outside this package's build for comparison.

## Language

- Write all text in [Simple English](https://en.wikipedia.org/wiki/Simple_English). This covers docs, comments, error messages, logs, test names, and commit messages.

## License

Use MIT for this project. Keep third-party copyright and license notices.
The bundled client has its own MIT grant. Other OpenBot packages keep AGPL.

## Checks

Before you finish, run `pnpm build`, `pnpm typecheck`, and `pnpm test`.
