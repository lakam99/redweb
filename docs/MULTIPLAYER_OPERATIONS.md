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

Adapter lifecycle and publish methods receive an optional final `AbortSignal`. Observe it in broker clients that support cancellation. Redweb compensates late startup and subscription completion, but a publish that the broker has already accepted cannot be recalled.

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

Recovery uses the versioned `steady-v2` protocol: one fixed 1,200-connection preconditioning workload, 200 warm connections, then five 1,200-connection storms, in batches of 50. After each phase it waits 400 ms for expiry, collects twice, and requires empty client/room/session registries. Every storm must retain at most 110% of the **same** warm baseline. It never moves the baseline, subtracts compiled-code bytes, or repeats a failed run until one passes. This is a finite workload, not proof of an indefinite memory plateau.

`REDWEB_RECOVERY_WARM_CONNECTIONS`, `REDWEB_RECOVERY_STORM_CONNECTIONS`, and `REDWEB_RECOVERY_BATCH_SIZE` select positive safe-integer workload sizes; preconditioning always uses the selected storm size. `REDWEB_RECOVERY_STORM_ROUNDS` can increase the five-round minimum. Reports include the selected protocol, phase heaps, counts and every storm's ratio. Smaller custom traffic is useful for functional checks but is not the default release workload.

Set `REDWEB_RECOVERY_PROTOCOL=cold-v1` to reproduce the earlier unpreconditioned protocol (200 warm connections and one storm by default). Its recorded Node 20 failures remain failures; later steady-protocol results do not rewrite them. The revised warm-up is supported by native heap diagnostics showing substantial compiled-code growth after the earlier baseline and by fixed repeated-storm experiments. See the [acceptance work log](AGENT_READY_ACCEPTANCE.md) for exact environments, measurements and outstanding release gates.

For investigation only, `REDWEB_RECOVERY_DIAGNOSTICS=1` adds native V8 space/code statistics. Combining it with an absolute `REDWEB_RECOVERY_HEAP_DIRECTORY` creates exclusive private warm/recovered snapshot files in an existing directory. Snapshots may contain secrets and introduce additional GC/work: use an isolated process/environment, never upload the raw files, and do not treat snapshot runs as acceptance. `scripts/diagnostics/recovery-heap-summary.cjs` accepts the two files and emits only fixed-label numeric aggregates; delete private snapshots after investigation.
