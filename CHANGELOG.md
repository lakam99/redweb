# Changelog

## Unreleased

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
