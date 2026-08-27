# 0.9.0 verification evidence

Release-candidate measurements were taken on Windows x64, Node 22.21.0, and an AMD Ryzen 7 7800X3D. Performance numbers are machine-specific; the scripts and thresholds are the durable contract.

## Automated correctness

- 281 unit and mock-free integration/fuzz tests pass.
- Statements, branches, functions, and lines are each 100% covered.
- Type declarations compile and generated protocol declarations match their schema.

## Resource and failure gates

- Real-socket load: 32 concurrent clients, 3,200 request/response messages, 6,241 messages/second, 9.18 ms p99, with a paused slow consumer disconnected by the outbound-buffer policy.
- Reconnect recovery: 200 warm connections followed by 1,200 storm connections; retained heap recovered to 104.11% of warm baseline and connection, room, and session registries returned to zero.
- Fully enabled idle-route metadata: 1,684.66 bytes per connection across the median of three 500-connection trials, below the 2,048-byte gate.
- Disabled-feature comparison with Redweb 0.8: throughput improved 0.14% and p99 regressed 1.21% (limits: 3% and 5%), using five alternating 20,000-message trials at concurrency 128.
- `npm audit` reports zero vulnerabilities after upgrading Express to 4.22.2, `ws` to 8.21.3, and patched transitive dependencies.

The required 60-minute soak result is recorded here only after the default `npm run verify:soak` completes; shortened smoke runs do not satisfy that release gate.
