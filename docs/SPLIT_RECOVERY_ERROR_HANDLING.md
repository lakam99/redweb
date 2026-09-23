# Split recovery: failure-channel corrections

The shared diagnostic/server-acceptance runner now preserves three concrete
failure boundaries without changing its workload, thresholds or sampling:

- Synchronous native IPC serialization errors use the existing request cleanup
  closure, removing listeners and cancelling the request deadline immediately.
- Falsy/non-Error failures are normalized through the existing shared
  `verificationError` helper before failure tracking and report aggregation.
  Original Error identity is retained; other values remain available as causes.
- Worker error replies remain failures for non-Error rejections and Errors with
  missing/empty stacks. A fixed fallback prevents an empty error field from
  being interpreted as successful IPC. Private snapshot replies retain their
  fixed redaction message.

The newly imported helper is included in the measurement fingerprint. No frozen
evaluation code, process helper, network helper, acceptance limits, socket
library API or application workload changed.

## Regressions before and after correction

Two real-process tests initially failed in 1.360s. Circular request data left
one extra listener on each of `message`, `exit` and `error`. An output callback
throwing `0` rejected with that primitive instead of retaining a persistent
failure. These checks use actual workers/IPC/output and no mocked transport or
process APIs; deliberate callbacks supply the failing application boundary.

The separate process/clock/GC unit boundary initially had seven failures and one
pass in 0.441s: null/undefined crashed error reporting, while other primitives
and an object produced an undefined error field. Snapshot refusal was already
correct. The critic then identified two genuine-Error cases (absent/empty stack),
which failed before the fallback was added (eight passed, two failed, 0.475s).
Those VM units are not native memory or IPC evidence.

The final selection passed 47 tests in 12.243s across existing split-runner
unit/native integration tests and the two new error test files. It includes five
actual early worker-registration failures and verifies normal Error type,
message/cause, recorded worker exit and both closed pipes. Those assertions
explicitly reject an unrelated cleanup AggregateError. Existing checks exercise
actual rooms/sessions, bad replies, unreachable peers, output draining, trace/code
modes, deadlines, forced cleanup and listener reuse.

The established server policy/coordinator/CLI coverage scope also passed all
76 tests in 26.638s at all-four 100% before the final missing-stack fallback;
that fallback is covered by the subsequent 47-test selection. This scope does
**not** include the full authored coordinator/worker files. The subsequent
161-test maintained gate closes those source-matched maps at all-four 100%;
see [authored coverage](SPLIT_RECOVERY_COVERAGE.md) for the exact scope and limits.

## Fresh uninstrumented server acceptance

One final normal `verify:recovery:server` run used the corrected runner/worker:

- All 7,400 exact replies reconciled between server and client.
- Empty measured registries, identical initial/final input fingerprints, complete
  logs, and normal zero-status worker exits with both pipes closed; no forced
  cleanup was required.
- Server storm peak: 108.18707393318519% of warm heap; final: 97.15476818198938%.
- Client peak: 112.98160068884602%, retained as a diagnostic, not subject to the
  server's 110% budget.

Report: `coverage/server-recovery-ipc-fix-20260831/report.json`, SHA-256
`a8458d98eb90e17d3ee19006938a4efb51e67090b78ebccefd3ce2f13a3cdd48`.
This is one Windows/Node 22.21.0 result, not cross-platform release acceptance
or a resolution of the original shared-process failure. Historical throughput,
cleanup and soak limitations remain unchanged. No publication, deployment or
merge is claimed.
