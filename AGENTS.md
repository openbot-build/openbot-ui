# Rules for OpenBot UI

Run every command as `devenv shell -- <command>`.

This is the MIT web app for OpenBot. Keep it a Vite single-page app with React
Router, shadcn/ui, and Effect Atom. Use shadcn/ui components first.

Import OpenBot through `@openbot-build/client`, including its `/Api` and `/Core`
entries. Install it from GitHub Packages. Use `pnpm client:update <version>`
for a release or `pnpm client:update sha-<full-hash>` for a commit. Change the
client in the OpenBot repository first and publish it before updating this app.
The client bundles its shared schemas and types. The UI package ships `dist`
as static files for OpenBot Cloud.

## Design

This section is the single source for OpenBot web design rules. Change the
rules here. Other repositories link to this section.

- The web front end has no shadows and no borders. Do not use `shadow-*`, `drop-shadow-*`, `border-*`, or `ring-1` as an outline. The theme in `src/styles.css` removes the shadow utilities.
- Make things stand apart with fill color (`bg-card`, `bg-muted`, `bg-input`, `bg-popover`) and space. Dividers are space, not lines.
- The only ring is the focus ring for the keyboard (`focus-visible:ring-*`) and the error ring (`aria-invalid:ring-*`).
- When you add a shadcn/ui component, take out its borders and shadows.
- Size nested corners together: outer radius = inner radius + inset. Use the shared tokens in `src/styles.css`; do not tune the three values separately. Apply this to controls near container corners, not to text or controls in the middle of a surface.
- Menus use `rounded-menu` (18px), an 8px inset, and `rounded-control` (10px) options. Grouped lists use `rounded-group` (26px), an 8px inset, and `rounded-row` (18px) rows. Rows use an 8px inset around 10px controls.
- Form cards and dialogs use `rounded-panel` / `rounded-dialog` (34px), a 24px inset, and `nested-controls`, which gives their buttons and fields 10px corners. Compact action panels use 26px corners and 16px insets. Standalone buttons stay pills. Split buttons inherit the surrounding control radius at their exposed ends.
- All modal dialogs, including search and confirmations, share `dialog-frame`: 672 × 560px, capped to the viewport with 16px clearance on each edge. Never size them by content or add per-page size overrides. Keep headers and footers fixed; use `DialogBody` for scrolling content. Settings tabs and search results must not resize the frame.
- A dialog's 44px round close button sits 12px from the top and side (22 + 12 = 34). A sheet's close button sits 18px from its exposed edges (22 + 18 = 40). The app frame uses 55px corners and a 33px inset for 44px header actions.
- The Composer uses `rounded-composer` (40px). Its 44px buttons sit 18px from the side and bottom. Keep its actions bottom-aligned when tools wrap. Composer text and attachments use a 24px inset; attachment tiles have 16px corners and 24px remove buttons inset by 4px.
- Matched nested surfaces use round arcs, including menus, rows, panels, dialogs, sheets, and the app frame. Other corners keep `corner-shape: superellipse(1.3)`. Do not multiply radius values or use arbitrary radius classes.
- Horizontal segmented controls use a 44px outer capsule, 4px padding, and 36px inner capsules. Vertical lists use 14px outer corners and 10px inner corners with the same 4px inset. Do not shrink scroll areas or clip keyboard focus to force a corner fit.
- The base native corner scale stays available for other content: 5, 8, 10, 14, 18, 22, 26, 34, and 40px. Pills and circles use half their height. Default buttons are 44px high; large buttons are 50px high.
- Use the 15 Material 3 baseline type roles in `src/styles.css`, including their size, line height, weight, and letter spacing. Use `text-body-large` for input and chat text, `text-body-medium` for supporting text, `text-label-large` for buttons, `text-title-large` for page and card titles, and `text-headline-small` for dialog titles. Use smaller label roles only for short metadata. Do not add arbitrary font sizes.
- Type reference: https://m3.material.io/styles/typography/type-scale-tokens.
- The fonts are DM Sans (`font-sans`, also for headings) and DM Mono (`font-mono`).

- OpenBot is for everyday life, learning, creativity, and work. Use broad examples and plain text Bot names. Do not add Bot faces, mascots, avatars, or pictorial logos. The sidebar lists Bots; history and account tools stay secondary.

- For a few fixed settings such as theme, show choices inline. Select menus open beside the trigger with an 8px gap; do not align the selected item over the trigger. Floating menus use `bg-menu` so they remain distinct from dialogs without borders or shadows.

- Let layout and controls explain the interface. Do not add suggestion cards, slogans, or small explanatory copy. Keep labels, error messages, and information needed to make a decision.

## Language

- Write all text in [Simple English](https://en.wikipedia.org/wiki/Simple_English). This covers docs, comments, error messages, logs, test names, and commit messages.

## License

Use MIT for this project. Keep third-party copyright and license notices.
The bundled client has its own MIT grant. Other OpenBot packages keep AGPL.

## Checks

Before you finish, run `pnpm build`, `pnpm typecheck`, and `pnpm test`.
