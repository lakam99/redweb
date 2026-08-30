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
