# Render JSX without React

Build a two-page TypeScript site with shared navigation, a stylesheet and per-page metadata. JSX is a markup syntax here: Redweb renders it on Node.js, without React hooks, hydration, or a browser component runtime. This is useful for documentation, content sites and server-rendered pages that do not need browser-side component execution.

## Explain it like I'm five

The page class is a recipe and the server is the kitchen. `render()` prepares HTML before it reaches the browser. A shared layout adds the same navigation around each page, like putting different meals on the same kind of plate. The browser receives the finished document, not the kitchen.

## Follow the design

1. The initializer supplies `redweb/tsconfig.json` inheritance, TypeScript and asset copying. Keep the file as `.tsx`; do not point its JSX settings at `react/jsx-runtime`.
2. `defineSite()` supplies one layout and CSS declaration. Its page decorators register `/` and `/about`, with metadata beside each page.
3. Each `render()` returns ordinary TSX. Function components can share presentation; page-specific data remains in your server code. Text and attribute values are escaped, and URL protocols are restricted.
4. `defineApp({ pages: [HomePage, AboutPage] })` combines both pages on one listener. `app.run()` owns startup and bounded shutdown; importing the definition starts nothing.

Keep CSS in external files. The [rendering reference](../LIVE_HTML.md) covers components, templates, assets and static export. For interactive pages, start from the [realtime counter](../../recipes/realtime/README.md): assignments to decorated state update the browser through Redweb's runtime. Non-live site pages do not acquire that behavior just because their markup is JSX.

## The page code

After initializing the site recipe below, this is a minimal replacement for `src/app.tsx`:

<!-- source: docs/snippets/site.tsx -->

Save this stylesheet beside it as `src/site.css`; the starter copies it beside the compiled page:

<!-- source: docs/snippets/site.css -->

`app.run()` returns a Promise. Await it when surrounding startup depends on completion; top-level `await` requires ESM. The direct call above works with the initializer's CommonJS configuration too. Ports, environment settings and test-import guards belong in the complete recipe, not in the first page example.

## Check that it works

Open `http://localhost:8181/`, follow About, and confirm the navigation and styling stay consistent while the title and content change. View the response source: it is server-rendered HTML, not an empty mount point. The [shipped test](../../recipes/site/app.test.cjs) checks actual HTTP responses, both pages, CSS and absence of the live-page runtime. The package gate repeats it with the source directory unavailable.

`npm run build` produces compiled code and copied assets; `npm start` serves that output. `site.export()` is a separate static-export workflow, not what the starter's default build does. Static export cannot replace protected or live application requests.

## When to choose another approach

Redweb TSX is not React-compatible. Do not import React components or expect hooks, client effects, browser rendering or automatic support for browser-only libraries. Choose an appropriate browser framework when those are core requirements. Live Redweb applications require a Node host with long-lived listeners; exported static files have a different deployment model. See [compatibility and release verification](../RELEASE_TRUST.md).
