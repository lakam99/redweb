# Multiplayer operations

Redweb exposes small composition points and leaves deployment policy to the game. These examples are deliberately infrastructure-neutral.

## Readiness and shutdown

Expose `socketServer.isReady()` from the HTTP stack used by the orchestrator. On termination, call `beginDrain()` first, stop external placement to the node, then call and await `shutdown()`. New upgrades receive `503` after draining begins.

```js
app.get('/ready', (_request, response) => {
  response.sendStatus(socketServer.isReady() ? 200 : 503)
})

process.once('SIGTERM', async () => {
  socketServer.beginDrain()
  await socketServer.shutdown()
})
```

If `drainHandlers` is enabled, handlers should observe `socket.context.signal` and return promptly. Set the platform termination grace period above the application's maximum cooperative handler time plus `shutdownTimeoutMs`.

## Placement and partitions

The admission `place(principal, request, context)` hook can return another node's `ws`/`wss` URL before upgrade. Keep placement decisions short-lived and retryable. A redirect is not a reservation: the destination must still authenticate, enforce capacity, and reject stale placement.

Treat the distribution adapter as ephemeral fan-out. During broker or network partitions, pause affected matches, continue from one authoritative owner, or reconcile from durable application state. Do not treat adapter delivery or its bounded deduplication window as persistence.

## Capacity signals

Alert on rejected connections, rate-limited messages, full queues, handler failures, active connections, and readiness. Metrics intentionally contain only the route label. Join high-cardinality player, room, and match diagnostics in application logs or traces under the studio's own privacy and retention policy.

Size `maxConnections`, `maxBufferedBytes`, `maxPendingMessages`, room limits, session limits, adapter event limits, and codec byte limits from measured budgets. Run the included verification scripts on the deployment's Node version and instance class before changing those ceilings.

Redweb limits the number and lifetime of session records, but it deliberately does not inspect application session data. Keep that data small, schema-validated, and free of authoritative state that belongs in durable storage.

## Verification

Run `npm test` for unit, real HTTP/WebSocket/WSS integration, fuzz, type-generation, and 100% coverage gates. The additional production gates are:

```bash
npm run verify:load
npm run verify:memory
npm run verify:recovery
npm run verify:soak
npm run verify:overhead -- /path/to/redweb-0.8-baseline
```

The soak defaults to 60 minutes. Shorter durations are useful for CI smoke checks but are not release evidence.
