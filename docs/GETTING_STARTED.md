# Build a site and its realtime backend together

Redweb renders TypeScript/TSX on Node.js and connects server-owned state and actions to the browser through WebSockets. Use it for live dashboards, chat, collaboration, documentation sites, and socket services. You can use HTTP or WebSockets independently.

It is not React, a browser component framework, a database, an identity provider, or a managed multiplayer platform. Do not use React hooks or import `react/jsx-runtime`. An edge-only host without Node listeners cannot run a live Redweb server; exported static pages need no Node runtime.

## Start with a complete recipe

Choose one of these complete applications:

- [Realtime counter](../recipes/realtime/README.md): the smallest live website, sharing server-owned state between visitors.
- [Chatroom](../recipes/chat/README.md): reusable stateful components, messages, and live presence.
- [Site](../recipes/site/README.md): non-live pages with a shared layout and stylesheet.
- [Socket service](../recipes/socket/README.md): a typed `/match` route with separate join/move/resume handlers.
- [HTTP and WebSockets](../recipes/http-ws/README.md): one listener, an HTTP health endpoint and a raw `/chat` route with an explicit cleanup owner.
- [Private dashboard](../recipes/dashboard/README.md): persistent SQLite cards, account sessions and private live updates (Node 22.13+).

Each generated recipe page contains its exact files, commands, limitations, and real HTTP/WebSocket acceptance tests. Follow that recipe's version-specific setup instructions rather than mixing an unreleased example with a published npm version.

Requirements: Node.js satisfying the package's `engines` field and npm. Use a supported Node.js release in production. TypeScript and the development watcher are installed by the starter. No React, frontend bundler or broker is required. Only the dashboard starter uses a database; its native SQLite requirement is recipe-local.

The installation floor is not a security-support promise for old Node releases. See [runtime compatibility, release verification and provenance](RELEASE_TRUST.md) before choosing a production version.

## One development loop

After initialization and installation, `npm test` compiles the project, copies assets, and runs the shipped network tests. `npm run dev` watches source/configuration files, rebuilds, and restarts. Served HTML pages on direct localhost access refresh when the replacement server is ready; detected edits instead produce a confirmation notice that keeps the current document until explicit reload. This is not autosave or browser hot-module replacement; in-memory state and old socket sessions reset on restart. See [development refresh and its guarantees](DEVELOPMENT.md#browser-refresh).

Use `.tsx` for markup and extend `redweb/tsconfig.json`. Colocate CSS with the decorated page/component or declare an explicit asset root. `npm run build` prepares `dist/`; `npm start` runs that compiled application.

When setup fails, run `npx --no-install redweb doctor --json` from the application directory. Fix reported errors and examine unresolved warnings, then rerun the build and real tests. Doctor does not execute application code or prove application correctness. See [diagnostics and boundaries](CLI.md).

## The mental model

- A page is a decorated class. Its `render()` returns server-side TSX.
- State is server-owned data. An ordinary TSX expression reading `@state()` updates automatically when that property is assigned. Replace arrays/objects rather than mutating them in place.
- Only decorated actions are browser-callable. Validate and authorize every untrusted input; hiding a button is not access control.
- A class component owns reusable state/actions and has its own update boundary. Function components are convenient presentation helpers.
- Pages are connection-scoped by default. `shared: true` intentionally shares one page instance; do not put private visitor data there.
- Shared in-memory state survives visitors and reloads, not server restarts. Durable cards/history require application-owned persistence. Multiple processes do not automatically share memory.
- Socket URLs select routes; message `type` selects a handler. Do not add a second `message.action` dispatcher inside a catch-all handler.

See [rendering and lifecycle](LIVE_HTML.md) and [shared socket contracts](SOCKET_CONTRACTS.md) for exact semantics.

For private raw socket subscriptions, see [room authorization and shared request identity](ROOM_AUTHORIZATION.md). Keep authentication, subscription permission, and application-specific write permission explicit.

## Deploy deliberately

Build first. Deploy `dist/`, the package manifest, and the lockfile, then install runtime dependencies with `npm ci --omit=dev`. The starters are tested with `src/` unavailable after compilation. Configure HTTPS/WSS and a proxy that supports WebSocket upgrades when using a reverse proxy.

These deployment commands require a verified release pair. `redweb@0.13.2` installs published `redweb-client@0.2.0` automatically through its dependency. Future unreleased Redweb changes require their matching tested tarball until a release containing them is published. The `npm link` workflow is local development only: a clean production install does not preserve that link.

Before public access, add authentication, authorization, trusted-origin policy, input/rate limits, application persistence where needed, and bounded shutdown. Treat reconnect/session tokens as credentials. Do not promise exactly-once delivery or durable sessions from an in-memory starter. See [operations](MULTIPLAYER_OPERATIONS.md) and [guarantees and limits](PRODUCTION_READINESS.md).

## Evidence and compatibility

Complete recipe files are executable applications; shorter API snippets explain individual methods and may require surrounding application code. Type-check and test a complete recipe before adapting it. The package verifier runs the documented recipe files against an extracted tarball and actual listeners, not mocks.

Coverage reports refer to instrumented library code. They do not prove exhaustive browser behavior, application security, all generated-example branches, or production capacity. Historical [verification evidence](VERIFICATION_EVIDENCE.md) applies only to its recorded revision/environment; consult the [current release checklist](AGENT_READY_ACCEPTANCE.md) for remaining work.
