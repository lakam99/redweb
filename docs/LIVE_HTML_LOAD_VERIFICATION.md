# Live HTML load-verifier correction

This unreleased increment changes verification tooling, not Redweb rendering or
client runtime behavior. It does not resolve the separate disabled-feature
throughput discrepancy documented in `BENCHMARK_VERIFICATION.md`.

## Defects and correction

An unchanged `getPage` helper was executed against an actual local HTTP server
returning malformed bootstrap JSON. It emitted an uncaught `SyntaxError` while
its promise remained unsettled. The probe used the exact original helper source
without replacing HTTP, promises or event behavior. The old helper also lacked
response deadlines, body bounds and aborted-response handling.

`readLiveHtmlPage` now bounds the response at10 seconds/1MiB, catches parsing and
configuration failures, and independently closes the request and response. Native
request closure has a five-second observation bound; failures retain their causes.
Requests use `agent:false` so this verifier owns non-pooled HTTP transports. That
is a harness change: heap deltas are not byte-identical repeats of historical
pooled-request measurements, nor evidence of a rendering optimization.

`LiveHtmlLoadClient` keeps every actual WebSocket created by RedwebClient until
closure is confirmed. Opening has a native five-second handshake timeout and a
ten-second connection bound. Cleanup reuses the existing socket helper's bounded
graceful-close/forced-termination path. Unexpected disconnects, protocol errors
and malformed patches latch failures instead of disappearing in listener error
handling. Concurrent request and previously latched client failures remain visible
alongside cleanup failures; the critic's combined-error finding has a regression.

The coordinator settles parallel acquisition before proceeding, retains clients
until successful closure, attempts every cleanup independently, requires explicit
GC, and emits success only after server shutdown. A single broadcast establishes
delivery, not ordering; the verification label now says that precisely.

## Preserved acceptance

- 200 initial renders; pending-session count and expiry.
- 110 live clients; initial patches, joins, all-client presence, capped visible
  membership, and one broadcast delivered to every client.
- Session TTL1,000ms, maxSessions500, the same three GC calls and50ms settling
  pause, disconnected-session expiry and24MiB post-cleanup heap budget.

No workload, production option or acceptance threshold was relaxed. Native tests
separately establish ownership mechanics; they do not replace clean measurements.

## Verification evidence

Windows / Node22.21.0:54 tests across three suites pass in25.128 seconds, with
all-four100% coverage across the coordinator and two helpers:195 statements,
49 branches,52 functions and139 lines. The maintained command is
`npm run verify:live-html:load:coverage`. CI runs it with20-minute supervision and
retains reports on failure or success; the separate default gate has four minutes.

Native tests use actual HTTP/WebSockets/processes for valid/malformed/missing/
oversized/aborted/silent responses, malformed patches/protocol messages, server
errors, unexpected disconnects, unanswered upgrades, paused close handshakes,
missing-GC rejection and the unchanged full CLI workload. Explicit boundary
units cover synchronous throws, cleanup failures, timeout policy, stage failures,
heap-budget rejection and suppression of success after failed shutdown.

The first unanswered-upgrade fixture incorrectly expected an upgraded raw HTTP
peer to fully close when the client closed. A native probe confirmed local
WebSocket CLOSED(3), server readable-ended=true and writable-ended=false. The
fixture now consumes the FIN and ends its own half-open writable side; it does
not answer the upgrade or weaken the assertion about client ownership. HTTP and
WebSocket test budgets include acquisition, operation and all cleanup phases.

The critic approved both corrections and the final scope. Source SHA-256:

| Source | SHA-256 |
| --- | --- |
| `scripts/verify-live-html-load.js` | `345610cc75f6cf0f14ed5c3bb203fa68228dabb6d7b088ca208c8c6ce934e72b` |
| `scripts/lib/readLiveHtmlPage.js` | `bc28f4e2319e1a50517937f1c61e92406ffa4bf1f84294cc595fc420bb03fe25` |
| `scripts/lib/LiveHtmlLoadClient.js` | `d8df0f083d531d0f1e2cbad2ca83f80eb19f5238147ca18ff505ec057134df61` |

Report `coverage/live-html-load-tools/coverage-final.json` SHA-256:
`7d3ca3f938dc7dca75919add49808f538cebbb53ecef2539ed1cf24d9985b049`.
After the focused suites exited, one clean default run passed200 renders/110
clients with6,824,576-byte post-cleanup heap growth against24MiB. This is a scoped
increment, not final release approval or a replacement for the remaining full
regression/hosted/package gates. No publication, deployment or merge occurred.
