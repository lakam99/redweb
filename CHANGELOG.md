# Changelog

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
