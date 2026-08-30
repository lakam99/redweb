# Client deoptimization investigation — 2026-08-30

Status: GC-dependent code invalidation identified in the measured client;
**original recovery acceptance remains open**.
This continues the [client compilation census](RECOVERY_CODE_CENSUS.md).

## Predeclared method

One measured run, after tests and senior critic preflight:

```sh
node scripts/diagnostics/recovery-split.cjs client-deopt
```

This adds only `--log-deopt` to the earlier client-code mode. The worker source,
seven phases, 7,400 connections, batch size, settling, explicit collections,
server policies and original recovery limits remain unchanged. Only the client
is logged; the server retains normal flags. No concurrent tests or coverage
instrumentation enter measurement. Source-text logging remains disabled.

The pinned [V8 logger](https://github.com/nodejs/node/blob/v22.21.0/deps/v8/src/logging/log.cc)
distinguishes `dependency-change` from `deopt-eager` and `deopt-lazy`. A dependency
invalidation record does not prove an active stack bailed out. The logged code
address is correlated with earlier creations, following native `code-move` events.
Unknown moves clear stale destination associations; unmatched events stay counted
as unmatched. Raw deoptimization locations are not published. Reasons outside a
small known-label allowlist stay counted as unclassified. Native warm/final
boundaries determine the interval by log order, not by adjacent JavaScript output.
Zero record counts in earlier `client-code` logs cannot establish absence of
deoptimization: those runs did not enable `--log-deopt`. This run cannot
retroactively identify why every compiled version changed in earlier runs.

The [collector implementation](https://github.com/nodejs/node/blob/v22.21.0/deps/v8/src/heap/mark-compact.cc)
marks code with the reason `weak objects` when an embedded weak object is unmarked,
then clears embedded objects from that code. A separate
[dependency mechanism](https://github.com/nodejs/node/blob/v22.21.0/deps/v8/src/objects/dependent-code.cc)
uses `code dependencies`. Neither reason identifies a particular retained user
object. The [deoptimizer](https://github.com/nodejs/node/blob/v22.21.0/deps/v8/src/deoptimizer/deoptimizer.cc)
routes these invalidation records to the native logger. These details apply to
the pinned Node 22.21.0 / V8 12.4.254.21-node.33 runtime, not every Node release.

The census does not model code deletion, prove simultaneous code survival, or
calculate retained size. Deoptimization records report instruction-stream object
size; creation records report instruction size. Those values are intentionally
not added, equated or subtracted from the heap measurements.

## Results

The single run acknowledged all 7,400 exact reply IDs and left client tracked
connections and server clients/rooms/sessions empty at every sample. Both workers
exited. Source fingerprints, output lengths and hashes were independently
rechecked; reparsing the serialized census exactly reproduced the report.

Within the native after-warm/after-final window (2,950,836–12,789,228 microseconds),
V8 logged 856 code creations and **703 deoptimization/invalidation records**:

| Record kind | Reason | Records |
| --- | --- | ---: |
| Dependency invalidation | `weak objects` | 698 |
| Eager bailout | `wrong map` | 4 |
| Eager bailout | `not a Smi` | 1 |

There were 813 such records over the whole log: 109 before the warm boundary,
703 in the window and one at/after the final boundary. All interval code addresses
matched known optimized creations, including through 116 logged code moves;
there were no unmatched moves or unclassified reason labels. Fifty-three interval
records have unclassified source/function labels: matching a code address is not
the same as classifying its printable name. No records were dropped to make the
named-source totals look complete.

### The handshake function's replacement sequence

`ws.initAsClient` has four optimized code creations for one SharedFunctionInfo
identity. Each specific code address is subsequently invalidated with the reason
`weak objects`, before the next version is created:

| Version | Created at (V8 microseconds) | Instruction bytes created | Invalidated at | Reason |
| --- | ---: | ---: | ---: | --- |
| 1 | 5,581,865 | 16,212 | 6,867,589 | `weak objects` |
| 2 | 7,886,535 | 15,612 | 8,876,052 | `weak objects` |
| 3 | 9,846,472 | 14,576 | 10,821,681 | `weak objects` |
| 4 | 11,807,985 | 15,228 | 12,784,300 | `weak objects` |

Together with the pinned collector code above, this identifies garbage-collector
dependency invalidation as the mechanism behind these observed optimized-version
replacements. It is materially more specific than merely noticing code growth.
It does **not** identify the precise weak referents, prove which collection was
forced versus natural, prove simultaneous survival of the versions, or establish
that all heap growth comes from code. No new GC trace or heap snapshot was taken.

### Heap observations, not an acceptance result

| Phase | Server heap bytes | Client heap bytes | Client code-and-metadata bytes |
| --- | ---: | ---: | ---: |
| Preconditioning | 10,174,352 | 7,030,968 | 2,860,489 |
| Warm | 10,193,960 | 7,005,152 | 2,834,367 |
| Storm 1 | 10,475,080 | 7,241,416 | 2,985,665 |
| Storm 2 | 10,859,504 | 7,685,000 | 3,276,065 |
| Storm 3 | 10,854,912 | 7,800,448 | 3,336,345 |
| Storm 4 | 11,058,200 | 7,840,416 | 3,346,105 |
| Storm 5 | 9,818,424 | 7,843,832 | 3,330,883 |

Client heap grew 838,680 bytes and code-and-metadata grew 496,516 bytes after
warm-up. Peak/final client heap was 111.97233122136393% of warm. Client bytecode
was 756,440 at warm and 756,544 thereafter; external memory (2,331,012 bytes) and
array buffers (35,458 bytes) stayed constant after warm-up. Server peak/final
ratios were 108.47796145953093% and 96.31609305902711%. Logging and the existing
native boundaries perturb execution: these observations do not replace the
original shared-process acceptance gate. No statistics were subtracted or limits
changed to produce a pass.

### Retained evidence

- Tooling commit: `8b4694c`, branch `codex/agent-ready`.
- UTC run: 2026-08-30 20:15:13.595–20:15:26.483, Windows/Node 22.21.0/ws 8.21.3.
- Local directory: `coverage/recovery-split-xeBAYE` (report, samples and four logs).
- Report SHA-256: `fdb0626a8fb87425eb0d9384f74066fe3fbbf045c67a4b02a94bc2012262f6e2`.
- Client stdout: 521,311 bytes; SHA-256 `bbba488633697b70c7ac35e7c0b1821d1008f542af63005710947244f1732bf8`.
- Other three logs: empty and complete, hashes verified.
- Code parser SHA-256: `44dae45083bc6a55eed71cb5840dd6ecca4e2c5a2582b0b90bb35e2908af1d5b`.
- Deoptimization parser SHA-256: `a244196245fb32c3c4ff30a9d70e15fc20b946910e7012334de0d68af99b465b`.

The raw local logs contain addresses, paths and code labels; they are not public
sanitized artifacts. The version-controlled report contains selected known-code
labels and numeric evidence instead.

## Verification

Seventy-nine focused tests across five suites passed before measurement, including
unit tests and real HTTP/WebSocket/process integration. A separate actual-V8
fixture deterministically produces a field-dependency invalidation and a wrong-map
eager bailout. Native intrinsics and forced optimization are **test-only**, never
part of the measured workload. Other runtime versions still exercise real traffic
and capture, but explicitly reject the unsupported parser schema.

Both parser modules have 100% statement/branch/function/line coverage in Jest and
native V8 coverage. Combined diagnostic-tool coverage remains below its unchanged
100% gate on the final tree: 83.01% statements/lines, 97.64% branches and 94.87% functions. All 79
behavior tests pass, but that aggregate coverage command correctly exits nonzero.
The old coordinator CLI/error paths and worker cleanup-barrier timeout remain
uncovered. No exclusions or weakened thresholds were introduced.

Full-suite verification passed **833 tests / 79 suites** in 418.458 seconds,
including generated-documentation and all three TypeScript pretest configurations.
Instrumented-library coverage is 100% statements/branches/functions/lines: 5,445
statements, 4,044 branches and 978 functions, none uncovered. This library
denominator does not include the diagnostic-tool gaps above. Saved result:
`coverage/recovery-deopt-full-suite.json`, SHA-256
`96ab9e8b4ee219b8682e04229e3843edbd3d133ffadfadccd089f1d1f716411b`.
The earlier shutdown timeout did not recur, but its historical failure remains
unexplained; this pass is not proof that it was harmless.

The senior critic approved preflight, independently verified every source/output
hash, census counts and all four code-address sequences, and approved the report's
wording and inference limits. There were no outstanding findings. No additional
measured run or acceptance retry was made.
After the evidence update, generated-documentation and TypeScript checks passed
again, followed by 83 focused documentation/diagnostic tests across six suites.

## Remaining causal boundary

We now know why the observed handshake versions are replaced. The next distinct
question is what remains live after those invalidations: surviving code, feedback
structures and their retaining paths. That requires retention evidence, not more
counts of creation or invalidation events. Nothing here justifies a speculative
Redweb/runtime rewrite, suppressing GC, relaxing the recovery budget, or claiming
that no leak exists. The client load generator does not import Redweb or
`redweb-client`. Production/library source, dependencies, npm links, frozen
helpers, publication, deployment and merge state remain unchanged.
