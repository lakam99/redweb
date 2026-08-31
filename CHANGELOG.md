# Changelog

## Unreleased

Next package version: `0.13.0` (not yet published).

- Reuse shared terminal-report handling in browser verification to preserve retained-workspace identity and retry late recording failures with failed status. Correction is best-effort: persistent write failures may leave stale evidence, but the command still fails. Release the application listener's handle after uncertain shutdown without claiming successful cleanup. Combine maintained coordinator/helper coverage with unchanged native browser workloads; keep incomplete installed-client coverage visibly failed and linked-source testing explicitly opt-in.

- Preserve package-verification failures even when dependencies reject without an Error. Close every acquired example server independently after partial startup or render failures, retain uncertain cleanup, and announce success only after workspace cleanup. Add maintained authored coverage with unit fault checks and the complete real isolated-package/browser workflow; consumer assertions remain unchanged.

- Bound and retain development-verifier page acquisition, handle port reservation errors, and preserve primary failures through independent watcher/page cleanup. Reuse the existing page owner and error helpers; add authored coordinator coverage with real generated-app rebuilds, HTTP/WebSocket faults and natural process-exit checks. Runtime and acceptance workloads remain unchanged.

- Preserve concurrent refresh-verification failures, including rejected non-Error values, page closure, socket release and coverage uploads. Add maintained authored coverage of both private refresh helpers with failure units and real Chromium/HTTP integration; keep rendering runtime, browser assertions and acceptance limits unchanged.

- Preserve the original dashboard verification failure and workspace-retention state when shutdown and handle release both fail. Add maintained direct verifier coverage with explicit fault units, real Chromium/SQLite/authentication checks and adverse-process/filesystem integration; keep application behavior and acceptance limits unchanged.

- Preserve actual plain/instrumented browser back-forward-cache observations in refresh verification reports, separately from required behavioral parity. Add unit and real-browser report checks; do not equate ordinary history navigation with a cache restoration or change runtime behavior.

- Add maintained authored-source coverage for the unchanged browser runtime-frame and page-ownership verification helpers, including anonymous callbacks. Reuse the canonical real-browser cases and preserve their workload; retain native-converter measurements separately where their function inventory is incomplete.

- Retain original-client coverage worker files outside disposable workspaces before parsing or cleanup. Preserve primary failures and retained-workspace metadata when terminal report writes fail, reusing shared summary handling. Add scoped coordinator coverage and real Vitest failure-path checks without changing runtime behavior or coverage thresholds.

- Clarify initializer and generated README installation steps for unpublished builds: install the matching tested Redweb tarball before development, without substituting an older registry release. Keep ordinary installation simple for published releases.

- Harden soak verification with exact per-socket reply accounting, unexpected-disconnect failures, immediate socket ownership, guarded traffic/sample timers and independent cleanup. Reject undersampled runs and unsafe timer/counter capacities; preserve original traffic, sampling and acceptance limits. Compare the 99% delivery and 110% heap boundaries with exact integer arithmetic, retain missing replies and raw reported ratios, and add maintained unit/native verification-tool coverage.

- Validate every row and enclosing tag in the JSX performance gate, not just row counts and one escaped label. Preserve the timed workload and memory limits, add external CI supervision, and maintain separate unit/real-CLI coverage of the verifier at all-four 100%.

- Bound Live HTML load-verification HTTP responses and connection/close waits; require explicit GC, validate bootstrap/patch data, and retain actual sockets through confirmed cleanup. Preserve concurrent protocol/request/cleanup failures and report success only after server shutdown. Keep the 200 expired renders, 110 live clients, sampling sequence and 24 MiB limit; HTTP verification now owns non-pooled connections. Add maintained unit/native HTTP/WebSocket/process coverage without changing rendering runtime code.

- Harden disabled-feature benchmarks with exact warm-up/measured reply accounting, finite-result and stable input-identity checks, bounded workers, and independently attempted socket/server cleanup. Preserve the 20,000-message/128-window/five-trial defaults and 3%/5% limits; retain every trial. Add separate unit and real-network/process coverage at all-four 100% across six benchmark modules. Strict subprocess output now rejects truncation on unsuccessful exits too. Coverage success does not waive a failed performance comparison.

- Reject non-finite load limits and unknown, duplicate or cross-client replies. Preserve the default workload and performance limits, wait for owned socket closure, attempt all cleanup after partial acquisition, and retain combined verification failures. Add maintained unit/real-network coverage and preserve load/package CI evidence. Fix browser readiness checks that dereferenced a heading before it existed during navigation, with native-browser regression checks.

- Reject invalid memory-measurement workloads and malformed, mismatched or truncated worker results. Bound worker execution, retain partially connected clients for cleanup, and report success only after owned cleanup completes. Preserve default sampling, trial order and acceptance limits; retain nested cleanup errors in diagnostics.

- Fix example-build verification accepting invalid compiler options or configurations that emit no runnable JavaScript. Normalize Windows diagnostic paths and report skipped output clearly. Require complete original-source coverage for the example, protocol-type and documentation generators through real compiler/CLI/filesystem checks.

- Keep the first timeout or cancellation terminal across later admission/authorization checkpoints, including reentrant abort listeners. A delivered timeout can no longer permit a later stage just because a clock sample remains below the nominal deadline. Retain pending-work capacity until actual settlement.

- Require complete authored-source coverage for incremental page/component/socket templates and standalone rendering/room examples, using unchanged real-network acceptance against normal and instrumented builds. Preserve verification failures while independently attempting socket and server cleanup.

- Adopt the independently reviewed server-focused recovery check as blocking CI acceptance, with fixed 7,400-exchange workload, 110% server budget and exact delivery/cleanup checks. Retain the unchanged shared-process measurement as an explicitly non-blocking diagnostic with raw outcomes and evidence; historical failures are not relabelled as resolved.

- Fix private diagnostic compatibility with older Node trace flags and legacy heap-snapshot streams. Reject code logging when source metadata cannot be suppressed; retain existing recovery thresholds and privacy checks. Snapshot output-limit tests now use a small owned process.

- Simplify unreleased quickstarts to install the matching Redweb tarball with its published client dependency. Verify the printed commands through real isolated npm installation; retain a separately tested optional contributor-link workflow. Versioned release instructions remain unchanged.

- Extend explicit packed client/server verification to reuse the unchanged full browser acceptance suite and frontend/refresh coverage drivers. Keep runtime dependencies inside the isolated consumer, fingerprint copied test inputs and original package files, and retain reports after workspace cleanup. External test tools are linked individually; this does not change ordinary registry installation or claim full original-client-source coverage.

- Generated network-test cleanup now terminates its owned sockets instead of waiting for an uncooperative peer's closing handshake. Graceful-disconnect assertions still explicitly close and await their sockets. A real paused-peer regression checks this boundary; the earlier intermittent documented-chat timeout remains unexplained.

- Integrated published `redweb-client@^0.2.0` and updated the dependency lock. Both registry and explicit local-candidate package verification check installed client integrity/export paths/bundle fingerprints and run the same native browser regressions. Normal application setup no longer requires a separate client checkout or linking; contributor linking remains optional.

- Added shared original-source client coverage across Vitest and native Chromium, preserving actual test discovery, per-realm reports, input/tooling hashes and separately auditable Node/browser contributions. Source-built plain bundles must match the tested client build. Fixed disposed-client sends/requests entering an unusable queue and simplified an unreachable empty-entry guard under the dense-queue invariant. Unit and real-WebSocket regressions pass; authored coverage reaches all 791 statements, 521 branches, 125 functions and 659 lines without lowering thresholds. This does not claim the separate Node-only V8 command passes.

- Consolidated browser rendering, keyed DOM updates, action feedback and delegated form behavior in the optional `redweb-client/live-html` entry. Redweb's generated bootstrap now only imports and mounts it. Published client 0.2.0 and the updated dependency lock support ordinary installation; `npm link` remains an optional contributor workflow.
- Added idempotent page mounting/disposal, including protection against mounting again during a connection callback and against resetting drafts after disposal during a reply callback. Real-browser regressions exercise both cases.

- Add a separate original-TypeScript starter coverage gate with zero-seeded module maps, source/compiler/output hashes, real plain/instrumented process tests and retained V8 evidence. Keep remaining dashboard failure callbacks visible rather than excluding them. Extend real default-port, standalone chat, dashboard capacity/aborted-upload and graceful startup checks; production application code is unchanged.

- Run starter, executable-documentation and top-level package verification commands through one bounded subprocess owner, including native archive extraction. Preserve failures and report uncertain cleanup; a non-Error thrown value can no longer become a successful check or interrupt cleanup through coercion. Bound dashboard browser operations and close late-created pages. Add real subprocess/file-lock regressions and a scoped package-tool coverage gate.

- Give every starter a source-mapped `test:coverage` command with development-only c8. Expand chat domain/reconnect/identity tests and socket duplicate-join/unknown-session/capacity tests. Exercise actual application entrypoint failures using owned listeners; record all-starter coverage as run-specific measurement evidence, not a claim of complete application coverage.

- Extend real-browser coverage to development refresh under its self-only script policy; instrumentation no longer requires dynamic evaluation. Remove a redundant stopped-state check only where the unchanged generation already proves it. Harden verification uploads and pending native listener cleanup, with real HTTP/TCP regressions.

- Measure 100% of the complete emitted Live HTML browser runtime with the existing real-browser coverage collector. Reuse canonical morph/action cases and add actual protocol/state/input/reconnect checks; this does not instrument the imported client package or change production behavior.

- Extend the generated-browser coverage gate to action feedback: exact emitted source (including its shared state machine), real HTTP/WebSocket acceptance, and native-DOM ownership cases run plain and instrumented. No production behavior or browser instrumentation is shipped by this verification increment.

- Preserve exact selected option identities when values are duplicated, including keyed moves and server-authored default changes. Add 100% generated DOM-morph coverage in real Chromium plus a live HTTP/WebSocket selection regression; no browser API mocks or runtime instrumentation is shipped.

- Add a separate 100% CLI entrypoint coverage gate using real initializer, doctor and incremental-generation integrations; bound initializer test subprocess execution.

- Added task-oriented guides for private realtime dashboards, JSX without React, chat presence, typed WebSocket contracts and shared HTTP/WebSocket listeners. Their setup and selected source come from the same canonical recipes; dashboard setup now provisions an explicit account after installation. Versioned Markdown remains usable without an agent-specific service.

- Simplified the README around the first working counter and a shared HTTP/WebSocket application. Setup commands and both code blocks are generated from the same version-aware recipes; missing, duplicated, reversed or overlapping regions fail before writes. Historical migration guidance remains available in a canonical guide.
- Added the `http-ws` starter with one explicitly owned HTTP/WebSocket listener, separate raw message handlers, shared bounded entrypoint cleanup, and real network/partial-peer/failing-cleanup tests. It replaces the separately maintained shared-server snippet and verifier. HTTP service callbacks now infer Express request, response and next types instead of requiring manual annotations.

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
