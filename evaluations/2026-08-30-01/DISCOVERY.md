# Framework discovery: local shared-counter chatroom

## Frozen first choice

Choose **Socket.IO 4.8.3 + socket.io-client 4.8.3 + Express 5.2.1**, with TypeScript and a small native-DOM browser client. Use one local Node.js process and one HTTP server, serving local assets and accepting Socket.IO connections with `transports: ["websocket"]` on both ends. No React, database, external service, deployment, or account system is needed.

This is my first and final discovery choice, frozen before any evaluator feedback. This report is a selection study, not an implementation or correctness claim. No dependencies were installed, no app was implemented or executed, and no browser acceptance tests were run.

## Timing and isolation

- Research start: **2026-08-30T02:41:06.9088207-04:00** (America/Toronto).
- Selection frozen: **2026-08-30T02:42:41.0550148-04:00**.
- Research end: **2026-08-30T02:42:41.0550148-04:00**; report preparation followed.
- Report completed: **2026-08-30T02:44:39.3521427-04:00**.
- Inherited-context contamination: the environment supplied a host working-directory label, `C:\Users\arkam\Documents\redweb`. That is possible project-name contamination, not verified npm metadata and not a recommendation. I did not inspect that directory, its package files, any sibling trial directories, or other agents' results. I did not use the label to select candidates or formulate queries. The inherited tool/skill catalog was also visible; none nominated a candidate for this brief.
- Filesystem actions were restricted to checking the clock, checking whether this report already existed, and creating this report. Public registry/GitHub HTTP requests ran from the temporary directory and did not read the host checkout.

## Exact public-search queries

The following six search strings were submitted, in order. The first contained a malformed `site` operator; it is recorded exactly rather than corrected retrospectively.

1. `site.socket.io docs v4 tutorial TypeScript server client broadcasting disconnect state recovery`
2. `site:github.com/websockets/ws README websocket broadcast typescript`
3. `site:liveviewjs.com TypeScript WebSocket liveview counter chat`
4. `site:socket.io/docs/v4 TypeScript transports websocket disconnect`
5. `site:github.com/floodfx/liveviewjs releases package.json`
6. `site:socket.io/docs/v4/tutorial handling disconnections textContent`

Search results included unrelated and secondary material; the decision relies on the primary documentation, repository, and package metadata below. Subsequent exploration used direct URLs and documentation links, not additional search queries. Three initial LiveViewJS link-click requests failed because the tool was given a URL instead of a result reference; retrying with the reference worked. That was a tool-call issue, not broken framework documentation.

## Verified package versions

These are registry `latest` values observed during this research, not versions installed or compatibility-tested. Each linked endpoint was fetched directly using a read-only HTTP request. Full metadata endpoints for the four principal candidate packages were also queried for publication dates.

| Package | Verified version | Relevant observation |
| --- | --- | --- |
| [socket.io](https://registry.npmjs.org/socket.io/latest) | 4.8.3 | [Published 2025-12-23](https://registry.npmjs.org/socket.io); depends on Engine.IO, parser, adapter, and supporting packages. |
| [socket.io-client](https://registry.npmjs.org/socket.io-client/latest) | 4.8.3 | Matching client; built-in TypeScript declarations documented. |
| [ws](https://registry.npmjs.org/ws/latest) | 8.21.3 | [Published 2026-08-07](https://registry.npmjs.org/ws); no ordinary `dependencies` field in latest metadata. Optional native acceleration is separate. |
| [liveviewjs](https://registry.npmjs.org/liveviewjs/latest) | 0.10.4 | [Published 2023-02-05](https://registry.npmjs.org/liveviewjs). |
| [@liveviewjs/express](https://registry.npmjs.org/%40liveviewjs%2Fexpress/latest) | 0.10.4 | [Published 2023-02-05](https://registry.npmjs.org/%40liveviewjs%2Fexpress); metadata includes Express 4, ws, Redis client, session and JWT dependencies; core dependency is `liveviewjs: "*"`. |
| [express](https://registry.npmjs.org/express/latest) | 5.2.1 | Node requirement `>=18`; selected only for serving the small local site. |
| [typescript](https://registry.npmjs.org/typescript/latest) | 7.0.2 | Proposed type-checker; not compatibility-tested here. |
| [esbuild](https://registry.npmjs.org/esbuild/latest) | 0.28.2 | Proposed build tool for the browser bundle and server output. |

The proposed toolchain also needs suitable Node/Express type packages; their exact versions were not verified. A supported Node LTS runtime would be selected at implementation time; this research did not inspect or verify the host runtime version.

## Comparison of three plausible approaches

### 1. Socket.IO + Express + native DOM — selected

Socket.IO documents typed events in both directions and typed socket-local data, while explicitly warning that types do not replace runtime input validation. This gives a small shared protocol without inventing a JSON message router. [TypeScript documentation](https://socket.io/docs/v4/typescript/)

Broadcasting is directly supported with `io.emit()`. The server has a documented `disconnect` event suitable for removing the connection's presence entry. [Broadcasting tutorial](https://socket.io/docs/v4/tutorial/step-5), [server API](https://socket.io/docs/v4/server-api/)

Crucially, default Socket.IO behavior is not enough to establish that the app actually uses WebSockets: it ordinarily starts with polling. Explicitly restrict both endpoints to WebSocket and verify the transport in testing. Socket.IO remains its own event protocol carried over WebSocket, not a server for arbitrary native-WebSocket clients. [Client transport options](https://socket.io/docs/v4/client-options/), [protocol source](https://github.com/socketio/socket.io/blob/main/docs/socket.io-protocol/v5-current.md)

This choice adds a client library and more transitive packages than bare `ws`, but removes hand-written heartbeat, reconnect, event-framing, and acknowledgement infrastructure. Native DOM updates make draft ownership particularly easy to inspect. It does not eliminate application state or UI code.

Maintenance confidence is supported by current parser/engine/adapter releases, including documented updates of the underlying ws dependency after a security issue. This is evidence of maintenance, not proof of an entirely vulnerability-free dependency graph. [Socket.IO releases](https://github.com/socketio/socket.io/releases)

### 2. ws + Express + native browser WebSocket — strong runner-up

`ws` provides a direct standards-based WebSocket server, examples for attaching to an HTTP server, broadcasting, and ping/pong detection of dead peers. Browsers use their native WebSocket object, not the Node client package. The README also reports Autobahn protocol-test coverage. [ws README](https://github.com/websockets/ws/blob/master/README.md)

The application must define and validate JSON envelopes, route events, manage acknowledgements/correlation, reconnect/backoff, and heartbeat cleanup. The existing close/message APIs are clear; there is no need for a UI framework. [ws API](https://github.com/websockets/ws/blob/master/doc/ws.md)

Recent releases and backports provide good maintenance evidence. Version 8.21.3 is confirmed in the release list, while 8.21.0 documents a memory-exhaustion fix and later patches refine behavior. [ws releases](https://github.com/websockets/ws/releases)

I would choose this if a native WebSocket wire protocol or avoiding a browser transport dependency were a priority. For this brief, the extra application-owned reconnect/heartbeat/protocol code outweighs the narrower dependency surface. Rejected for fit and glue cost, **not unclear documentation**.

### 3. LiveViewJS + its Express adapter — attractive server-driven alternative

LiveViewJS can send DOM diffs over WebSocket and route browser interactions to server handlers, substantially reducing custom frontend state synchronization. Its official multiplayer example supplies a single-process pub/sub counter. [Client runtime](https://www.liveviewjs.com/docs/client-javascript/overview), [pub/sub example](https://www.liveviewjs.com/docs/real-time-multi-player-pub-sub/example-pub-sub)

Its lifecycle runs initialization separately for HTTP and WebSocket phases. A presence implementation must distinguish these phases and perform application-specific cleanup, rather than treating every mount as a visitor joining. The lifecycle text discusses heartbeat/shutdown, but the material inspected did not establish the exact end-to-end presence-removal implementation for the published npm version. [Lifecycle](https://www.liveviewjs.com/docs/lifecycle-of-a-liveview/intro)

The Express integration requires route/template setup and HTTP/WebSocket middleware wiring. This is feasible locally with single-process pub/sub; the adapter's Redis package dependency does not mean a Redis service is required. [Integration example](https://www.liveviewjs.com/docs/webserver-integration/overview)

I inspected the [forms example](https://www.liveviewjs.com/docs/forms-and-changesets/use-with-forms), but did not establish a documented guarantee that an unfocused, unsent chat draft survives unrelated shared counter patches for the published package/client pairing. That is a verification gap, not a claim that LiveViewJS loses drafts. The counter example computes from per-view context; I would also verify simultaneous updates or replace that logic with a synchronous authoritative room reducer rather than assume the sample establishes linearizable updates.

The npm release is old, but it would be inaccurate to call the repository abandoned: the [GitHub repository API](https://api.github.com/repos/floodfx/liveviewjs) reported `archived: false` and a 2026-08-26 push. The [three most recent commits](https://api.github.com/repos/floodfx/liveviewjs/commits?per_page=3) included Phoenix compatibility testing; newest observed SHA was `b050abe71f0448c972890f664d90b5045017482b`. The gap between published npm artifacts and active main-branch compatibility work adds uncertainty about what an ordinary install actually receives.

Not selected because this small page does not justify taking on those package/client/lifecycle uncertainties to avoid a modest amount of explicit UI code. **Documentation/example uncertainty contributed to rejection**, alongside the publication gap; no confirmed implementation defect was demonstrated.

## Intended application responsibilities and glue estimate

These are design estimates, not measured line counts or a promised acceptance result.

| Approach | Approximate handwritten application/glue TypeScript, excluding HTML/CSS/tests | Responsibilities remaining |
| --- | --- | --- |
| Socket.IO choice | 220–350 lines across server, browser, and shared event types | State reducer, validation, snapshots, presence map, text rendering, small forms and acknowledgement UX. |
| ws runner-up | 280–430 lines | Same application work plus envelopes, message dispatch, heartbeat timers, reconnect/backoff and acknowledgement plumbing. |
| LiveViewJS | 180–330 lines, with higher uncertainty | Authoritative room store/pubsub, lifecycle presence, templates/forms, adapter/bootstrap setup and possibly a draft-preserving hook. |

Proposed selected-stack design:

1. Keep one authoritative room object: integer count, bounded recent-message list (for example 100), monotonic revision, and a map of joined socket IDs to validated names. Names need not be globally unique; presence entries are connections, not accounts.
2. Expose only join, increment and chat-send events. Validate types and sensible name/message limits on the server. Increment the current server value synchronously; never accept a replacement count from clients. Mutate state and emit its new snapshot without awaiting intervening work.
3. On connection/reconnection, send current state and rejoin with the visitor's locally retained name. On successful join, send/broadcast the updated snapshot. This removes a separate initial-state HTTP API and its ordering race.
4. On server-side disconnect, remove that socket's presence and broadcast. Normal tab closure should close the transport promptly; failures are detected by heartbeat. Do not depend on browser unload callbacks or promise instantaneous removal after network loss. Configure and test an acceptable timeout for this local room. [Heartbeat and transport options](https://socket.io/docs/v4/server-options/)
5. Render count, message list and presence into dedicated existing containers. Construct message/name text nodes or set `textContent`; never interpolate visitor content into `innerHTML`. Leave the draft input node and its value untouched by room snapshots. Clear a sent draft only after acceptance and only if the visitor has not edited that draft since submission. This is our proposed UI design, not a Socket.IO guarantee.
6. Disable mutation controls while disconnected; keep draft text. Use acknowledgements to distinguish accepted and uncertain sends. Do not blindly retry increments or chat messages without operation IDs and bounded in-memory deduplication. The documentation guarantees ordering but default delivery is at-most-once; an interrupted send can be ambiguous. [Delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/)
7. Re-snapshot on reconnection rather than rely solely on recovery of past events. Socket.IO does not store all server events by default. No persistence or distributed adapter is required. [Disconnection tutorial](https://socket.io/docs/v4/tutorial/handling-disconnections)
8. Serve the local HTML/CSS/browser bundle with Express static middleware. Build TypeScript with esbuild and run a separate type check; esbuild explicitly does not type-check. [Express static files](https://expressjs.com/en/starter/static-files/), [esbuild TypeScript support](https://esbuild.github.io/content-types/#typescript)

## Unresolved risks and required implementation checks

- No install/lockfile exists from this trial. Resolve and inspect the complete dependency tree, including current Engine.IO/parser/adapter/ws patches; top-level version pinning alone is insufficient. Run normal dependency and license checks before implementation handoff.
- The proposed TypeScript 7.0.2/esbuild 0.28.2/Node combination was not compiled here. Any type-definition compatibility problem remains open; it does not change the frozen library selection.
- Two real browser visitors must prove counter convergence under near-simultaneous clicks, names/presence, chat delivery, and fresh-page history. Test draft survival while the other visitor sends and increments, including when the draft input is unfocused.
- Test tab closure and abrupt lost connections separately; heartbeat timeouts make presence eventually accurate after ungraceful loss. Verify reconnect does not create duplicate presence entries.
- Inspect actual WebSocket upgrade/frames and server transport identity; passing UI tests with polling would not satisfy the brief.
- Send HTML/script-like names and messages and verify literal text rendering. Test malformed payloads and length limits. Validate local request origins and bind locally by default; unauthenticated room access is intentional, arbitrary browser origins are not.
- Interrupted acknowledgements and duplicate operation IDs need explicit acceptance tests if retries are enabled. Do not claim exactly-once delivery or restart durability.

## Additional inspected primary pages

The following were opened during navigation but supplied no additional decisive evidence beyond sources cited above: [Socket.IO ending notes](https://socket.io/docs/v4/tutorial/ending-notes), [emitting-events tutorial](https://socket.io/docs/v4/tutorial/step-4), [LiveViewJS repository](https://github.com/floodfx/liveviewjs), [lifecycle category](https://www.liveviewjs.com/docs/category/lifecycle-of-a-liveview), [forms category](https://www.liveviewjs.com/docs/category/forms--changesets), and [integration category](https://www.liveviewjs.com/docs/category/webserver-integrations).

Bottom line: the choice favors a small, inspectable state/UI implementation plus documented transport lifecycle support. It does not equate either the largest ecosystem or the smallest dependency count with correctness.
