# Rules for OpenBot UI

Run every command as `devenv shell -- <command>`.

This is the MIT web app for OpenBot. Keep it a Vite single-page app with React
Router, shadcn/ui, and Effect Atom. Use shadcn/ui components first.

Import OpenBot through `@openbot-build/client`, including its `/Api` and `/Core`
entries. Change the client in the OpenBot repository first, then run
`scripts/update-client.sh`. Keep the shared schemas in their current packages;
the client bundles them at build time.

## Design

- The web front end has no shadows and no borders. Do not use `shadow-*`, `drop-shadow-*`, `border-*`, or `ring-1` as an outline. The theme in `src/styles.css` removes the shadow utilities.
- Make things stand apart with fill color (`bg-card`, `bg-muted`, `bg-input`, `bg-popover`) and space. Dividers are space, not lines.
- The only ring is the focus ring for the keyboard (`focus-visible:ring-*`) and the error ring (`aria-invalid:ring-*`).
- When you add a shadcn/ui component, take out its borders and shadows.
- Corners are as round as an iPhone screen. Big surfaces (Card, dialogs, the Composer, RequestCard, TodoList, Empty) use `rounded-screen` (55px). Controls are pills (`rounded-full`). Menus, tooltips, list rows, code and text boxes use the smaller steps in `styles.css`.
- Corners are continuous, as on an iPhone: `styles.css` draws every rounded corner with `corner-shape: superellipse(1.3)` and makes it 1.19 times longer, so it is as deep as the round corner of the same size. Pills (`rounded-full`) keep round ends. Browsers without `corner-shape` draw round corners. Use the `rounded-*` scale, not a fixed `rounded-[…]` size, so a corner gets this too.
- A `rounded-screen` box must be at least 131px high and wide, or the browser makes its corners smaller. Give a box that can be shorter `rounded-full`, or the least size `min-h-(--corner-room)`.
- Corners must look in harmony. A round control in a `rounded-screen` corner is concentric with it: a 36px control sits `p-(--corner-inset)` (37px) from both edges. So the buttons in the corners of a dialog or a RequestCard are 36px high, and a title next to such a button is centered on it. A box inside another box gets about the outer corner minus the space between them. Keep padding at least 0.3 × the corner, so text does not run into the curve.
- The fonts are DM Sans (`font-sans`, also for headings) and DM Mono (`font-mono`).
- Keep the design in sync with OpenBot Cloud.

## Language

- Write all text in [Simple English](https://en.wikipedia.org/wiki/Simple_English). This covers docs, comments, error messages, logs, test names, and commit messages.

## License

Use MIT for this project. Keep third-party copyright and license notices.
The bundled client has its own MIT grant. Other OpenBot packages keep AGPL.

## Checks

Before you finish, run `pnpm build`, `pnpm typecheck`, and `pnpm test`.
