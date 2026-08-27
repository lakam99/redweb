# 0.9.0 verification evidence

Release-candidate measurements were taken on Windows x64, Node 22.21.0, and an AMD Ryzen 7 7800X3D. Performance numbers are machine-specific; the scripts and thresholds are the durable contract.

## Automated correctness

- 289 unit and mock-free integration/fuzz tests pass on Node 18, 20, and 22.
- Statements, branches, functions, and lines are each 100% covered.
- Type declarations compile and generated protocol declarations match their schema.

## Resource and failure gates

- Real-socket load: 32 concurrent clients, 3,200 request/response messages, 6,981 messages/second, 6.58 ms p99, with a paused slow consumer disconnected by the outbound-buffer policy.
- Reconnect recovery: 200 warm connections followed by 1,200 storm connections; retained heap recovered to 104.24% of warm baseline and connection, room, and session registries returned to zero.
- Fully enabled idle-route metadata: 1,756.78 bytes per connection across the median of three 500-connection trials, below the 2,048-byte gate.
- Disabled-feature comparison with Redweb 0.8: throughput improved 1.07% and p99 regressed 0.76% (limits: 3% and 5%), using five alternating 20,000-message trials at concurrency 128.
- `npm audit` reports zero vulnerabilities after upgrading Express to 4.22.2, `ws` to 8.21.3, and patched transitive dependencies.
- The default 60-minute soak sustained 2,108,096 messages across 64 rotating clients. Final heap was 100.02% of the warmed baseline; connection, room, session, and in-flight registries returned to zero; active handles stayed within the one-handle allowance.

All measurements above were rerun on the final release candidate. Shortened soak smoke runs are not counted as release evidence.
