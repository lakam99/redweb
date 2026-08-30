# Changelog

## Unreleased

- All generated starters now share an import-safe application entrypoint helper for idempotent signal/listener-error shutdown, preserved failure exit status and a whole-application cleanup deadline. The dashboard retains database/auth cleanup without a competing HTTP timer. Generated and source-free tests exercise real processes/transports; a separate shared-helper coverage gate runs in CI.

- Unified owned-listener cleanup for Live HTML and socket servers. Incomplete HTTP bodies, headers, and TLS handshakes can no longer hold shutdown open indefinitely, including after native listener close has already begun. Borrowed HTTP listeners remain application-owned. Live HTML's final HTTP cleanup has its own bounded phase; forced transport closure is not an application persistence guarantee.
- Added release verification and compatibility guidance distinguishing maintained Node runtimes, configured CI, recorded test evidence, registry signatures, and build provenance. Added Node 24 to the CI matrix without claiming an unexecuted job has passed.

- Added loopback-only development browser refresh to generated HTML starters. Explicit Live HTML `development.refresh` or the development command's environment flag enables same-origin revision polling; clean pages reload after restart while detected edits require confirmation. Reactive root patches retain the shadow-root notice, failed builds/outages do not trigger reload, and drafts are never copied into browser storage or restored after explicit reload. Production construction rejects enabling refresh; raw socket servers and static exports do not enable it.

- Added opt-in in-process development inspection for Live HTML and socket servers: bounded immutable registration/connection snapshots and reactive invalidation/flush history without state values, identities, request contents or exception messages. Inspection is rejected during production construction and adds no debugging endpoint. Disabled servers use the original reactive renderer. Standard action resolution now excludes accessor replacements without invoking their getters.

- Added `redweb add page`, `redweb add component`, and `redweb add socket-route` with canonical source/test templates, effective TypeScript layout checks and in-memory emission, dry-run/JSON reports, explicit registration instructions, and exclusive creation without rewriting existing application files. Generated artifact-only tests exercise actual HTTP/WebSocket behavior; socket additions keep URL routing separate from validated message handlers.

- Added fixed HTTP upgrade diagnostics through `Redweb-Error` and no-store responses, separating rejected credentials (401), origin/permission/placement denial (403), callback bugs (500), and timeout/cancellation/capacity (503). Clients that previously treated every admission failure as 401 must use the new categories. Protocol negotiation remains 426 with a specific code; safe placement remains 307. Raw authentication still rejects only literal `false`.
- Admission now shares the bounded-operation primitive and checks deadlines between stages, preventing late identity/origin results from starting placement or further authentication after cancellation. Actual evaluation work retains its admission reservation until settlement. Public and protected page failures are sanitized, capacity is distinguished from application failure, and malformed exceptions/partial responses/throwing upgrade loggers are contained. The new runtime guide states browser visibility, nested page-lifetime cancellation limits and retry/side-effect boundaries.

- Added explicit asynchronous `enterRoom`/`rooms.enter` authorization with shared page/action policy machinery, bounded pending work, safe recoverable diagnostics and atomic membership commits. Synchronous joins fail closed on guarded rooms; guarded socket publication requires a live member. Leave/leaveAll/clear, disconnect, replacement and drain cancel pending entry without reentrant membership resurrection. Timed-out policy work remains charged until its underlying promise settles.
- Added shared request-context types and immutable selected raw-upgrade snapshots, with per-connection cancellation and protected identity/request references. Mutable application metadata/session fields and existing raw admission object identities remain supported. A complete TSX page/private-room example verifies shared authentication and explicit revocation in standard/legacy and packed source-free consumers.

- Added read-only action-reference checks to doctor: literal TSX/HTML bindings are compared with exposed page/component methods, including inherited renderers, imported constants and callable render fields. Dynamic output, custom scopes/decorators, instance mutation and JSX spreads receive unresolved warnings instead of guessed results. The scanner shares the runtime's HTML tag traversal. A real CLI repair/compile/HTTP/WebSocket regression verifies the workflow without mocks.
- Dashboard recipe coverage now includes real expiration of the one-minute login admission window and default configuration paths. Its separate source-mapped report reaches 100% statements/branches/lines; TypeScript-generated decorator accessor functions remain visible in the function denominator.

- Added an authenticated persistent-dashboard starter with reusable live cards, account-filtered SQLite transactions, asynchronous bounded password checks, hashed sessions, expiry and account-wide sign-out. Native SQLite is recipe-local and requires Node 22.13+; no database dependency was added to Redweb. Doctor now checks simple declared minimum Node engine requirements and reports unsupported range syntax honestly.
- Reactive state payloads now defer legacy text/HTML serialization until an explicit binding needs it. Plain TSX data, including native SQLite's null-prototype rows, can update and reconnect without an unnecessary text conversion. Explicit bindings retain their existing payload format.

- Added connection-scoped page authorization before construction/loading and before socket operations, immutable original HTTP context across reconnects/actions, bounded identity lookup, and explicit process-local `server.revoke(principal)`. Revocation invalidates all targets before application abort callbacks and fences late asynchronous work. Protected runtime pages are private/no-store and cannot be statically exported. New `LiveHtmlStartOptions` shortens starter wrappers while preserving identity-option constraints. HTTP abandonment/shutdown now cancels stalled render lifetimes; external application work still requires cooperative cancellation.

- Added explicit action authorization after input validation, with inferred transformed policy inputs, trusted identity context, recoverable permission denials, bounded deadlines, and cancellation signals. Authorization-only actions keep input/context in fixed positions. Validation and authorization share one lifetime primitive; action guards do not imply page protection, passive-subscription revocation, or private shared state.

- Added automatic pending/success/error feedback for browser actions, optional component-scoped `rw-status` slots, per-control duplicate suppression, and a 32-request client cap. Successful forms reset only when the original node/binding/draft remains unchanged. Generated feedback follows surviving keyed nodes and is removed with its control. Disconnected actions/state writes are not queued or replayed; ambiguous failures never claim the action had no side effects.

- Added `@action({ input: schema })` with transformed `ActionInput` types, Standard Schema v1 validation shared with socket contracts, bounded validation deadlines, and disconnect/disposal cancellation before invocation. Invalid input is recoverable without closing the connection; validator bugs remain sanitized server failures. Form serialization now preserves prototype-named fields as data. Real HTTP/WebSocket, browser, and compiled standard/legacy consumer checks cover the new path.

- Added a separate, optional read-only documentation MCP adapter with bounded search, exact-ID Markdown/recipe reads, explicit version labels, and current/legacy stdio support. It is private/unpublished and excluded from the normal Redweb package; real subprocess and packed production-only tests verify that separation.

- Unified website API articles, capability examples, and homepage code with the canonical documentation catalogue. Added individual API/example Markdown pages and a standalone, real-network-tested shared HTTP/WebSocket example. The separate site's importer validates and retains historical release snapshots; human pages, raw recipes, and per-version agent indexes are generated together without a browser framework.

- Added a deterministic documentation catalogue built from canonical Markdown, public declarations, and the initializer's exact recipe files. Complete Markdown applications are extracted, compiled, and exercised with real HTTP/WebSocket tests, including the packed-package and source-free deployment gates. Unreleased content is labelled explicitly; release snapshots are version-pinned and immutable.

- Expanded read-only `redweb doctor` diagnostics to declared CSS/templates, source syntax, and duplicate page/socket/handler registrations, with source locations and actionable JSON output. Imported constants and shared stylesheet roots are understood; dynamic/mutated configurations and bounded-analysis limits are reported explicitly. Unsupported installed TypeScript versions receive a diagnostic instead of crashing.

- Added shared socket contracts using existing Standard Schema validators: inferred client/server payload types, validated handler factories, sanitized inbound failures, and a browser-bundle-safe `redweb/contract` entry. Sender validation preserves original wire inputs, including mutating validators; asynchronous/thenable validation remains inside a bounded error boundary.
- Replaced the socket echo starter with a `/match` route and separate `join`, `move`, and `resume` handlers, shared Zod contract, bounded in-memory sessions, and real-network consumer tests. Zod is a dependency of that starter, not the Redweb runtime.

- Simplified the canonical chatroom to ordinary data state and reactive TSX, with stable message/member keys and no HTML-valued screen state. Added TSX child typings for synchronous owned class components; async component renders remain rejected.

- Added automatic live TSX owner rendering: tracked state reads, batched component-scoped patches, derived expressions/conditionals, keyed element and fragment reconciliation, per-visitor shared-page contexts, reconnect snapshots, cancellation, and bounded retained snapshots. Explicit bindings remain supported without a second conflicting state frame. The TSX counter and realtime starter now use plain expressions without duplicate binding names.
- Fixed development watching after TypeScript exits with code 2; the watcher remains active for subsequent repairs.

- Added `realtime` (default), `chat`, `site`, and `socket` starters with one shared scaffolding path, generated real-network tests, development watch/restart, and compiled production assets. The chat starter uses the existing canonical component rather than duplicating its behavior. Every starter is exercised against the packed package, including execution without the source directory.

- Added explicit existing-project initialization, read-only dry-run plans, structured CLI output, and preflight checks that refuse conflicting paths and linked subdirectories.
- Added read-only `redweb doctor` configuration/version diagnostics and optional real TCP port checks, with stable finding codes and machine-readable results.
- Added package discovery metadata and current capability/fit guidance. The full developer/agent experience release remains in progress; see `docs/AGENT_READY_ACCEPTANCE.md`.

## 0.12.0

- Added `npx redweb init [directory]` to create a minimal TypeScript + TSX application without overwriting existing files.
- Added the reusable `redweb/tsconfig.json` preset so TypeScript builds and editors resolve Redweb's JSX runtime consistently.
- Updated the Live HTML examples to inherit the shared preset and added real-filesystem CLI, generated-project compilation, and packed-package verification.

## 0.11.0

- Added dependency-free server-side TSX rendering through `redweb/jsx-runtime` and `redweb/jsx-dev-runtime`, with fragments, function components, automatic text and attribute escaping, safe URL validation, boolean attributes, and direct interoperability with existing `HtmlFragment` values.
- Added a compiled TSX Live HTML example plus real HTTP, WebSocket, type-checking, and packed-consumer verification.

## 0.10.0

- Added `defineSite()` for shared static-site CSS, metadata, caching, layouts, canonical URLs, public asset copying, and concise page decorators.
- Added synchronous function components, readonly collection typings, direct safe primitive attribute/URL interpolation, and a `codeBlock()` highlighter hook.
- Enabled a bounded heartbeat for Live HTML so chat presence and component disconnect hooks detect half-open browser connections instead of waiting for operating-system TCP timeouts.
- Rebuilt the Live HTML chatroom as a reusable component with a one-time join flow, reserved display names, online presence, bounded shared history, reconnect recovery, and a dedicated message composer.
- Added reusable `@component()` Live HTML classes with nested composition, isolated state/actions, shared request and connection lifecycle hooks, and deterministic cascading cleanup.
- Added explicit safe attribute and URL interpolation for Live HTML.
- Added nested fragment composition and reusable safe code blocks.
- Added page head metadata, non-live ETag/cache handling, and runtime-free static export with content-addressed CSS.
- Replaced the executable `.htmx` sandbox with decorator-first, declarative Live HTML pages.
- Added context-restricted safe server rendering, shallow reactive state, explicit browser actions and bindings, connection/shared page scopes, expiring page sessions, same-origin admission, optional identity binding, HTTPS/WSS, reconnect snapshots, and awaited deterministic cleanup.
- Integrated the browser runtime with `redweb-client` rather than maintaining a second WebSocket client.
- Added runnable server-counter and shared-chatroom examples with real HTTP/WebSocket, browser DOM, load, memory, and packed-artifact verification gates.
- Converted the canonical Live HTML examples to compiled TypeScript so they use `@page()`, `@state()`, and `@action()` directly.
- Added `start(PageClass)`, optional `LivePage` inheritance, inferred colocated templates, and `shared: true` to remove framework setup boilerplate from decorated pages.

## 0.9.0

- Added opt-in pre-upgrade admission, origin validation, secure placement, bounded pending upgrades, transport limits, ordered processing, and route-level heartbeat monitoring.
- Added bounded rooms, expiring application-issued sessions, fixed-step services with retained-lag clamping, and low-cardinality metrics.
- Added opt-in broker adapters with bounded concurrency, event validation, finite deduplication, explicit required/best-effort readiness, and bounded lifecycle cleanup.
- Added readiness/draining, cooperative handler cancellation, and a hard route shutdown deadline.
- Added opt-in version negotiation, stable protocol envelopes/error codes, generated client declarations, a dependency-free client helper, and binary codec hooks.
- Preserved the 0.8 API and wire behavior when new features are disabled, including the public `sendJson` exception contract.
- Added real-network integration, fuzz, load, performance, recovery, and soak verification harnesses.
