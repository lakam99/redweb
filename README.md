# Redweb

Build a TypeScript website and its realtime backend together. Decorated classes own state and actions; server-rendered JSX updates the browser through WebSockets. No React, frontend bundler, or separate socket glue is required.

Use the same package for a live site, static HTML, Express HTTP endpoints, or routed WebSocket services.

Redweb 0.14.0 adds [`defineApp({ pages, sockets, services, port })`](docs/APPLICATION.md), followed by `await app.run()`, for one owned HTTP/WebSocket listener.

## Install

Start with a complete, tested counter application:

<!-- redweb:setup:start -->
> Documentation for Redweb 0.14.0. Install that exact version when following these examples.

```sh
npx --yes redweb@0.14.0 init my-realtime --template realtime
cd my-realtime
npm install --save-exact redweb@0.14.0
npm test
npm run dev
```
<!-- redweb:setup:end -->

Open two tabs at `http://localhost:8181`. Clicking either button changes the counter on the server and updates both tabs.

This is the starter's exact `src/app.tsx`. The initializer also supplies its stylesheet, compiler configuration, and real-network tests; startup and shutdown belong to Redweb itself. The file is not a standalone copy-and-run program.

<!-- redweb:realtime:start -->
```tsx
import { action, defineApp, page, state } from 'redweb';

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
                    Count {this.count}
                </button>
            </main>
        );
    }
}

export const app = defineApp({ pages: [CounterPage], port: Number(process.env.PORT ?? 8181), templateRoot: __dirname });

if (require.main === module) void app.run().catch(error => { console.error(error); process.exitCode = 1; });
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
import { BaseHandler, defineApp, METHODS, SocketRoute, type RedWebSocket } from 'redweb';

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

export const app = defineApp({
    sockets: [ChatRoute],
    port: Number(process.env.PORT ?? 8181),
    bind: '127.0.0.1',
    publicPaths: [],
    httpServices: [{ serviceName: '/health', method: METHODS.GET, function: (_req, res) => res.json({ ok: true }) }],
});

if (require.main === module) void app.run().catch(error => { console.error(error); process.exitCode = 1; });
```
<!-- redweb:http-ws:end -->

Follow the [shared-listener notes](recipes/http-ws/README.md) and initialize with `--template http-ws` using the matching artifact above. The unified application owns cleanup of its HTTP and socket resources. `/health` reports liveness, not readiness. This demonstrates raw JSON messages, not a chatroom UI.

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

Run `npm run verify:recovery:server` from this source checkout for the blocking CI recovery contract: 7,400 exact exchanges with a separately measured server, empty registries, normal worker exits and every storm within 110% of warmed server heap. The original `npm run verify:recovery` remains a visible non-blocking CI diagnostic; its historical failures are not resolved by this measurement change. CI preserves both results and logs. See the [reviewed recovery contract and evidence](docs/SERVER_RECOVERY_CANDIDATE.md).

`npm run verify:recovery:coverage` separately enforces all-four 100% coverage of that gate's policy, CLI, and full authored coordinator/worker source. It combines unit boundary tests with actual worker/socket integration without repeating the native workload. The instrumented behavioral run is not used as a clean heap measurement; the normal server recovery command remains separate. See [authored recovery coverage](docs/SPLIT_RECOVERY_COVERAGE.md).

`npm run verify:recovery:original:coverage` separately tests the original shared-process verifier with authored-source coverage units and its existing real CLI/socket/snapshot checks. Its 110% limit now compares integer bytes exactly: equality passes, a one-byte excess fails, and any over-budget storm still fails even if the final heap recovers. Displayed ratios and workloads are unchanged. Synthetic unit heap values are not memory evidence, and this rounding correction does not explain larger historical failures. See the [coverage and regression evidence](docs/ORIGINAL_RECOVERY_VERIFICATION.md).

Recovery workers also retain non-Error failures and clean up rejected IPC requests immediately; empty error replies cannot masquerade as success. [Real-process regressions and server recovery evidence](docs/SPLIT_RECOVERY_ERROR_HANDLING.md) distinguish correctness fixes from coverage. Short soak checks retain raw results before assertions and preserve original reports if artifact writing fails. A [hosted delivery failure and real rotation controls](docs/SOAK_ROTATION_OBSERVATION.md) remain visible; no delivery threshold was relaxed.

Run `npm run verify:recovery:diagnostics` for native-source 100% coverage of the two private heap-analysis tools, including their real command-line entrypoints. It reuses the graph unit cases under Node's test runner to avoid merging Jest-transformed and original source ranges. Parser fixtures and real file/subprocess checks cover graph bounds, shared references, redaction, and malformed input; the separate recovery integration suite also checks actual V8 snapshots and a real server-held object. This gate does not cover the recovery workload verifier itself or waive its failed memory budget.

Run `npm run verify:package:tools` for a separate 100% coverage gate over the managed subprocess owner, failure normalizer, and starter/Markdown application verifiers. Tests use actual npm/native commands, descendants, files and generated applications. Use Node 22.13+ to exercise all six recipes, including the SQLite dashboard. Package packing/extraction and consumer checks use the same bounded owner; uncertain cleanup fails verification and retains its workspace. This is a scoped tool gate, verified on Windows, not coverage of every verification script or proof of cross-platform execution; Windows file-lock cases are skipped elsewhere.

Every generated starter also has `npm run test:coverage`: real application tests with coverage mapped to its TypeScript, separate from library coverage. In this repository, `npm run measure:starters:coverage` runs all six starter commands and records source/report hashes and run-specific results. It checks that every application module is measured, but does not present incomplete coverage as a passing 100% gate; compiler-generated decorator accessors appear in function counts. The chat and socket recipes include domain and real-network tests for reconnecting, identity conflicts, bounded history and session capacity.

`npm run verify:starters:source-coverage` separately instruments original TypeScript before compilation, so compiler-created decorator helpers do not inflate authored function counts. It runs the same application tests plain and instrumented, checks unchanged inputs, retains V8 reports, and enforces 100% of Istanbul's tracked statements/branches/functions/lines. All six starters pass with 104 tests per mode and all 600 statements, 299 branches, 160 functions and 472 lines covered. Integration tests use real networking and persistence; explicitly labelled unit cases exercise defensive failure paths. Istanbul does not independently count optional-chaining short circuits, so this is not an exhaustive semantic-branch claim or a replacement for V8 evidence. Reports identify received process reports, not every spawned child: hard termination can prevent an exit report, while every source module still starts in the denominator at zero. Node 22.13+ is required for all six recipes. Instrumentation and reports are test-only and are not shipped.

Run `npm run verify:browser:coverage` for native Chromium tests of the complete emitted Live HTML runtime and development-refresh script. The gate enforces 100% statement/branch/function/line coverage and runs the same cases without instrumentation. Actual HTTP/WebSocket checks cover actions, forms, state updates, reconnection and selection preservation. Refresh checks cover real reloads, draft guards, failed HTTP peers, history restoration and explicit discard under a self-only script policy; instrumentation requires no dynamic code evaluation.

The refresh report (`coverage/browser-refresh/report.json`) also retains `historyRestoration.plain.bfcacheRestored` and `historyRestoration.instrumented.bfcacheRestored` for each successfully completed mode. These are actual browser observations, not requirements: history navigation and resumed polling must pass, but the browser may choose to reload instead of restoring from its back/forward cache. A mode that fails before completion may only log its observation.

`npm run verify:refresh:coverage` separately requires 100% authored coverage of both refresh verification helpers. It combines explicit failure-boundary units with actual Chromium, HTTP uploads and socket cleanup, and is included in the browser coverage gate. Collection, page-close and socket-release failures remain visible together; a rejected non-Error value cannot become a passing result. The host-side helper map does not measure execution inside browser-expression strings; the separate generated-refresh map and native checks remain required.

`npm run verify:development:coverage` additionally covers the generated-app refresh verifier: real TypeScript/CSS rebuilds, browser draft preservation, adverse HTTP peers and process cleanup, plus explicit startup/cleanup failure units. Page openings remain owned if they time out or settle late; uncertain cleanup retains the workspace. CI runs this gate instead of repeating the standalone development browser command. Its 100% scope is the authored coordinator, not embedded browser programs or every possible platform failure.

`npm run verify:package:coordinator:coverage` runs the complete isolated-package check alongside explicit failure-boundary units and real listener-cleanup tests. It requires 100% authored coverage of the package coordinator and report helper. Every acquired example server gets its own cleanup attempt; a missing error value cannot become success, and success is printed only after workspace cleanup. CI uses this instead of repeating the standalone package command. The full consumer check requires the dashboard starter's Node version (22.13 or newer); older supported library versions run the native cleanup checks but skip that consumer case.

The isolated browser harness copies its verification helpers explicitly and checks their literal relative imports against that copied set. This catches missing test dependencies without falling back to checkout runtime code; the real packed-consumer gate still verifies installation and execution.

`npm run verify:evaluation:process:coverage` measures the unchanged evaluation process and evidence-sealing tools at 100% authored coverage. It combines explicit OS-boundary units with actual subprocess, archive, file-lock, CLI and listener checks. A test-only preload instruments selected code in memory; frozen source and sealed evaluation records are not rewritten. Native interface inspection is Windows-only; unsupported platforms are tested for explicit rejection. This coverage gate does not rerun an agent trial or resolve historical cleanup failures.

`npm run verify:evaluation:prepare:coverage` separately checks candidate preparation against actual npm archives, catalogue bytes and Git identity, comparing plain and instrumented CLI execution. Real launch-failure checks supplement explicit subprocess-boundary units. It uses owned temporary directories and does not publish packages or rerun sealed agent trials.

`npm run verify:evaluation:trial:coverage` checks the unchanged trial runner's input hashes, build outcomes and evidence retention. It combines real archive/CLI checks, explicit failure units and the evaluator's actual HTTP/WebSocket browser control on Windows. Synthetic checker fixtures are not new agent trials or substitutes for packed Redweb acceptance. Uncertain cleanup preserves the outer test workspace and its report, including leftover browser profiles even when no report was saved.

`npm run verify:evaluation:controls:coverage` measures the unchanged control validator and browser evaluator together: four working protocol controls and seven deliberately broken variants run in actual Chromium on Windows. Real CLI tests also cover failed builds, early exits, invalid startup URLs and HTTP rejection. Elsewhere, interface inspection must explicitly refuse support, not imply browser success. Separate browser/process/result boundary units cover reporting and cleanup faults; unexpected native outcomes retain their original errors and workspace. These evaluator controls are not new Redweb agent submissions or release acceptance.

`npm run verify:live-html:browser:coverage` combines the existing full browser workload (counter, chat, CSS, JSX, components, forms and dashboard) with explicit failure-path unit tests. Its 100% authored-tool coverage is separate from frontend coverage and release acceptance. The native workload requires the dashboard's supported Node version. Known limitations of the unchanged legacy browser tool— including uncertain descendant cleanup—are characterized, not silently fixed or counted as verified cleanup; see the [coverage audit](docs/COVERAGE_SCOPE_AUDIT.md).

The frontend is maintained in `redweb-client/live-html`; Redweb emits only a two-line mounting bootstrap. Redweb 0.14.0 depends on published `redweb-client@^0.2.0`, so ordinary application installation needs no client checkout or link. Contributors editing the client can still use the [linked development workflow](docs/CLIENT_DEVELOPMENT.md).

`npm run measure:browser:client` separately serves the exact installed socket-only module with and without instrumentation through the same real HTTP/WebSocket/browser cases and retains its source hash and counters. It exits unsuccessfully until all four coverage metrics reach 100%; incomplete results are not a passing dependency-coverage claim. Reports are local under `coverage/browser-client` and do not alter the installed dependency or published package.

`npm run verify:browser:coordinator:coverage` checks the browser coordinator and four runtime/refresh verification helpers together at 100% authored coverage. The umbrella browser gate uses this combined run to avoid repeating the native workloads. Failure units supplement actual Chromium/HTTP/WebSocket checks; the installed-client diagnostic must still report incomplete coverage as failure, not a release pass. CI retains the combined map and separate runtime/refresh/client reports. An additional source-build integration requires `REDWEB_VERIFY_CLIENT_SOURCE=1` and the linked client checkout with its development dependencies; ordinary registry-only CI skips that case. The standalone `verify:client:source-coverage` remains the original-source acceptance gate.

Ownership and stopped-poll edge cases also use native-browser unit-style tests; browser and transport APIs are not replaced. Runtime coverage now covers all Live HTML modules inside the linked client bundle, excluding its transport prefix; the development-refresh script is measured separately. Whole-application/tool coverage and cross-browser certification remain separate gates.

`npm run verify:client:source-coverage` measures the linked client's original TypeScript/JavaScript using one instrumentation map across its Node tests and the native browser tests. Every executable source module starts at zero; erased declarations and static export linkage are separately audited. Both test passes use identical source/test inputs, every Vitest test realm must report, and plain browser bundles must match the linked build byte-for-byte. Reports retain separate Node/browser contributions under `coverage/client-source/<run-id>`. The gate passes all 791 statements, 521 branches, 125 functions and 659 lines, with 77 Node tests per mode plus native-browser acceptance. The client's default `npm test` uses this same complete gate after linkage, build and type checks. Its original Node-only V8 diagnostic remains separately available as `npm run test:v8`, with unchanged thresholds and known missing-browser coverage. Original-source instrumentation does not count every optional-chain short circuit, replace V8 evidence, or mean all tests are mock-free: isolated unit transports remain, while integration/browser tests use actual networking.

Client verification also retains raw worker files before parsing or cleanup, including failed runs. Its private coordinator has a separate 100% coverage gate; real Vitest failure fixtures exercise retention without replacing filesystem, compiler or process APIs. See [client development](docs/CLIENT_DEVELOPMENT.md) for commands and scope.

`npm run verify:browser:supplements` combines focused units with the existing real-browser runtime cases to require 100% authored-source coverage of the page-ownership and runtime-frame verification helpers, including anonymous callbacks. It is included in the browser coverage gate; see the [coverage scope audit](docs/COVERAGE_SCOPE_AUDIT.md) for exact boundaries and remaining gaps.

`npm run verify:dashboard:coverage` measures the dashboard browser verifier separately: failure-boundary units plus headed Chromium, SQLite, rejected and accepted browser form sign-in through `localhost`, private card updates, draft preservation and logout checks. CI runs the visible-browser process under a virtual display. Native dashboard tests require the starter's supported Node version; file-lock retention is Windows-specific. The scope is the authored verifier, not internal coverage of its browser-expression strings.

All canonical browser-facing examples run in headed Chromium: counter, chat, cards, components and JSX. `npm run verify:package:browser:coverage` tests their individual interactions, computed CSS, chat reconnect/disconnect and component isolation. `npm run verify:starter:browser:coverage` independently checks the generated realtime, chat and multipage site starters after compilation with their source removed. The isolated `verify:live-html:package` gate repeats these checks against the installed tarball. Dashboard coverage remains the separate headed gate above; socket-only starters use real HTTP/WebSocket tests rather than a browser. These integration tests use real servers and sockets, not mocks. Failure-boundary units supplement them; 100% authored harness coverage is not a claim of exhaustive browser behavior or cross-browser certification. No soak is required for this example acceptance.

An unresolved Linux CI process-cleanup assertion and the diagnostics added to investigate it are tracked in [process cleanup observations](docs/PROCESS_CLEANUP_OBSERVATION.md). Passing runs do not establish its cause or waive the original failure.

Edit canonical recipes/guides, then run `npm run generate:docs`; do not maintain independent copies of the examples. See [documentation maintenance](docs/DOCUMENTATION.md) and the [full acceptance checklist](docs/AGENT_READY_ACCEPTANCE.md) for verification evidence and remaining release work.
