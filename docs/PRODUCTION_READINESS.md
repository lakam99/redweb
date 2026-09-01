# Multiplayer production-readiness contract

Redweb remains a small transport foundation. Applications own game rules, authoritative state, matchmaking, databases, and identity providers. Redweb owns bounded connection admission, delivery, grouping, lifecycle, and optional composition points.

## Compatibility invariants

- Every production feature is opt-in.
- Existing route, handler, and service subclasses require no source changes.
- The default route, strict routing, IP collision policy, handler dispatch, error hiding, listener ownership, and shutdown behavior remain compatible with 0.8.
- Disabled multiplayer features create no timers or per-connection queues.
- No global mutable registry or mandatory infrastructure dependency is permitted.
- Every timer, listener, queued task, membership, session lease, and adapter subscription has one deterministic cleanup owner.
- User hooks may be synchronous or asynchronous and may not escape as process-level failures.
- Cleanup is bounded, idempotent, best-effort, and continues after individual failures. Owned listeners also terminate incomplete HTTP peers at the route deadline; borrowed listeners remain application-owned.

## Delivery claims

WebSocket provides an ordered byte stream while a connection remains healthy. Redweb does not claim exactly-once delivery. Reconnection, distributed adapters, and application retries can introduce loss or duplication; protocol users must use explicitly scoped sequence identifiers when those cases matter.

## Roadmap gates

1. **Bounded transport:** pre-upgrade admission, origin policy, rate limits, slow-consumer enforcement, bounded ordered processing, payload limits, and route-level heartbeat.

Heartbeat expiry is deferred to the event-loop check phase before terminating a
peer, allowing already-dispatched pong handling to win after a server stall; an
actually silent peer is terminated by the deferred check.
`timeoutMs` is therefore a liveness threshold subject to event-loop scheduling,
not a hard wall-clock resource limit. The deferral owns at most one pending check
per expired connection; bound connections and queues independently.
2. **Multiplayer grouping:** route-scoped rooms, atomic membership cleanup, bounded session resumption, fixed-step services, and vendor-neutral metrics.
3. **Horizontal composition:** draining/readiness, adapter lifecycle, loop prevention, bounded validation, placement hooks, and documented partition behavior.
4. **Protocol and clients:** version negotiation, stable envelopes and error codes, generated client-facing types, binary replication hooks, and operational examples.

## Release gates

- Existing tests and documented examples run unchanged.
- New behavior has unit tests and mock-free HTTP/WS/WSS integration tests.
- Coverage remains 100% for statements, branches, functions, and lines.
- Disabled-feature throughput regression is at most 3%; p99 latency regression is at most 5% on the same machine and Node version.
- Heartbeat uses one scheduler per route, never one interval per connection.
- Every queue, retained session, room, adapter backlog, and deduplication window is finite.
- Broadcast serializes once and remains O(n) in selected recipients.
- Slow clients cannot grow framework-owned memory without bound.
- A 60-minute soak shows no monotonic growth in timers, listeners, rooms, sessions, or queues.
- The blocking `server-steady-v1` reconnect gate requires every storm to retain at most 110% of the same warmed **server** heap after expiry and forced collection. Exact delivery, empty measured registries, unchanged inputs, complete logs and normal worker cleanup are mandatory. Client heap is reported separately; the original shared-process diagnostic remains visible and non-blocking, without relabelling its failures.
- Readiness becomes false before draining and shutdown completes within its documented bound.

The independent senior-review gate rejects releases that weaken any invariant, hide ambiguous delivery semantics, add mandatory brokers or identity libraries, or substitute coverage percentages for race, load, soak, and failure evidence.

See [operations verification](MULTIPLAYER_OPERATIONS.md#verification) for the current commands and the distinction between server acceptance and the original diagnostic. These are required gates, not a statement that every release has passed them; consult the version's [release checklist](AGENT_READY_ACCEPTANCE.md) for recorded results and remaining limitations.

## Horizontal composition contract

- Placement runs before upgrade within the admission timeout. Redirects must use `wss`, contain no credentials or fragment, and may be restricted with `allowedPlacementOrigins`. Plain `ws` placement requires the explicit `allowInsecurePlacement` escape hatch for private development networks.
- Readiness becomes false before shutdown work begins. New upgrades receive `503`; existing connections stop accepting messages.
- `drainHandlers` is opt-in. When enabled, every connection context shares the route drain signal and shutdown awaits tracked work. Application handlers remain responsible for observing the signal; non-cooperating promises cannot be forcibly cancelled.
- Distribution adapters have no framework backlog. Publish and inbound concurrency are finite; publish failure returns `false`; startup, subscription, unsubscription, draining, and close are bounded. Adapter operations receive an optional `AbortSignal`, and late startup/subscription settlement is compensated. Adapters must observe the signal when their external side effects are not otherwise reversible.
- A failed publish marks a `required` adapter unhealthy, makes the route unready, and causes new upgrades to receive `503`; a later successful publish restores health. Best-effort adapters do not affect route readiness.
- Event IDs are deduplicated only inside a finite TTL/size window. Source-node events are ignored to prevent reflection loops.
- Broker partitions and process failure can lose events. Redweb makes no exactly-once or durable-delivery claim; applications own authoritative persistence, reconciliation, tick/sequence semantics, and partition policy.

## Protocol contract

- Negotiation is opt-in and happens before upgrade. Unsupported clients receive `426` plus the finite supported-version list.
- JSON events use `{ v, type, payload, requestId?, sequence? }`. Error events use `{ v, type: "error", error: { code, message }, requestId? }`.
- `requestId` correlates a request and response; `sequence` expresses application ordering. Neither implies acknowledgement, durability, or exactly-once delivery.
- Stable framework codes are generated from `src/ws/protocol-schema.json`; the client declarations and runtime constants share that source.
- Binary replication is a codec hook, not a codec dependency. Size is checked before decode and after encode, and outbound data uses the normal backpressure ceiling.
- Protocol-disabled routes retain their 0.8 wire shapes and allocate no protocol context.

## Resource ownership

- `maxPendingUpgrades` bounds authorization work before a socket is accepted.
- Timed-out admission hooks that ignore cancellation retain their reservation until they actually settle, preventing repeated timeout waves from accumulating unbounded application work.
- Fixed-step services clamp retained lag with `maxRetainedLagMs`; dropped time is observable rather than replayed forever.
- Session count, ID length, and lifetime are bounded by Redweb. Session `data` is application-owned, so applications must validate and cap its shape and byte size before storing it.
- Fully enabled idle routes have a 2 KiB framework-metadata budget per connection. Disabled features retain the legacy path; the performance gate compares against an explicitly prepared, identified release baseline. Historical 0.8 evidence does not establish performance against a newer baseline.
