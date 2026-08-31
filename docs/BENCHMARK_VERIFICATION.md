# Disabled-feature benchmark verification

This is unreleased verification-tool and candidate evidence. The bounded
`18b1dfd` qualification below passes the current local regression rule; it is not
a production-capacity or statistical-performance guarantee. Production
socket/rendering code is unchanged by the evidence increment.

## Contract and corrections

Run `npm run verify:overhead -- <baseline-directory> [candidate-directory]` with
both implementations already prepared. Defaults remain 20,000 measured messages,
128 outstanding requests, 2,000 warm-up messages and five alternating paired
trials. The original upper-median calculation and maximum 3% throughput / 5% p99
regressions remain unchanged. Overrides must be safe integers with valid ranges.

Previously, an explicitly unit-stubbed subprocess result containing null p99
produced a successful exit and null regression. The coordinator now validates the
entire JSON response, finite positive measurements, requested workload, exact
delivery, and stable identity before calculating a result. A unit reproduction
is not described as native integration evidence.

Each phase tracks only its bounded outstanding requests and rejects unknown,
duplicate, malformed or late warm-up replies. Measured IDs continue after warm-up
rather than reusing its IDs. This is a **new harness revision**, not a byte-for-byte
repeat of historical traffic: accounting overhead and numeric payload IDs differ.
The same revision measures both sides. Timing still ends inside the final reply
callback; JSON parsing precedes the latency completion timestamp.

Each response phase has a 30-second deadline; each worker has a 120-second
deadline. Client and server cleanup are independently attempted, combined errors
remain visible, and successful output follows cleanup. The shared subprocess
owner rejects truncated output even when a child exits unsuccessfully. A real
child emitting an oversized prefix followed by valid JSON and exit 1 reproduced
the old acceptance hole; it is now rejected with the original failure retained.

Worker identity records the canonical entry/manifest hashes, module version,
Node version, NODE_PATH and client/server-root WebSocket resolution paths. These
are **not** a whole-library fingerprint or proof of the server's actual loaded
WebSocket implementation. Entry/manifest hashes are checked before loading and
after cleanup; changes between trials also fail validation.

## Test boundaries

`npm run verify:overhead:coverage` measures these six modules explicitly:

```text
scripts/benchmark-worker.js
scripts/verify-disabled-overhead.js
scripts/lib/BenchmarkBatch.js
scripts/lib/BenchmarkComparison.js
scripts/lib/BenchmarkWorkload.js
scripts/lib/measureBenchmarkBatch.js
```

The focused suite has 52 tests across five suites: 204 statements, 111 branches,
30 functions and 174 lines, all 100%. Native tests use actual HTTP/WebSockets,
worker processes, real 30-second silent peers and owned files. They cover both
phases, malformed frames, disconnects, duplicate/unknown replies, late warm-up
IDs, module-file mutation and actual paired worker execution. Explicit unit
boundary stubs cover otherwise difficult command and cleanup failures; they are
not labelled mock-free integration. Small fixtures are correctness tests, not
substitutes for default performance measurements. CI retains scoped reports on
success and failure.

Latest focused run: 65.463 seconds on Windows / Node 22.21.0. Report
`coverage/benchmark-tools/coverage-final.json` SHA-256:
`f81715b57b84ead6af52e96ac3d7c1e19a6dc5da4618d4be23506752aaca2ff6`.

| Measured source | SHA-256 |
| --- | --- |
| `benchmark-worker.js` | `07b79d6a32a274c4d5bec93060ca470f34ed50871b45592a20683090cfa56c97` |
| `verify-disabled-overhead.js` | `b09b6278fff001359998b113d6d0d04563658751b58f1bae93fd29cef39aec01` |
| `lib/BenchmarkBatch.js` | `8c387bbe0334cf781836ccc2012910a44c9b030114339304818bd0cf50b7042d` |
| `lib/BenchmarkComparison.js` | `e2b7f8fd4d5ee2b036408cd02b5ace1f33abfad104e48b6d9eefb9baec2f9605` |
| `lib/BenchmarkWorkload.js` | `7b52b5f4695bcff3568b7c0f4fd7aedf66a853edd694bd7ef6756427108759ad` |
| `lib/measureBenchmarkBatch.js` | `09e32385c3918c6e9707471b131c22a11eed80bb100a0e10bbffd1443ec62e0c` |

The shared owner's separately rerun memory-tool scope passes 71 tests with two
POSIX-only skips on Windows: 164 statements, 95 branches, 30 functions and 139
lines, all 100%. Owner source SHA-256:
`805df80e0f1877049d6bdf6847eab4f35187c38f3ca17aa8ef51fcac7a75bacb`.
Report `coverage/memory-tools/coverage-final.json` SHA-256:
`bc1a2faa8e6cb0b4f5248297d04c4e01212803386dd5adebc3f59c1005d3182d`.
Earlier owner maps describe earlier source, not this revision.

## Current bounded qualification

After independent review and the complete local regression exited, one fresh
exact `redweb@0.12.0` installation was reused for exactly two preregistered
comparisons against immutable `18b1dfd`. Each comparison ran five alternating
pairs with20,000 measured messages,2,000 warm-up messages and concurrency128.
All20 workers completed exact warm-up and measured delivery, stable entry/manifest
identities, normal cleanup and empty stderr. No third or replacement comparison
ran; no workload, profiling or coverage override was present.

| Comparison | Baseline messages/s | Candidate messages/s | Throughput regression | p99 regression | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| 1 | 37,525.121 | 37,663.117 | -0.3677% | -5.3204% | Pass |
| 2 | 37,521.080 | 38,192.750 | -1.7901% | -8.2032% | Pass |

Both are below the unchanged maximum3% throughput and5% p99 regressions, so the
predeclared decision is a **bounded PASS**. The desktop was not an isolated
benchmark host. This result does not explain, erase or relabel the historical
4.78495% failure below. Raw report SHA-256 values are
`c2b9d26dd703a0f8ef121973331d0d91bf1bb6a8204dd322dc3c95a9f15647f3`
and `4979301a98f41cdbbb89f24e956c11dcf555719d04401652a9fe85cabbc77817`.

## Retained default performance results

Windows / Node 22.21.0, published `redweb@0.12.0` installed into a newly owned
workspace for each comparison, current checkout as candidate. Both runs used the
same measured implementation entry hashes and unchanged benchmark limits. No
smaller workload or selective trial deletion was used.

| Run end (UTC, 2026-08-31) | Baseline messages/s | Candidate messages/s | Throughput regression | p99 regression | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| 06:26:33 | 40,991.410 | 42,399.336 | -3.4347% | -14.3156% | Pass |
| 06:32:18 | 41,514.163 | 39,527.731 | 4.7850% | 1.2200% | **Fail** |

The second run fails the 3% throughput gate. The first pass does not cancel it;
the cause is under investigation. All trials reported exactly 2,000 warm-up and
20,000 measured sends/replies. Raw trial identities and results remain in
`coverage/benchmark-registry-baseline.json` and
`coverage/benchmark-registry-baseline-final.json`. The latter follows the shared
strict-output fix; the timed worker implementation did not change between runs.
Report SHA-256 values, in the table's order:
`091f82fc80cd94806793c5a00748c2f5c7da125d80155292bf1e55432403bcef`,
`87e003a1719a45b6aae80379dbfdbde2beb8bd9500fb225413e1367056273143`.

Registry archive: `https://registry.npmjs.org/redweb/-/redweb-0.12.0.tgz`;
integrity `sha512-74AOoEmREkoPElYB9nalsN8nLfiPzw1Ap3WYEwxERJqoSGcfYAQhyfpAK2dOyLQtc+A+sAl9fFv0HMuIXWDjEg==`.
Fresh read-only source inspection confirms ws 8.21.3 and Express 4.22.2 on both
sides with matching entry hashes. Candidate client 0.2.0 differs from published
Redweb's client 0.1.0. Socket code also differs; version agreement alone cannot
rule out a regression. Candidate and harness resolve the same WebSocket path,
while the isolated baseline resolves its own copy. These observations identify
controls to investigate, not a proven explanation or permission to relax limits.

The website's Redweb dependency is a junction to the checkout, not an isolated
published baseline. No website, npm or PR release is performed by these tests.

## Bounded controls, not acceptance retries

A predeclared three-control series retained the same five pairs, 20,000 messages,
128-window workload and all trials. Owned workspaces were cleaned normally:

| Control | Throughput regression | p99 regression | Threshold outcome |
| --- | ---: | ---: | --- |
| Checkout versus itself, same path | -1.8540% | 4.4554% | Pass |
| Published package versus itself, same path | -1.7426% | 7.2279% | Fail (p99) |
| Baseline and candidate both independently installed | 4.2695% | -1.6602% | Fail (throughput) |

Report: `coverage/benchmark-controls.json`. The identical-package failure proves
this setup can cross the latency allowance without source differences. It does
not establish the cause of the separate throughput failures. Symmetric package
installation does not eliminate the observed throughput difference.

The critic recommended a more direct topology control: compare the checkout with
a byte-identical owned runtime copy containing a separate WebSocket dependency.
All 113 runtime, entrypoint and WebSocket files matched before/after; other
dependencies used the same checkout fallback. This single unchanged-workload A/A
comparison passed (throughput 0.7865%, p99 -7.3321%). Its full manifest and trials
are in `coverage/benchmark-topology-control.json`; cleanup completed normally.
The pass does not establish that dependency topology caused the A/B failures.
No controls are selectively substituted for the failed release comparison.

Independent review approved the strict-output correction, test time budgets and
documented coverage/source hashes. It confirmed arithmetic and noted measured
phases of approximately 463–534 ms; no retained evidence establishes scheduling,
GC or compilation as the cause. The historical result remains unresolved even
though the separately preregistered current qualification above passes.

## Next diagnostic boundary

Use a bounded CPU-profile comparison to identify where time is spent before
changing the successful message path. Node 22 documents process-lifetime CPU
sampling and profile output on exit in its [CLI reference](https://nodejs.org/download/release/v22.21.0/docs/api/cli.html#--cpu-prof).
Any extended, instrumented workload is diagnostic only, not a replacement for
the default uninstrumented acceptance run.

This caution is consistent with [V8's real-world benchmarking discussion](https://v8.dev/blog/real-world-performance)
and [published VM warm-up research](https://arxiv.org/abs/1602.00602): a synthetic
score or presumed warm-up period does not alone establish representative stable
performance. These sources guide the investigation; they do not diagnose this
specific Redweb result.

The single bounded profile pair completed after the full local suite exited:
500,000 measured messages, 128 outstanding, 2,000 warm-up, unchanged worker,
Node 22.21.0 CPU sampling. Both completed exact delivery and normal cleanup.
Sampled whole-process elapsed attribution was dominated by `writev` (baseline
5.184s, candidate5.019s) and idle (3.578s,3.506s). Direct Redweb socket-frame self
samples were0.375s/0.278s and GC0.094s/0.081s. The critic independently found no
candidate-specific hotspot. About half the `writev` attribution came from client
requests, half from server replies; this is not pure CPU or syscall service time.

This workload is25 times the default and includes startup, warm-up, sorting and
cleanup without phase markers. It does not isolate the original short measured
window, prove the cause, or justify a runtime optimization. Do not repeat long
profiles or alter batching/GC based on this negative finding. A future targeted
investigation should observe the original20,000-message phase explicitly.
Raw profiles in `coverage/benchmark-cpu-diagnostic/` have SHA-256:

- `baseline.cpuprofile`: `34880286661985a48ea30e8c58cbfff861041b2b0baaa6243fc8736761d3b498`.
- `candidate.cpuprofile`: `2ef3e13fc9834ca707071cdf7e531fe1c8c7e586933c75a174d2a65938c90942`.

## Original-phase diagnostic: one fixed ten-worker series

After the `bf01c2a` full regression exited successfully, one predeclared series
used the original 20,000 measured messages, 2,000 warm-up messages, 128-request
window and five alternating pairs. All ten workers completed exact delivery and
normal cleanup. No failed/default acceptance run was repeated or replaced.

The owned diagnostic worker preserves the original CommonJS resolution context.
Three exact-once insertions prepare the profiler before warm-up, wrap the existing
measured batch and close the profiler on completion/failure. Original and transformed
worker bytes are retained. The canonical worker, measurement/accounting helpers,
runtime entry/manifest/source tree and both resolved WebSocket packages are checked
before/after; each phase also records the hashes of actually loaded modules. No
application, socket or timer API is substituted. This is instrumentation, not an
uninstrumented acceptance measurement.

The implementation follows Node's documented
[CPU-profiler start/stop workflow](https://nodejs.org/download/release/v22.21.0/docs/api/inspector.html#cpu-profiler).
The window includes measured-batch construction, response handling, summarization
and completion microtasks; it excludes startup, warm-up and latency sorting.
Profiler setup perturbs execution. The requested interval is 1,000 microseconds,
but each roughly half-second profile contains only 305–316 samples on this Windows
host. About 18–20 ms is attributed to inspector control, and profile duration is
longer than the benchmark's own elapsed interval. Independent review verified
that the first sample is Inspector `post` in every trial and each trial's median
sampling delta is 1,546–1,549 microseconds. The 18.649–20.953 ms profile/batch
span difference is a boundary difference, not an estimate of profiling slowdown
inside the batch. Sampling weights are elapsed
attribution, not proof of pure CPU or syscall service time.

| Trial | Implementation | Measured ms | Profile ms | Samples | Direct Redweb socket-frame self ms |
| --- | --- | --- | --- | --- | --- |
| 1 | baseline | 490.6163 | 509.265 | 316 | 12.372 |
| 2 | candidate | 486.6625 | 507.615 | 315 | 4.637 |
| 3 | candidate | 477.3735 | 496.438 | 309 | 12.433 |
| 4 | baseline | 481.1249 | 500.439 | 309 | 12.485 |
| 5 | baseline | 479.5333 | 499.140 | 310 | 4.622 |
| 6 | candidate | 477.3278 | 497.395 | 309 | 13.904 |
| 7 | candidate | 482.7839 | 501.833 | 313 | 12.445 |
| 8 | baseline | 483.2845 | 503.428 | 312 | 12.416 |
| 9 | baseline | 473.8178 | 493.295 | 305 | 10.854 |
| 10 | candidate | 474.3387 | 494.325 | 307 | 3.098 |

Direct socket-frame attribution sums samples whose actual source URL is under
Redweb's `src/ws/`; it is not inclusive stack time. Per-trial raw frames and
weights remain available rather than relying only on pooled totals. `writev`
accounts for 196.556–246.052 ms and idle for 85.267–124.094 ms across the series;
both distributions overlap between implementations. These profiles do not
identify a consistent candidate-specific hotspot, prove why the original median
failed, justify speculative runtime changes or establish performance acceptance.
Direct Redweb attribution consists of only two to nine self samples per trial.
The critic independently verified all ten profile/phase hashes and worker outputs,
tooling identities and loaded-runtime comparisons, and approved this bounded
negative attribution result rather than a release-readiness claim.
The original 4.78495% throughput failure remains unresolved. No further profiling
series or automatic retry is implied by this result.

Retained directory: `coverage/benchmark-phase-diagnostic/`. Its `report.json`
SHA-256 is `151cb63390c18daf07ccd84ad4181b6b21e55a1ca245c108ebb770a46dc38ec6`.
Every profile and phase-record hash is recorded there, along with all ten original
worker outputs and the fixed order. Diagnostic driver SHA-256:
`ed135f76b5b7a3bbe43b294a8ea89986fc113756d23a4ce11db2aa796e3b3f8e`;
phase helper SHA-256:
`2381d7b28eec21ba6c9b9784426f75e877e7fcfc879058c52ea4282ea46bc851`.
The scripts are retained under ignored `coverage/`, not shipped or claimed as
fully covered production tooling. No acceptance threshold or frozen file changed.

## Verified implementation checkpoint

At `43c6d73`, full pretest/type/regression passed1,098 tests/110 suites in614.552s,
with two POSIX-only skips and all-four100% of the unchanged91-file library scope
(5,449 statements,4,046 branches,978 functions,4,468 lines). Full coverage report
SHA-256: `ce878c849923384e0903a0e424a615dfb3be885046e0dd1bbf5131d1d3d7f681`.
The final source implementation was unchanged during verification; this report's
research/evidence-only additions followed the implementation commit.
Both [PR33365382012](https://github.com/lakam99/redweb/actions/runs/33365382012)
and [push33365378641](https://github.com/lakam99/redweb/actions/runs/33365378641)
passed all Node18/20/22/24 and lifecycle/package/browser jobs. The critic verified
all21 actual remote file blobs and approved this increment, not release readiness.

After the local suite and profile workers exited, sequential resource checks
passed: default load6,643.491 messages/s,6.781ms p99 and contained slow consumer;
default metadata1,881.648 bytes/connection; server recovery all7,400 replies,
peak108.6388% and final96.6147% of warm heap. Client112.8972% remains diagnostic.
HTML load passed200 expired renders/110 clients/8,329,896-byte heap delta; JSX
10,000rows passed48.1ms/1.3MiB. The30s/16-client soak passed all eight trends with
4,368 sent/4,365 received (99.9313%, three missing—not lossless), empty final
registries,100.2593% final warm heap and native handles1→2. This is not a new
60-minute soak. Audit found zero vulnerabilities with TLS verification retained.

Report hashes:

- `coverage/43c6d73-resource-gates.json`: `20c94f067880295c5cae23beb2df57047f2f17792779af12afbf3f42fd5cc13a`.
- `coverage/43c6d73-short-soak.json`: `70f396696b05da057e7c0e258d96335fb89e1ba038c4bc7ee27645cc924dcddf`.
- `coverage/server-recovery-43c6d73/report.json`: `6f82e64382adf0e6c4eebaf17d70460d411dad0862e0ba1d0a093ea0a35334f5`.

Site `caa166f` synchronizes the43c6d73 catalogue locally:98pages/154assets,
real filesystem rollback/HTTP/link/download checks, six tests and100%
line/branch/function coverage across seven documentation modules. It used the
linked checkout while core tests ran, not an isolated published renderer or clean
performance environment. No publication, deployment or merge occurred. Default
throughput acceptance and remaining private-tool coverage remain open.
