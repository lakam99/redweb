# Redweb

Build a TypeScript website and its realtime backend together. Decorated classes own state and actions; server-rendered JSX updates the browser through WebSockets. No React, frontend bundler, or separate socket glue is required.

Use the same package for a live site, static HTML, Express HTTP endpoints, or routed WebSocket services.

## Install

Start with a complete, tested counter application:

<!-- redweb:setup:start -->
> Unreleased development documentation. Package metadata is 0.12.0, but these features are not claimed to be published in that npm version. Use the matching packed artifact; do not install latest and assume compatibility.

These instructions require an absolute path to the matching tarball, produced by `npm pack` from this checkout. Replace `TARBALL` below with that path (quoted if it contains spaces). This is an explicit prerequisite, not an npm package name. Both commands must use the same tarball.

```sh
npx --yes --package TARBALL redweb init my-realtime --template realtime
cd my-realtime
npm install --save-exact TARBALL
npm test
npm run dev
```
<!-- redweb:setup:end -->

Open two tabs at `http://localhost:8181`. Clicking either button changes the counter on the server and updates both tabs.

This is the starter's exact `src/app.tsx`. The initializer also supplies its stylesheet, compiler configuration, shutdown helper, and real-network tests; the file is not a standalone copy-and-run program.

<!-- redweb:realtime:start -->
```tsx
import { action, page, start, state, type LiveHtmlStartOptions } from 'redweb';
import { runApp } from './run-app';

@page('/', { css: 'app.css', shared: true })
export class CounterPage {
    @state() count = 0;

    @action()
    increment() { this.count += 1; }

    render() {
        return (
            <main class="home">
                <h1>A counter owned by the server</h1>
                <p>Open this page in two tabs. Either button updates both.</p>
                <button rw-click="increment">
                    Count <output>{this.count}</output>
                </button>
            </main>
        );
    }
}

export function createApp(options: LiveHtmlStartOptions = {}) {
    return start(CounterPage, { port: Number(process.env.PORT ?? 8181), templateRoot: __dirname, ...options });
}

if (require.main === module) runApp(createApp);
```
<!-- redweb:realtime:end -->

## Choose what to build

The links below describe each starter and its boundaries. Reuse the version-correct setup above, changing both the directory name and `--template realtime` to your chosen template. Every initialized project includes all application files and real tests; complete generated recipe pages and file contents are also available in the [documentation catalogue](docs/generated.json).

| Build | Starter | Recipe notes |
| --- | --- | --- |
| Live site with server-owned state | `realtime` | [Counter](recipes/realtime/README.md) |
| Chatroom with reusable components and presence | `chat` | [Chat](recipes/chat/README.md) |
| Non-live pages with shared layout and CSS | `site` | [Site](recipes/site/README.md) |
| Typed `/match` route with join/move/resume handlers | `socket` | [Socket service](recipes/socket/README.md) |
| Account-private cards with persistent SQLite data | `dashboard` | [Dashboard](recipes/dashboard/README.md), Node 22.13+ |
| HTTP and raw WebSockets on one port | `http-ws` | [Shared listener](recipes/http-ws/README.md) |

Choose the recipe's `--template` option when initializing. Shared memory survives visitors, not server restarts. The dashboard demonstrates application-owned persistence and identity; it is single-process, not a managed database or authentication service.

## Live HTML

- A page is a decorated class whose `render()` returns server-side TSX.
- Ordinary expressions over `@state()` update after assignment. Replace arrays/objects rather than mutating them in place.
- `@action()` explicitly exposes a method to the browser. Validate inputs and authorize the operation on the server.
- Function components reuse presentation; decorated class components reuse state, actions, and lifecycle.
- Stable JSX keys preserve DOM identity for lists. CSS lives in ordinary external files.
- Pages are connection-scoped by default. `shared: true` deliberately shares one instance: do not put private visitor data there.

TSX and `html` templates escape text and attribute values and restrict URL protocols. Use external assets instead of inline executable markup. Ordinary `.html` templates remain available; the old executable `.htmx` sandbox does not.

See [pages, components, forms, CSS and rendering](docs/LIVE_HTML.md), [private rooms and request identity](docs/ROOM_AUTHORIZATION.md), and [runtime failures and retry limits](docs/RUNTIME_DIAGNOSTICS.md).

## HTTP servers (Express)

Use `HttpServer` for Express services and `HttpsServer` when Node terminates TLS. HTTP and WebSockets can run independently; the example below combines them on one listener.

## WebSocket servers

The `http-ws` starter answers `GET /health` and accepts `{"type":"hello"}` at `ws://127.0.0.1:8181/chat`, using the same port. A URL selects a route; a message's `type` selects its handler. No secondary `message.action` dispatcher is needed.

<!-- redweb:http-ws:start -->
```tsx
import { BaseHandler, HttpServer, METHODS, SocketRoute, SocketServer, type RedWebSocket, type SocketServerOptions } from 'redweb';
import { runApp } from './run-app';

export class Hello extends BaseHandler {
    constructor() { super('hello'); }

    onMessage(socket: RedWebSocket) {
        socket.sendJson({ type: 'hello', message: 'Hello from the server!' });
    }
}

export class ChatRoute extends SocketRoute {
    constructor() {
        super({ path: '/chat', handlers: [Hello], allowDuplicateConnections: true });
    }
}

export function createApp(options: Pick<SocketServerOptions, 'port' | 'bind' | 'logger'> = {}) {
    const http = new HttpServer({
        listen: false,
        publicPaths: [],
        services: [{ serviceName: '/health', method: METHODS.GET, function: (_req, res) => res.json({ ok: true }) }],
    });

    return new SocketServer({
        port: options.port ?? Number(process.env.PORT ?? 8181),
        bind: options.bind ?? '127.0.0.1',
        logger: options.logger,
        server: http.server,
        routes: [ChatRoute],
        listen: true,
        closeServerOnShutdown: true, // One owner closes routes and the shared HTTP listener.
    });
}

if (require.main === module) runApp(createApp);
```
<!-- redweb:http-ws:end -->

Follow the [shared-listener notes](recipes/http-ws/README.md) and initialize with `--template http-ws` using the matching artifact above. The socket service explicitly owns cleanup of the supplied HTTP listener. `/health` reports liveness, not readiness. This demonstrates raw JSON messages, not a chatroom UI.

For validated, inferred client/server payloads, use [shared socket contracts](docs/SOCKET_CONTRACTS.md). The client wraps your transport; it does not create or reconnect one for you.

## One development loop

After installing the matching package:

```sh
npm test
npm run dev
```

Tests compile the application and use real HTTP/WebSocket listeners. Development watches source, CSS, HTML, and root TypeScript configuration, then rebuilds/restarts. Local HTML pages refresh; detected edits require confirmation before reload. This is not autosave or state-preserving hot-module replacement. See [development refresh and inspection](docs/DEVELOPMENT.md).

Build with `npm run build`, then run compiled output with `npm start`. Production ships `dist/`, the manifest, and lockfile, with runtime dependencies installed through `npm ci --omit=dev`; it does not need `src/` or TypeScript.

## Add to an existing project

Use the installed CLI so the tool and application agree:

```sh
npx --no-install redweb init --existing --dry-run --json
npx --no-install redweb doctor --json
npx --no-install redweb add page dashboard --dry-run --json
```

Remove `--dry-run` to create missing files. Existing configuration/source is never overwritten. Incremental generation reports imports, registration steps and isolated tests; it does not rewrite startup or silently repair your project. See [CLI prerequisites, commands and limitations](docs/CLI.md).

## Fit and production boundaries

Good fit: Node-hosted live dashboards, chat, collaboration, server-rendered sites and multiplayer socket endpoints. Static HTML export is a separate deployment mode.

Choose something else when you need React compatibility, browser-side components, an edge-only runtime without Node listeners, or managed authentication/database/matchmaking infrastructure.

Before public deployment, configure HTTPS/WSS, trusted origins, identity, authorization, resource limits and application persistence. Reconnect is not exactly-once delivery; multiple processes do not automatically share state. See [operations](docs/MULTIPLAYER_OPERATIONS.md), [guarantees and limits](docs/PRODUCTION_READINESS.md), and [runtime compatibility and release verification](docs/RELEASE_TRUST.md).

## Exports

See the [public TypeScript API](index.d.ts), [complete documentation catalogue](docs/generated.json), and [getting-started guide](docs/GETTING_STARTED.md). The catalogue includes version-labelled Markdown and executable recipes. An [optional read-only MCP adapter](docs/AGENT_ACCESS.md) serves the same source without adding SDK dependencies to your application; it is currently private/unpublished.

## Defaults and lifecycle

HTTP defaults to port 80; sockets default to 3000. Generated applications explicitly select 8181. Supplied socket listeners are neither started nor closed unless the corresponding options explicitly transfer that responsibility. Await `shutdown()`; forced transport closure does not guarantee completed application work.

See [production ownership and lifecycle](docs/PRODUCTION_READINESS.md).

## 0.8 migration notes

See [strict paths, sanitized errors and borrowed-listener ownership](docs/MIGRATION.md#08-migration-notes).

## 0.9 migration notes

See [opt-in multiplayer controls and protocol clients](docs/MIGRATION.md#09-migration-notes).

## Live HTML migration

See [replacing the executable HTMX sandbox and configuring TSX](docs/MIGRATION.md#live-html-migration).

## Developing

Run `npm test` for unit tests, actual HTTP/HTTPS/WS/WSS integration tests, type checks and enforced 100% instrumented-library statement/branch/function/line coverage. Browser, package, performance and tool verification have separate gates; this is not a claim of exhaustive repository or application coverage.

Run `npm run verify:cli` to test the actual initializer, doctor and incremental-add commands and enforce 100% coverage of the shipped CLI entrypoint across subprocesses. This complements, rather than replaces, the library's CLI implementation coverage.

Edit canonical recipes/guides, then run `npm run generate:docs`; do not maintain independent copies of the examples. See [documentation maintenance](docs/DOCUMENTATION.md) and the [full acceptance checklist](docs/AGENT_READY_ACCEPTANCE.md) for verification evidence and remaining release work.
