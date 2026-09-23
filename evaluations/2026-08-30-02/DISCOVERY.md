# Frozen stack-selection report

Research started: **2026-08-30T06:59:09.8171821-04:00**  
Research ended: **2026-08-30T07:01:19.5099456-04:00**  
Timezone: America/Toronto.

## Selection

Choose **Socket.IO 4.8.3, Node.js 24.20.0, TypeScript, and a plain-DOM browser interface**, with **WebSocket-only transport enabled on both client and server**.

This is a documentation-based selection, not a tested application. Nothing was installed, implemented, edited, or deployed.

### Selected versions

| Component | Exact version | Role and verification |
|---|---:|---|
| Node.js | 24.20.0 | Runtime; official release index reports this as an LTS release dated August 26, 2026. [Release index](https://nodejs.org/dist/index.json) |
| `socket.io` | 4.8.3 | Realtime server. npm reports publication December 23, 2025, bundled TypeScript declarations, MIT license, and Node requirement `>=10.2.0`. [npm metadata](https://registry.npmjs.org/socket.io) |
| `socket.io-client` | 4.8.3 | Matching browser-client types; use the locally served client bundle. npm reports publication December 23, 2025. [npm metadata](https://registry.npmjs.org/socket.io-client) |
| `typescript` | 5.9.3 | Pinned compiler for server and browser application code. Exact-version metadata confirms the `tsc` executable and Node requirement `>=14.17`. [Version metadata](https://registry.npmjs.org/typescript/5.9.3) |
| `@types/node` | 24.13.3 | Node 24 declarations; latest non-prerelease 24.x version found in registry metadata. [npm metadata](https://registry.npmjs.org/%40types%2Fnode) |

TypeScript 5.9.3 is deliberately **not** a claim about the latest compiler: the registry returned 7.0.2 as latest. For this small trial, I would pin the older compiler rather than introduce a compiler-major migration variable. Compatibility of the complete selected dependency set remains untested.

No frontend framework, Express, database, Redis, managed service, or deployment tooling is proposed. Node’s HTTP server can serve the few fixed assets and host Socket.IO. Socket.IO documents its plain-HTTP-server integration and locally served client bundle. [Server API](https://socket.io/docs/v4/server-api/), [Client installation](https://socket.io/docs/v4/client-installation/)

## Discovery record

### Package-agnostic searches, performed first

Queries 1–3 were submitted in one batch, in this exact order. The search tool returned merged results, so individual result-to-query attribution is not available.

1. `TypeScript Node.js small realtime shared state chat presence websocket full stack minimal glue framework`
2. `Node.js server rendered interactive UI websocket preserve input state chat counter`
3. `TypeScript synchronized shared state rooms presence websocket npm library`

Relevant discovery results included:

- [datasole repository](https://github.com/mayanklahiri/datasole)
- [Feathers](https://feathersjs.com/)
- [Rivalis](https://rivalis.dev/)
- [Roomful](https://www.roomful.dev/)
- [Supabase realtime client on npm](https://www.npmjs.com/package/%40supabase/realtime-js?activeTab=readme)
- [Node.js Design Patterns excerpt](https://www.digitalbreakdown.net/sandbox/Ebooks/Node.js-Design-Patterns.pdf), which surfaced `ws`
- [Discussion of realtime chat architecture](https://www.reddit.com/r/node/comments/vpp0ml), which surfaced Socket.IO among other names

A fourth category search was then submitted:

4. `Node TypeScript server driven UI WebSocket live view framework shared state`

Relevant results:

- [LiveViewJS introduction](https://www.liveviewjs.com/docs/overview/introduction)
- [Backroad](https://backroad.sudomakes.art/)
- [HotdogJS](https://hotdogjs.com/)
- [ts-liveview overview](https://www.liveviews.cc/about)
- [Socket.IO overview discovery result](https://en.wikipedia.org/wiki/Socket.IO)

Secondary sources above were discovery aids, not evidence for the final technical recommendation.

### Initial shortlist, frozen before package-specific searches

1. **LiveViewJS** — server-rendered interactive UI and shared-state notifications.
2. **Backroad** — bundled server-driven UI, potentially very little client/backend glue.
3. **Socket.IO** — typed event transport with connection lifecycle support.
4. **`ws`** — small, direct WebSocket transport baseline.

Other discovered packages were not promoted to the shortlist. I favored comparing two integrated UI approaches against two transport-oriented approaches rather than expanding indefinitely.

### Subsequent exact search sequence

Queries 5–8 were submitted together, in this order:

5. `LiveViewJS pubsub shutdown forms html escape npm`
6. `Backroad backroad shared state disconnect session textInput npm`
7. `Socket.IO websocket transport disconnect typescript npm`
8. `ws npm WebSocket server broadcast close heartbeat typescript`

Relevant results included:

- [LiveViewJS npm historical version](https://www.npmjs.com/package/liveviewjs/v/0.4.3)
- [LiveViewJS packages and runtimes](https://www.liveviewjs.com/docs/overview/runtimes)
- [LiveViewJS event bindings](https://www.liveviewjs.com/docs/user-events-slash-bindings/overview)
- [Socket.IO npm](https://www.npmjs.com/package/socket.io?activeTab=code)
- [Socket.IO protocol](https://github.com/socketio/socket.io/blob/main/docs/socket.io-protocol/v5-current.md)
- [`ws` npm](https://www.npmjs.com/package/ws)
- [`ws` primary repository documentation](https://github.com/websockets/ws)

After primary-document inspection, the final search batch was:

9. `site:backroad.sudomakes.art "shared" "state"`
10. `site:backroad.sudomakes.art "disconnect"`
11. `site:backroad.sudomakes.art "text" "chat"`

The tool returned **no results** for that batch. This is an evidence gap, not proof those capabilities do not exist.

### Primary-source inspection sequence

After queries 5–8, I:

1. Opened Backroad’s homepage, LiveViewJS’s introduction/runtime documentation, and attempted npm registry `latest` endpoints for all four shortlisted packages.
2. Retrieved full npm metadata directly using read-only HTTP requests after the browser tool rejected the registry endpoints.
3. Read Backroad’s getting-started, introduction, repository README, and render-path documentation.
4. Read LiveViewJS’s lifecycle, realtime overview, and multiplayer-counter example.
5. Read Socket.IO’s client options, TypeScript guide, server API/options, and broadcasting tutorial.
6. Ran searches 9–11.
7. Retrieved supporting-package metadata and Node’s official release index.
8. Checked the exact TypeScript 5.9.3 metadata and Node 24 declaration versions.
9. Read TypeScript compiler documentation and Socket.IO client-installation documentation; rechecked standalone-client and validation details.

## Why this fits the brief

The following describes the **proposed application design**, not automatically provided or observed behavior.

| Requirement | Proposed handling |
|---|---|
| Server-owned shared counter | Keep one process-level counter. Clients send increment/decrement intents; the server changes the canonical value synchronously and broadcasts it. Never accept a client-supplied replacement count. |
| Named visitors and presence | Track one visitor per connected, joined socket. Names are display labels, not authentication. Broadcast the visitor list after joins and disconnects. |
| Chat | Keep a bounded recent-message array in memory; validate incoming strings, assign server-side metadata, and broadcast accepted messages. |
| Preserve drafts | Keep the draft in its existing input element. Counter, message-list, and presence updates must not replace that input or reset its value. |
| Remove closed tabs | Remove presence in the server’s disconnect handler. Clean closes should be detected promptly; abrupt loss can require heartbeat timeout. |
| Fresh-page state | Send the current counter, recent messages, and presence snapshot on connection/join, and again after reconnecting. |
| Text-only messages | Create text nodes or assign `textContent`; do not insert user messages into `innerHTML`. |
| Actual WebSockets | Configure `transports: ["websocket"]` on both ends. No polling fallback. Verify the negotiated transport during acceptance testing. |

Socket.IO supplies broadcasts and disconnect events, including transport-close and heartbeat-timeout reasons. The application still owns presence records and history. [Server API](https://socket.io/docs/v4/server-api/)

The official chat tutorial demonstrates appending messages through `textContent`. Draft preservation is my architectural inference from updating independent DOM regions—not a Socket.IO guarantee. [Broadcasting tutorial](https://socket.io/docs/v4/tutorial/step-5)

Socket.IO’s defaults are not sufficient for the transport requirement: it ordinarily allows polling and upgrades. Explicit WebSocket-only configuration is essential. Socket.IO also adds its own protocol above WebSocket; a bare WebSocket client is not interchangeable with its client library. [Client options](https://socket.io/docs/v4/client-options/), [Server options](https://socket.io/docs/v4/server-options/), [Protocol documentation](https://github.com/socketio/socket.io/blob/main/docs/socket.io-protocol/v5-current.md)

The frontend can use the server’s local `/socket.io/socket.io.js` bundle and compile its small TypeScript DOM controller with `tsc`. The separate client package supplies matching type declarations; no CDN or frontend bundler is necessary in the proposed arrangement. [Client installation](https://socket.io/docs/v4/client-installation/), [Compiler documentation](https://www.typescriptlang.org/docs/handbook/compiler-options.html)

## Alternatives and tradeoffs

### LiveViewJS 0.10.4

Its documented model is particularly attractive for minimal frontend/backend glue: server event handlers render HTML diffs delivered over WebSockets. It has an explicit single-process pub/sub multiplayer-counter example and lifecycle documentation. [Introduction](https://www.liveviewjs.com/docs/overview/introduction), [Counter example](https://www.liveviewjs.com/docs/real-time-multi-player-pub-sub/example-pub-sub), [Lifecycle](https://www.liveviewjs.com/docs/lifecycle-of-a-liveview/intro)

Registry metadata reports latest version **0.10.4**, published **February 5, 2023**, with bundled declarations and MIT license. [npm metadata](https://registry.npmjs.org/liveviewjs)

Why not selected: the old published release creates a compatibility/maintenance uncertainty, and the Node integration adds framework-specific setup. Draft behavior, safe text rendering, and tab-close presence cleanup were not sufficiently established for the exact combined use case in this inspection. This is not a finding that LiveViewJS cannot satisfy them.

### Backroad 1.20.2

Backroad bundles a React client and lets a Node TypeScript script describe its UI. Its documentation describes per-user sessions and tree patching that avoids remounting unchanged subtrees. This could produce less application UI code than the selected stack. [Introduction](https://backroad.sudomakes.art/docs/intro), [Getting started](https://backroad.sudomakes.art/docs/getting-started), [Render paths](https://backroad.sudomakes.art/docs/advanced/render-paths)

Registry metadata reports **1.20.2**, published **June 27, 2026**, depending on `@backroad/core` 1.20.2, Express, and Socket.IO, among others. Its latest package record lacked a license field. [npm metadata](https://registry.npmjs.org/%40backroad%2Fbackroad)

Why not selected: the inspected documentation did not establish a clear public API for shared cross-session broadcasts plus disconnect cleanup. Nor did I verify a public WebSocket-only configuration or literal-text chat rendering path. Those unresolved details matter more here than the attractive basic counter/input demonstration.

The repository page also displayed inconsistent licensing cues—an MIT label and README wording about Fair Source—so I would resolve licensing before adoption rather than infer terms. [Repository](https://github.com/sudomakes/backroad)

### `ws` 8.21.3

Registry metadata reports **8.21.3**, published **August 7, 2026**, MIT license, Node `>=10.0.0`, and no ordinary runtime dependencies. Browser clients use the native WebSocket API. Its primary documentation includes broadcasts and heartbeat-based broken-connection detection. [npm metadata](https://registry.npmjs.org/ws), [Primary documentation](https://github.com/websockets/ws)

Why not selected: it minimizes the transport dependency footprint, but leaves more application plumbing for message envelopes, reconnect handling, and heartbeat management. Socket.IO’s existing lifecycle and typed-event facilities are a better tradeoff for a small amount of readable application code.

### Cost of the selected choice

Socket.IO does not eliminate frontend/backend glue. The application still needs a small shared event contract, server handlers, snapshot logic, validation, and DOM updates. It also has more dependencies and protocol overhead than `ws`.

I prefer that explicit, narrow glue over introducing an integrated UI framework whose exact multi-visitor lifecycle remains uncertain. This is a judgment about this trial—not a general ranking of the frameworks.

## Uncertainties and verification boundary

**Actually checked:** public documentation, npm metadata, package publication dates, documented transport options, and Node release metadata.

**Not checked:** installation, compilation, runtime compatibility, real WebSocket traffic, simultaneous visitor behavior, tab-close latency, draft preservation, reconnect resynchronization, or XSS acceptance tests. No dependency audit or complete transitive lockfile was produced.

Before accepting an implementation, I would test:

- Two named tabs exchanging messages and concurrent counter actions.
- A draft surviving remote messages, presence updates, and counter clicks.
- Normal tab closure and abrupt connection loss.
- Fresh-page and reconnect snapshots.
- HTML-like messages appearing literally.
- Browser network evidence of WebSocket transport.
- Rejected malformed/oversized inputs.

TypeScript event declarations do not replace runtime validation. Socket.IO explicitly warns about this. [TypeScript guide](https://socket.io/docs/v4/typescript/)

Presence disappearance is bounded by connection-loss detection; instantaneous detection of every abrupt tab/process/network failure is not promised.

## Access failures and contamination disclosure

- The browser tool rejected these npm `latest` URLs as unsafe/non-retryable: `liveviewjs`, `@backroad/backroad`, `socket.io`, and `ws`. Read-only direct HTTP requests to the public registry succeeded afterward.
- Backroad’s homepage opened with zero extracted lines; its linked documentation was readable.
- The three targeted Backroad searches returned no results.
- The environment exposed the workspace name/path `redweb`, runtime/tool metadata, plugin names, and skill descriptions containing unrelated libraries such as `reportlab`, `pdfplumber`, and `pypdf`. None seeded the searches or shortlist.
- No shortlisted package name was revealed to me by workspace inspection; there was no workspace inspection.
- I did not read local application source, evaluation reports, repository history, or prior task conversations. The public Backroad repository landing page incidentally displayed file listings and history headings; I did not open commit history.
- No agents were spawned.

**Frozen final choice: Socket.IO 4.8.3 with WebSocket-only transport, Node.js 24.20.0, TypeScript 5.9.3, and a small plain-DOM client.**
