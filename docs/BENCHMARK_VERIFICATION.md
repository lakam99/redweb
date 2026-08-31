# Disabled-feature benchmark verification

This is unreleased verification-tool work, not a claim that the current release
performance gate has passed. Production socket/rendering code is unchanged by
this increment.

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
GC or compilation as the cause. Performance acceptance remains open.
