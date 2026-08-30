# Recovery runtime controls — 2026-08-30

Status: a strong JIT-dependent effect was identified in the split load generator.
The original shared-process recovery failure is **not resolved or waived**.
This continues [the split-process investigation](RECOVERY_INVESTIGATION.md).

## Research and predeclared tests

The V8 source bundled with Node 22.21.0 enables bytecode flushing with an aging
threshold of six eligible collections. Forced and heap-profiler collections keep
ages unchanged; the exposed `gc()` function requests a forced collection. Thus two
explicit collections do not guarantee that unused code has aged enough to flush.
These are implementation details of this exact runtime, not portable API promises.
Sources: [flags](https://github.com/nodejs/node/blob/v22.21.0/deps/v8/src/flags/flag-definitions.h),
[age handling](https://github.com/nodejs/node/blob/v22.21.0/deps/v8/src/heap/heap.h),
[GC extension](https://github.com/nodejs/node/blob/v22.21.0/deps/v8/src/extensions/gc-extension.cc),
[V8 bytecode-flushing explanation](https://v8.dev/blog/v8-lite).

Three runs were declared before measurement, executed once each, sequentially:

1. `node scripts/diagnostics/recovery-split.cjs baseline` — a fresh same-source control.
2. `node scripts/diagnostics/recovery-split.cjs trace` — both workers use
   `--trace-gc --trace-flush-code`, with additional sample markers.
3. `node scripts/diagnostics/recovery-split.cjs client-jitless` — only the load
   generator additionally uses `--jitless`; the server retains normal compilation.

All use `--expose-gc`. No inherited Node options or coverage instrumentation enter
the measured workers. Windows, Node 22.21.0, V8 12.4.254.21-node.33 and ws 8.21.3
are unchanged. All three reports contain identical source fingerprints, also
checked at each run's completion. No test suite ran alongside the measurements.
The diagnostic changes no original acceptance script, workload, warm-up or budget.

The fixed workload remains 1,200 preconditioning connections, 200 warm connections,
five rounds of 1,200, batches of 50, connection-cleanup barriers and 400 ms settling
with two explicit collections. Every run verified all 7,400 exact reply IDs and
empty measured registries at every phase. Both workers exited in every run.

## Measurements

Heap bytes, captured before allocating each sample's subsequent V8 statistics:

| Phase | Baseline server | Baseline client | Traced server | Traced client | JIT-control server | JIT-disabled client |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Preconditioning | 10,171,000 | 6,568,792 | 10,174,984 | 6,571,376 | 10,186,408 | 5,566,904 |
| Warm | 10,190,632 | 6,539,864 | 10,182,928 | 6,504,752 | 10,190,344 | 5,570,608 |
| Storm 1 | 10,472,704 | 6,767,512 | 10,453,688 | 6,773,968 | 10,455,296 | 5,573,200 |
| Storm 2 | 10,866,832 | 7,235,712 | 10,777,240 | 7,198,296 | 10,774,848 | 5,573,320 |
| Storm 3 | 10,888,784 | 7,339,704 | 11,079,576 | 7,321,224 | 11,000,000 | 5,575,240 |
| Storm 4 | 11,067,616 | 7,365,128 | 10,882,944 | 7,362,680 | 11,112,632 | 5,575,752 |
| Storm 5 | 9,911,296 | 7,388,792 | 11,209,464 | 7,343,488 | 11,109,832 | 5,575,752 |

The like-for-like comparison is baseline versus client-JIT control, **not** trace
versus JIT control. Baseline client growth after warm-up was **848,928 bytes**
(112.98082039626512% of warm); the JIT-disabled client grew **5,144 bytes**
(100.09234180541873%). Baseline client code-and-metadata grew 504,608 bytes;
the JIT-disabled client's corresponding value stayed exactly 2,058,560 bytes.
Client bytecode-and-metadata, external memory and array buffers remained unchanged
after warm-up in both runs.

This is strong evidence of **JIT-dependent growth in this split workload**. It is
not exact accounting of every retained byte: code/space statistics overlap, and
disabling JIT also changes execution speed, allocation and collection behavior.
The control additionally reports `Warning: disabling flag --expose_wasm due to
conflicting flags`; that warning is preserved, not suppressed. The workload does
not exercise WebAssembly. This is neither a throughput result nor a recommendation
to disable JIT in production. See [V8's description of JIT-less execution](https://v8.dev/blog/jitless).

The baseline server peaked at 108.60578617695154% and finished at
97.25889424718703% of its warm heap. Its bytecode-and-metadata again fell late,
from 908,584 to 205,248 bytes. That event **did not recur in the traced run**:
server bytecode remained 908,584 and final heap reached 110.08095117632178%.
The normal-JIT server paired with the JIT-disabled client peaked at
109.05060712376344% and finished at 109.0231301318189%, also without the late
bytecode drop. Retain all three observations; do not select the smallest result.

## Complete trace and its framing limitation

The traced server's stdout contains 12,979 bytes and the client's 12,257 bytes;
both stderr files are empty. All file lengths and SHA-256 values were independently
rechecked. Natural successful shutdown now drains output before exit; abrupt
coordinator loss retains orphan protection and the coordinator retains bounded
forced cleanup. Output is limited to 16 MiB per stream: overflow or a write failure
invalidates the run instead of silently truncating successful evidence.

V8's buffered native output and JavaScript sample markers interleave, occasionally
inside a native line. **Raw marker adjacency is not a trustworthy timeline.**
The original byte logs are preserved unchanged. For the counts below, remove only
the fourteen exact `[rw-phase ...]` marker records (including their line endings)
per worker from an in-memory copy. The reconstructed native records all have the
expected process prefix and monotonically increasing V8 millisecond timestamps.
No original bytes/files are overwritten, and no marker-based phase timing claim
is made.

| Reconstructed native records | Server | Client |
| --- | ---: | ---: |
| Scavenges | 37 | 41 |
| Mark-Compacts | 19 | 16 |
| Mark-Compacts labeled `testing` | 14 | 14 |
| Mark-Compacts labeled `finalize incremental marking via task` | 5 | 2 |
| Flushing summary records | 19 | 16 |
| Total flushed SharedFunctionInfos reported | 0 | 0 |

Server natural-major timestamps: 454 / 6,299 / 8,275 / 10,259 / 12,244 ms.
Client natural-major timestamps: 1,323 / 4,201 ms. The fourteen testing collections
per worker agree with two explicit calls for each of seven phases. The zero
flushing totals and stable bytecode measurements are consistent with the V8 aging
mechanism, but do not prove what caused the earlier untraced bytecode drop.
No retry was made to obtain the desired flushing event.

## Evidence locations

Each directory contains `report.json`, `samples.ndjson`, and separate server/client
stdout/stderr logs. Reports include flags, versions, identities, source hashes,
per-phase memory views, delivery counts and output-file hashes. Times are UTC.

| Mode | Local directory under `coverage/` | Start–end on 2026-08-30 |
| --- | --- | --- |
| Baseline | `recovery-split-RqlKQM` | 19:20:24.892–19:20:37.704 |
| Trace | `recovery-split-bg0hV9` | 19:20:42.205–19:20:54.990 |
| Client JIT-disabled | `recovery-split-z9JA5J` | 19:20:59.831–19:21:13.483 |

Report SHA-256 values, respectively:

- `212f24669b0240eff1680cb9aa91cef4690465f3203b6b81e6f8da50981d9a08`
- `88fa6323feded06fea25f78169c88f79d7f4dcead997730d078203f8ee132f02`
- `21b6c73bac8789c4f234363416df9fd740c0c7208b977e821f83c9377ccd7521`

Trace stdout SHA-256 values:

- Server: `29be4f852458b55af3ce6b77a9fd4b9b8213430c38e7c827c66231f2ae67d38c`
- Client: `e006731ada264a63220e4dcafa6da080c049699e59c3f7caaabd2572cf14b4a2`

## Verification and remaining work

Twenty-four focused tests pass, combining unit tests with real child processes
and real HTTP-upgrade/WebSocket traffic. New cases verify exact mode flags,
complete output/hashes, cap failures, exclusive evidence creation and an 8 MiB
queued-output shutdown fixture. That last test also passed before the drain fix
on Windows; it must not be described as a reproduced POSIX truncation bug.

Native child-aware diagnostic coverage remains below its unchanged 100% gate:
76.03% statements/lines, 95.57% branches and 91.66% functions. The worker is at
100% statements/lines/functions and 97.82% branches; its connection-barrier timeout
branch remains uncovered. Coordinator/CLI and failure paths also remain uncovered.
All behavior tests pass; the separate coverage command correctly exits nonzero.
No exclusions or relaxed thresholds were introduced.

Full-suite verification failed: **777 tests passed and one failed** across
76 suites (75 passed, one failed), in 415.09 seconds. The failing case is
`owned-http-shutdown.integration.test.js`: successful page cleanup with `live=true`
timed out waiting 500 ms for the client's WebSocket close event, after application
shutdown and incomplete-HTTP-peer closure had completed. Its cause remains
unestablished; it is not dismissed as a timing flake or attributed to these
diagnostics. No retry was used to replace this result. Pretest/generated-document
and TypeScript gates passed. Instrumented-library coverage was 100% for statements,
branches, functions and lines, but that does not override the behavioral failure
or the separate diagnostic-tool coverage gaps above.

Read-only critic inspection confirmed that the client close listener was installed
before connection readiness, so no obvious missed-listener race explains the
failure. Server shutdown bounds termination attempts but does not await the remote
client's close notification. Endpoint state and error timing were not captured at
the deadline; those observations are needed before attributing this failure.
Final documentation generation/TypeScript checks passed, followed by 28 focused
documentation and diagnostic tests across three suites. That scoped pass does not
replace the failed full-suite result.

The senior critic independently checked mode isolation, cleanup, report/log hashes,
delivery/registry counts, reconstructed trace counts and the inference boundaries.
There was no actionable evidence-integrity finding after the drain fix.

The next causal investigation, if continued, should identify which compiled
functions, feedback structures and retaining paths account for the client growth
under normal JIT. The paired result does not establish an exact object-level cause
or resolve the original shared-process CI failure. No further repeated benchmark
is justified merely to obtain a smaller number or a flushing event. Original
acceptance limits, runtime/library sources, dependencies, npm links, publication
and deployment remain unchanged. No raw heap snapshots were taken.
