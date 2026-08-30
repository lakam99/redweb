# Changelog

## Unreleased

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
