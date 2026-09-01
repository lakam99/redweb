# Upgrade an existing Redweb application

Match the installed package to its versioned documentation. Redweb 0.13.0 contains the capabilities described by the 0.13.0 guides; a later development checkout may not match that release. See [release verification](RELEASE_TRUST.md) and the changelog shipped with your selected package. Keep your lockfile and rollback artifact, and run your own real HTTP/WebSocket/browser tests after upgrading.

## 0.8 migration notes

- Unmatched WebSocket paths are rejected unless `fallbackToRoot: true` is configured.
- Handler exception details are hidden unless `exposeErrors: true` is configured. Do not expose private exception messages in production.
- Shutting down a WebSocket server no longer closes a caller-supplied HTTP/HTTPS server by default. Explicitly set `closeServerOnShutdown: true` only when handing cleanup responsibility to that socket server.
- `bind` is honored by HTTP, HTTPS, WebSocket, and secure WebSocket listeners.
- `shutdown()` is asynchronous; await it when deterministic cleanup matters. Awaiting a shutdown is not a delivery or persistence guarantee.

## 0.9 migration notes

- No migration is required when the new multiplayer options are disabled.
- Production controls are route-local and opt-in; size them from measured capacity rather than copying example limits.
- `ProtocolClient` is available from `redweb/client` for negotiated protocol routes without adding runtime dependencies. It wraps a transport; your application creates and reconnects that transport.
- Node.js 18 is the installation/legacy-compatibility floor, not a recommendation to deploy an end-of-life runtime. Use a maintained LTS release with current security patches; check [runtime compatibility](RELEASE_TRUST.md).

## Live HTML migration

The executable `.htmx` sandbox and `enableHtmxRendering` option were replaced. Templates are ordinary `.html` files registered through decorated plain classes. Move calculations and imports into the page class, mark reactive fields with `@state()`, expose browser-callable methods with `@action()`, and start the page with `start(PageClass)`.

For server-rendered TSX, extend `redweb/tsconfig.json`; do not configure React's JSX runtime. `redweb init --existing` creates a missing root configuration without overwriting one you already have. Check the effective configuration with your installed CLI: `npx --no-install redweb doctor --json`. Review warnings and fix errors before compiling; preservation does not imply correctness.

In the reactive-rendering candidate, ordinary TSX expressions reading decorated state update after assignment. Replace arrays/objects instead of mutating them in place. Use stable JSX keys for lists. Existing explicit HTML bindings remain supported. See [rendering and lifecycle](LIVE_HTML.md) for owner isolation, component lifetimes and reconnect behavior, and [runtime diagnostics](RUNTIME_DIAGNOSTICS.md) for failure categories and retry limits.

Shared page state is process-local, not durable or automatically private. Add explicit identity, authorization and persistence for your application. The [private dashboard recipe](../recipes/dashboard/README.md) demonstrates one single-process implementation; it is not a distributed session store.
