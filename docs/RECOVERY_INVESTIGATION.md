# Recovery investigation — 2026-08-30

Status: unresolved. This investigation does not waive the fixed recovery gate.

## Question and controls

The existing five-cycle `steady-v2` gate intermittently exceeds its 110% retained
heap limit despite empty connection, room and session registries. The retained
earlier snapshots showed a temporary compiled-code increase, but did not prove a
complete attribution or establish an application-owned leak.

This investigation used Windows and Node 22.21.0, starting at Redweb `2410e60`.
The workload remained 1,200 preconditioning connections, 200 warm connections,
five rounds of 1,200 connections, batches of 50, and the existing 400 ms settling
period and two explicit collections. No warm-up, threshold, dependency, V8
acceptance flag or workload change was made. The local npm links were preserved.

## Observations

One separate `--trace-opt --trace-deopt` run showed repeated weak-object
invalidation of compiled code in Node transport functions and Redweb's
`requestSnapshot`, `decorate`, `prepareContext`, `ensureContext`, `handleConnection`
and session paths. The captured console output was truncated, so it cannot support
complete event counts or attribution. This trace is diagnostic only, even though
the verifier's `diagnosticOnly` field does not detect Node trace flags. No raw heap
snapshots were created. It does not prove that socket-property transitions caused
the peak, nor that application retention is absent.

Source review found avoidable per-connection allocations: a finite-capacity route
without authentication or protocol policy still allocated an admission abort
controller, pending-map record and promise chain. A capacity-only synchronous
path was tested using the existing reservation and rejection logic without that extra
admission lifecycle. Custom authorization and native `verifyClient` hooks remain
on the existing asynchronous path. The route's connection-lifetime controller,
when needed, was unchanged. No connection or exemplar object was kept alive to
inflate the baseline or preserve V8 shapes.

**That candidate was discarded.** Its eligibility check accessed an overridable
authorization getter outside the protected promise path. It could also mistake a
replacement on `SocketRoute.prototype` for the default implementation. Two added
regressions failed on the candidate: the first threw synchronously instead of
rejecting safely; the second bypassed a denial. Both pass on the restored original
runtime. The initial reviewer approval was explicitly withdrawn after these
findings. With no demonstrated recovery or throughput benefit, additional
compatibility machinery would not justify keeping this optimization.

## Unchanged acceptance measurements

One ordinary run was taken before the change and one after it. These are individual
measurements, not a repeated statistical comparison or a throughput claim.

| Phase | Before: heap bytes | After: heap bytes |
| --- | ---: | ---: |
| Warm | 10,583,768 | 10,575,480 |
| Storm 1 | 11,043,608 | 11,004,912 |
| Storm 2 | 11,512,000 | 11,498,392 |
| Storm 3 | 11,577,120 | 11,560,912 |
| Storm 4 | 11,583,512 | 11,668,656 |
| Storm 5 | 10,544,464 | 10,448,840 |

The before run passed at a maximum 109.44601204410375%. The after run **failed**
at 110.33689250984354%. All measured registries were zero in both runs. Final
decline to 98.80251298286224% after the change does not waive the intermediate
failure. No retry was used to replace that result. The allocation reduction is
therefore **not a recovery fix**, and the previous CI failure remains relevant.

## Functional verification

The new real-listener regression failed before the change: a capacity-only
connection still had a pending admission record. Afterward, the same regression
verifies an active capacity reservation during connection, no asynchronous
admission record, rejection at capacity, release on disconnect and successful
reconnection. Separate real connections exercise custom authorization denial and
asynchronous native verification. Unit cases exercise drain, destroyed transports,
upgrade exceptions and reservation cleanup. These tests do not inject mocked
transports into the integration cases.

Before these extra compatibility cases were added, the discarded candidate
passed 759 tests in 74 suites and all four instrumented-library coverage metrics
at 100% (392.665 seconds), plus pretest/types. That broad pass did not detect the
two subsequently demonstrated compatibility defects, and is not final-tree
verification. The restored runtime with the two retained regression cases passes
143 unit/real-network tests in ten suites, with all-four 100% coverage over
`src/ws/BaseSocketServer.js`. Earlier narrower selections lacked unrelated
constructor/inspection coverage and correctly failed their 100% coverage checks;
their behavior tests passed. No threshold was changed.

## Native WebSocket control

After the full suite completed, one separate native-`ws` control acknowledged all
7,400 messages using the same connection counts, batch size, settling delay and
collection sequence. It loaded no Redweb server/runtime, but reused the existing
native client open/close helpers. It omitted Redweb's rooms, sessions, authorization
and application dispatch, so it is not a feature-equivalent benchmark or acceptance
substitute. Its wire-response assertions and helper waits also differ from the
acceptance driver. It measured zero native server clients after every phase.

Warm heap was 6,919,096 bytes. Successive cycle heaps were 7,279,776 / 7,672,840 /
7,755,872 / 7,819,640 / 7,829,720 bytes, ending at **113.16102565999951%** of warm.
The control's exit 0 means its delivery/cleanup assertions passed, not that it
passed a 110% memory gate; it deliberately reports measurements without enforcing
Redweb's acceptance threshold. Its local source is retained at
`coverage/recovery-native-control.cjs` (SHA-256
`70484c74a59071fc8b9c73691c4e01dc6240abe65e15ea1a9e15536da03772e1`).

This demonstrates that exceeding a 10% total-heap ratio is possible in this host's
underlying network workload without Redweb. Together with the trace, it supports
further investigation of runtime/compiled-code lifetime. It does **not** establish
complete attribution of Redweb's failure or prove the absence of a Redweb leak.

## Remaining investigation boundary

The next recovery investigation must distinguish normal compiled-code lifetime
from a concrete application retainer using a narrowly targeted observation. Do
not subtract code bytes, retain artificial baseline objects, weaken the 110%
limit, increase warm-up, or treat a later isolated pass as resolution. Publication,
full original-client/application coverage and final cross-platform checks remain
separate requirements.

## Split-process milestone

The original verifier measures Redweb, native client sockets and its load driver
inside one Node heap. To distinguish those owners, the separate diagnostic
`node scripts/diagnostics/recovery-split.cjs` starts a server worker and a native
client worker. Only the coordinator retains earlier measurements. The acceptance
verifier is unchanged; this diagnostic cannot pass or waive its heap gate.

Both workers use Node's existing `--expose-gc` flag, without inherited Node options
or coverage instrumentation. The server retains the original route, handler,
room/session limits and timing. Work remains 1,200 preconditioning connections,
200 warm connections, five 1,200-connection storms and batches of 50. Each batch
waits for server connection cleanup. Each phase waits 400 ms, collects twice with
one intervening immediate, and requires all measured registries to be empty.

Differences are deliberate and material: there are separate runtimes, IPC and a
coordinator between batches; replies are parsed and checked against their exact
IDs; client operations use settled-result arrays and explicit ownership through
failure cleanup. V8 statistics are read after the phase's heap measurement. These
extra allocations and the changed scheduling mean ratios cannot be substituted
for, added to, or directly compared as equivalents of the original shared heap.
V8 spaces, code statistics, external memory and array buffers are overlapping views,
not additive explanations of heap growth. No code-byte subtraction is allowed.

Evidence is written to a new exclusive directory under `coverage/recovery-split-*`:
complete per-phase JSON lines, a final JSON report, source fingerprints, versions,
process identities, actual delivery counts, registry sizes and all memory views.
Source fingerprints are checked again after completion. Output beyond 1 MiB is
explicitly marked truncated. Each request and process cleanup is bounded; failed
channels cannot be reused, and uncertain cleanup retains the PID and nested
failures rather than claiming success. No raw heap snapshots are taken.

### Single split run: observations

Run once after the full suite finished, from 19:05:35.658 to 19:05:48.448 UTC on
2026-08-30, Windows/Node 22.21.0, V8 `12.4.254.21-node.33`, native `ws` 8.21.3.
The server PID was 22040; the load-generator PID was 34932. Both workers exited.
All 7,400 request IDs were acknowledged exactly, and every phase had zero server
connections/rooms/sessions and zero tracked client connections. Fingerprints were
unchanged at completion. Neither worker emitted output; no output was truncated.

| Phase | Server heap bytes | Client heap bytes |
| --- | ---: | ---: |
| Preconditioning | 10,181,120 | 6,579,816 |
| Warm | 10,187,232 | 6,540,872 |
| Storm 1 | 10,466,240 | 6,782,104 |
| Storm 2 | 10,874,320 | 7,205,968 |
| Storm 3 | 10,989,184 | 7,312,720 |
| Storm 4 | 11,037,936 | 7,374,504 |
| Storm 5 | 9,718,488 | 7,410,304 |

The server peaked at **108.35068839111547%** of its own warm heap and ended at
**95.39871085688438%**. The client crossed 110% at storm 2 and ended at
**113.29229497229116%**, its highest measured value. This attributes the sustained
above-110% ratio **in this split diagnostic** to the native load-generator process,
which does not load Redweb's runtime or `redweb-client`. It does not establish the
cause or relative contributions inside the original shared-process CI failure.

The client's warm-to-final heap increase was 869,432 bytes. Its code-and-metadata
statistic increased 521,972 bytes, while bytecode-and-metadata stayed at 755,952.
Its old/code/trusted spaces increased 394,608 / 321,216 / 152,360 bytes respectively;
external memory and array buffers remained unchanged after warm-up. These are
overlapping views sampled sequentially, not an exact object-retention accounting.
The data supports investigating client/runtime code and metadata lifetime, but
does not establish that all growth is compiled code or exclude retained objects.

On the server, bytecode-and-metadata fell from 908,240 bytes at storm 4 to 204,960
at storm 5 while heap fell by 1,319,448 bytes. This is a correlated observation,
not proof of a particular garbage-collector or bytecode-flushing cause. Server
code-and-metadata remained 416,038 bytes above warm at the final measurement.

Complete local evidence: `coverage/recovery-split-RQytod/report.json`, SHA-256
`fa8b0a070dfb833a8449e4c658190a64778f9e425fed42c93251dda57ed35db7`, alongside
`samples.ndjson`. The report includes all source fingerprints and memory views;
the table above preserves every phase's heap measurement in version control.

### Verification and next boundary

The full suite passed **770 tests / 76 suites**, pretest/type checks, and all-four
100% instrumented-library coverage in 427.392 seconds. Sixteen focused tests cover
the diagnostic's fixed phase plan, fingerprints, nested errors, real HTTP-upgrade
and WebSocket delivery, malformed replies, refused connections, timeout/exit,
graceful and forced cleanup, and command validation. OS-cleanup uncertainty is
tested separately with mocked units, not presented as real-process integration.

The diagnostic scripts are **not at 100% coverage**. Native child-aware coverage
reports 74.83% statements/lines, 95.12% branches and 80% functions across both
scripts. Worker statements/lines are 97.36%; orchestration/CLI and failure paths
remain uncovered. The earlier Jest-only report did not instrument child code and
reported 36.72% statements; that was not a behavioral failure. Both coverage gates
correctly exited nonzero without weakened thresholds; all sixteen behavior tests
passed. Coverage instrumentation is explicit in behavioral tests and disabled in
the actual measured workers. Library coverage does not certify diagnostic coverage.

Final pretest/type/generated-documentation checks and 20 focused documentation/
diagnostic tests also passed after the evidence update. The senior critic approved
the milestone after independently checking report/source hashes, phase counts,
registries and calculations; earlier cleanup/evidence findings were addressed.
The next causal step is client-only retaining-path/code-lifetime
inspection at warm and late storms, with complete bounded evidence, followed by a
one-variable control. A speculative Redweb runtime optimization is not justified
by this result. The original recovery failure, client/application coverage gaps
and release requirements remain open. No original acceptance gate was rerun or
waived, and no production code, dependency, threshold, publication or deployment
changed in this milestone.

Research-led follow-up: [runtime/JIT controls](RECOVERY_RUNTIME_CONTROLS.md) records
the subsequent same-source baseline, complete trace and client-only JIT-disabled
control. It narrows the client growth to a JIT-dependent effect without waiving
the original recovery failure.
