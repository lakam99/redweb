# Redweb

Build a TypeScript website and its realtime backend together. Decorated classes own state and actions; server-rendered JSX updates the browser through WebSockets. No React, frontend bundler, or separate socket glue is required.

Use the same package for a live site, static HTML, Express HTTP endpoints, or routed WebSocket services.

## Install

Start with a complete, tested counter application:

<!-- redweb:setup:start -->
> Unreleased development documentation. Package metadata is 0.12.0, but these features are not claimed to be published in that npm version. Use the matching Redweb tarball described in the recipe setup; its published client dependency installs automatically. Do not install latest and assume compatibility.

Replace `TARBALL` with the absolute path to the matching Redweb tarball produced by `npm pack` (quoted if it contains spaces). This is an explicit prerequisite, not an npm package name. Both commands must use the same tarball. The published redweb-client dependency installs automatically; no separate client checkout or linking is required:

```sh
npx --yes --package TARBALL redweb init my-realtime --template realtime
cd my-realtime
npm install --save-exact TARBALL
npm test
npm run dev
```

This prerelease Redweb artifact is development-only until its release checks finish. For released applications, use an available versioned release guide.
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

`npm run verify:load` checks the default 32-client/3,200-message workload, p99 latency, throughput and slow-client containment. Its separate `npm run verify:load:coverage` gate combines unit failure tests with real malformed-message, disconnect and timeout integration tests and enforces all-four 100% coverage of the load policy, coordinator, traffic driver and shared socket helper. Coverage runs do not replace clean performance measurements. See the [scope audit](docs/COVERAGE_SCOPE_AUDIT.md) for exact evidence and remaining gaps.

Run `npm run verify:cli` to test the actual initializer, doctor and incremental-add commands and enforce 100% coverage of the shipped CLI entrypoint across subprocesses. This complements, rather than replaces, the library's CLI implementation coverage.

`npm run verify:package:examples:coverage` checks the packed counter without optional development dependencies, chat with explicit Zod, and generated TypeScript additions in a real installed consumer. Unit and real-socket failure tests require all-four 100% coverage of the three verifier modules. See [packaged-example evidence](docs/PACKAGED_EXAMPLE_VERIFICATION.md); this complements the full browser/package gate.

`npm run verify:action:coverage` checks the source-free typed action consumer in both decorator modes, plus real failed upgrades/responses and unit cleanup failures. It requires all-four 100% of the action-input verifier without enlarging the library coverage scope.

`npm run verify:reports:coverage` checks that failed starter commands retain available raw reports without overwriting or merging prior evidence. It combines unit faults with real child processes/filesystem checks and requires all-four 100% of the shared retention helper.

`npm run verify:starter-coordinators:coverage` checks both starter coverage runners and their shared final-report handling at all-four 100%. Real compiler/test runs prove changed inputs are rejected; filesystem failures cannot turn a failed command into success. See [starter verification](docs/STARTER_COORDINATOR_VERIFICATION.md) for the exact scope and unit/integration boundaries.

`npm run verify:starters:lifecycle` requires a nonempty, complete report for the deployed lifecycle helper. Its separate `npm run verify:starters:lifecycle:coverage` command covers the verifier itself. See [lifecycle evidence](docs/STARTER_LIFECYCLE_VERIFICATION.md) for the emitted-JavaScript scope and temporary source-map metadata removal.

`npm run verify:package:browser:coverage` covers the shared browser page owner and packed-browser verifier at all-four 100%, combining explicit failure units with actual Chromium counter/chat integration. Late page openings and cleanup failures retain uncertain workspaces. See [browser ownership evidence](docs/BROWSER_OWNER_VERIFICATION.md) for the checkout/package distinction and exact scope.

Browser and authored-source coverage share strict source-map and execution-counter validation. Malformed reports are rejected before merging; see [coverage validation evidence](docs/COVERAGE_COUNTER_VALIDATION.md) for the unit and real-browser checks.

Feedback and development-refresh verification share bounded browser commands so a disconnected debugging socket reaches cleanup. [Native failure evidence](docs/FEEDBACK_COMMAND_VERIFICATION.md) records the fixes, exact coverage scopes using actual Chromium/server cases, and the remaining acquisition boundary.

Development-refresh checks retain uncertain browser-launch cleanup and preserve shutdown failures. [Verification boundaries](docs/BROWSER_OWNER_VERIFICATION.md#development-refresh-launch-cleanup-follow-up) distinguish these fault tests from real generated-app/browser acceptance.

`npm run verify:live-html:load` checks 200 expired renders, 110 connected clients, presence/broadcast delivery and heap growth after client closure/session expiry, before server shutdown. Its separate `verify:live-html:load:coverage` command tests the verifier's HTTP/socket ownership, malformed responses, real timeouts and failure handling with unit and native integration tests. It requires all-four 100% coverage of the three verifier modules; instrumented tests do not replace clean memory measurements.

`npm run verify:jsx:performance` renders 10,000 component rows and validates their complete markup outside the timed render. CI supervises the command externally; the five-second performance limit cannot itself interrupt synchronous code. `npm run verify:jsx:coverage` separately checks malformed output, measurement limits and the actual CLI, requiring all-four 100% coverage of this verifier.

`npm run verify:soak` checks exact per-connection replies, rotation, disconnects and resource trends. It rejects undersampled runs and reports missing replies explicitly; the existing 99% delivery allowance is not a lossless guarantee. Final heap is sampled after client closure/expiry, before server shutdown. `npm run verify:soak:coverage` separately requires all-four 100% coverage of the verifier, policy and socket owner using unit and real-network/process tests. A short test run does not certify the default one-hour workload.

`npm run verify:overhead -- <baseline-directory>` compares disabled-feature socket throughput and p99 latency against a separately prepared baseline. Both sides must complete every warm-up and measured exchange with valid, unique reply IDs; malformed output, timeouts and cleanup failures fail the check. The limits remain 3% throughput regression and 5% p99 regression. `npm run verify:overhead:coverage` separately enforces all-four 100% coverage of the six benchmark modules through unit and real-socket/process tests. See [benchmark evidence and limitations](docs/BENCHMARK_VERIFICATION.md); a coverage pass is not a performance pass.

Run `npm run verify:recovery:server` from this source checkout for the blocking CI recovery contract: 7,400 exact exchanges with a separately measured server, empty registries, normal worker exits and every storm within 110% of warmed server heap. The original `npm run verify:recovery` retains its unchanged exit status as a visible non-blocking CI diagnostic; its historical failures are not resolved by this measurement change. CI preserves both results and logs. See the [reviewed recovery contract and evidence](docs/SERVER_RECOVERY_CANDIDATE.md).

`npm run verify:recovery:coverage` separately enforces all-four 100% coverage of that gate's policy, coordinator and CLI entrypoint. It combines unit boundary tests with actual worker/socket integration. The instrumented behavioral run is not used as a clean heap measurement; the normal server recovery command remains separate.

Run `npm run verify:recovery:diagnostics` for native-source 100% coverage of the two private heap-analysis tools, including their real command-line entrypoints. It reuses the graph unit cases under Node's test runner to avoid merging Jest-transformed and original source ranges. Parser fixtures and real file/subprocess checks cover graph bounds, shared references, redaction, and malformed input; the separate recovery integration suite also checks actual V8 snapshots and a real server-held object. This gate does not cover the recovery workload verifier itself or waive its failed memory budget.

Run `npm run verify:package:tools` for a separate 100% coverage gate over the managed subprocess owner, failure normalizer, and starter/Markdown application verifiers. Tests use actual npm/native commands, descendants, files and generated applications. Use Node 22.13+ to exercise all six recipes, including the SQLite dashboard. Package packing/extraction and consumer checks use the same bounded owner; uncertain cleanup fails verification and retains its workspace. This is a scoped tool gate, verified on Windows, not coverage of every verification script or proof of cross-platform execution; Windows file-lock cases are skipped elsewhere.

Every generated starter also has `npm run test:coverage`: real application tests with coverage mapped to its TypeScript, separate from library coverage. In this repository, `npm run measure:starters:coverage` runs all six starter commands and records source/report hashes and run-specific results. It checks that every application module is measured, but does not present incomplete coverage as a passing 100% gate; compiler-generated decorator accessors appear in function counts. The chat and socket recipes include domain and real-network tests for reconnecting, identity conflicts, bounded history and session capacity.

`npm run verify:starters:source-coverage` separately instruments original TypeScript before compilation, so compiler-created decorator helpers do not inflate authored function counts. It runs the same application tests plain and instrumented, checks unchanged inputs, retains V8 reports, and enforces 100% of Istanbul's tracked statements/branches/functions/lines. All six starters pass with 104 tests per mode and all 600 statements, 299 branches, 160 functions and 472 lines covered. Integration tests use real networking and persistence; explicitly labelled unit cases exercise defensive failure paths. Istanbul does not independently count optional-chaining short circuits, so this is not an exhaustive semantic-branch claim or a replacement for V8 evidence. Reports identify received process reports, not every spawned child: hard termination can prevent an exit report, while every source module still starts in the denominator at zero. Node 22.13+ is required for all six recipes. Instrumentation and reports are test-only and are not shipped.

Run `npm run verify:browser:coverage` for native Chromium tests of the complete emitted Live HTML runtime and development-refresh script. The gate enforces 100% statement/branch/function/line coverage and runs the same cases without instrumentation. Actual HTTP/WebSocket checks cover actions, forms, state updates, reconnection and selection preservation. Refresh checks cover real reloads, draft guards, failed HTTP peers, history restoration and explicit discard under a self-only script policy; instrumentation requires no dynamic code evaluation.

The frontend is maintained in `redweb-client/live-html`; Redweb emits only a two-line mounting bootstrap. This branch depends on published `redweb-client@^0.2.0`, so ordinary application installation needs no client checkout or link. Contributors editing the client can still use the [linked development workflow](docs/CLIENT_DEVELOPMENT.md). Redweb itself remains unreleased until its remaining release checks finish.

`npm run measure:browser:client` separately serves the exact installed socket-only module with and without instrumentation through the same real HTTP/WebSocket/browser cases and retains its source hash and counters. It exits unsuccessfully until all four coverage metrics reach 100%; incomplete results are not a passing dependency-coverage claim. Reports are local under `coverage/browser-client` and do not alter the installed dependency or published package.

Ownership and stopped-poll edge cases also use native-browser unit-style tests; browser and transport APIs are not replaced. Runtime coverage now covers all Live HTML modules inside the linked client bundle, excluding its transport prefix; the development-refresh script is measured separately. Whole-application/tool coverage and cross-browser certification remain separate gates.

`npm run verify:client:source-coverage` measures the linked client's original TypeScript/JavaScript using one instrumentation map across its Node tests and the native browser tests. Every executable source module starts at zero; erased declarations and static export linkage are separately audited. Both test passes use identical source/test inputs, every Vitest test realm must report, and plain browser bundles must match the linked build byte-for-byte. Reports retain separate Node/browser contributions under `coverage/client-source/<run-id>`. The gate passes all 791 statements, 521 branches, 125 functions and 659 lines, with 77 Node tests per mode plus native-browser acceptance. The client's default `npm test` uses this same complete gate after linkage, build and type checks. Its original Node-only V8 diagnostic remains separately available as `npm run test:v8`, with unchanged thresholds and known missing-browser coverage. Original-source instrumentation does not count every optional-chain short circuit, replace V8 evidence, or mean all tests are mock-free: isolated unit transports remain, while integration/browser tests use actual networking.

Edit canonical recipes/guides, then run `npm run generate:docs`; do not maintain independent copies of the examples. See [documentation maintenance](docs/DOCUMENTATION.md) and the [full acceptance checklist](docs/AGENT_READY_ACCEPTANCE.md) for verification evidence and remaining release work.
