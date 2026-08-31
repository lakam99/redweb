# Server-focused recovery candidate

Status: **adopted as the blocking CI recovery check** after independent review,
five clean cross-runtime results and explicit maintainer authorization to continue.
Original `npm run verify:recovery` keeps its command and runs in CI as an explicitly
non-blocking diagnostic. A later [exact-byte boundary correction](ORIGINAL_RECOVERY_VERIFICATION.md)
fixes false rejection at precisely 110%; its workload and limit are unchanged.
Historical failures are not erased by a server pass or that rounding correction.

## Contract: server-steady-v1

The candidate reuses the existing split coordinator and workers in baseline mode,
with separate coordinator, Redweb server and native `ws` load-generator processes.
It preconditions with 1,200 connections, warms with 200, then executes five storms
of 1,200 each, in batches of 50: 7,400 total exact request/reply exchanges.
Each batch reconciles client sends/replies and server receives and waits for
server connection cleanup. Rooms and sessions are checked at phase boundaries,
not claimed empty after every batch. Sampling settles for 400 ms and performs the
existing two explicit garbage collections before reading retained heap.

Every storm's server heap must be at most 110% of the **same** warmed server heap.
A failed middle storm fails even if the final storm recovers. Client heap ratios
are reported separately without a client heap acceptance budget. Exact delivery,
empty registries, stable runtime/process identities, normal worker exits, closed
output pipes, complete logs and unchanged input hashes remain mandatory for both
roles. A forced cleanup cannot produce a passing candidate.

This is a different measurement from the shared-process gate, not proof that its
failure was harmless. No code-memory subtraction, moving baseline, retries until
green, instrumentation, snapshots or tuned workload overrides are permitted.
The reused worker reads V8 statistics after its heap sample; that existing
observation and split-process scheduling are part of this candidate protocol.

Reports retain the reviewed `candidateOnly: true` / `candidatePassed` field names
for format compatibility with the collected evidence. CI now adopts the command's
exit status as this scoped recovery gate; these legacy field names do not mean
whole-release approval. No workload, threshold, worker or report-schema change
was needed for adoption. The original measurement keeps its own exit status;
CI records the raw step outcome, emits a warning on non-success, and retains logs
alongside server samples, process exits and input/output hashes for 30 days.
Both commands have two-minute CI deadlines and run sequentially, without retries.
The diagnostic only starts after a passing server gate confirms worker cleanup;
after a failed/timed-out server run it is explicitly skipped, not called passing.

## Run the candidate

From the matching Redweb source checkout (not an installed application), run
`npm run verify:recovery:server` in a
clean environment. It creates an exclusive directory under `coverage/` and
prints its location. An optional absolute, nonexistent directory can be supplied
after `--`. Existing evidence is never overwritten.

The command rejects Node flags, nonempty `NODE_OPTIONS`, `NODE_V8_COVERAGE` and
`REDWEB_RECOVERY_*` overrides (including differently cased environment names).
Reports include source hashes, all phase samples, observed worker exits and log
digests. Failures retain partial evidence; primary errors are not replaced by
secondary finalization errors. A heap-budget failure exits nonzero just like an
invalid-evidence failure, but is identified separately in its saved report.

Policy units use explicitly synthetic reports for malformed evidence and exact
budget boundaries. Real integration uses a managed coordinator process and real
workers/sockets; its parent bounds the coordinator and separately reaps registered
workers, whose POSIX process groups are independent. Missing registration or
uncertain cleanup fails and retains the workspace rather than claiming complete
tree cleanup. Coordinator-only
instrumentation is used for behavioral coverage, never claimed as a clean
candidate measurement. Shared worker lifecycle tests remain separate. No mocked
transport, garbage collector, process or filesystem replaces these integration
checks.

## Maintained acceptance-tool coverage

`npm run verify:recovery:coverage` now runs the existing coordinator/policy units,
real worker integrations and three added CLI exit-boundary units together. It
enforces all four 100% thresholds over `ServerRecoveryPolicy.js`,
`ServerRecoveryCandidate.js` and `verify-server-recovery.js`, and is required in
the lifecycle CI job. The command passed 76 tests across five suites in 28.656
seconds on Windows/Node 22.21.0. The CLI units explicitly substitute the coordinator
result and stderr to cover pass, budget-failure and rejected-promise exits; they
are not described as mock-free integration. Actual CLI/worker/socket behavior is
also exercised by integration tests and the ordinary CI acceptance invocation.
This closes the earlier thin-CLI coverage gap without claiming coverage of the
shared diagnostic workers or every private verification tool.
The report contains 132 statements, 25 branches, 25 functions and 120 lines,
all covered. `coverage/server-recovery-acceptance/coverage-final.json` SHA-256:
`0d6ebe45fe2e1f87f2ddcb6afb4fe1960473c40a09c877f4697cf90db2a1ff3c`.

## Implementation checkpoint

The senior critic approved measurement after environment-case and test-process
ownership findings were fixed. The scoped regression passed 73 tests in four
suites, including existing split-worker regressions. New policy/coordinator
coverage is all-four 100%: 128 statements, 23 branches, 23 functions and 116 lines.
The report is `coverage/server-recovery-candidate/coverage-final.json`, SHA-256
`17906b03fae19ed3bef54d8d82743ad831a6124fa1bd88147cbb4e2da64f87d7`.
This does not claim whole-repository, test-helper or thin-CLI-wrapper coverage.
Generated-content freshness and all TypeScript pretest configurations also pass.

Coverage uses original coordinator source in a managed Jest child and the parent
unit tests. It checks identical source mappings before merging only the parent's
selected files. Child collection is non-gating; the combined scoped gate retains
all four 100% thresholds. This is instrumentation for behavioral verification,
not a clean candidate heap measurement.

The temporary `server-recovery-candidate.yml` workflow collects one clean result
each on Ubuntu 24.04 with Node 18.20.8, 20.20.2, 22.23.2 and 24.19.0. Its trigger
is restricted to changes to that workflow on the implementation branch; repeated
attempts are rejected. Each isolated job installs the locked dependencies before
measurement, runs no competing tests, and uploads candidate evidence on failure
as well as success. Remove the workflow after collection. This new candidate
protocol is not a rerun of the historical original/split comparison and does not
modify the ordinary acceptance workflow.

## Collected candidate results at 15c5a4e

The [single Ubuntu matrix](https://github.com/lakam99/redweb/actions/runs/33352534392)
completed successfully on all four pinned runtimes. A separate single Windows
Node 22.21.0 run also passed. These were clean candidate invocations, not the
instrumented behavioral runs described above. Each verified all 7,400 exact
replies, phase registries, unchanged inputs, complete logs and normal worker
exits. Downloaded sample streams, worker inventories and every log's bytes/hash
were independently reconciled with the saved reports.

| Environment | Server peak % of warm | Server final % of warm | Client peak % of warm |
| --- | ---: | ---: | ---: |
| Ubuntu / Node 18.20.8 | 102.738879 | 101.936032 | 107.220473 |
| Ubuntu / Node 20.20.2 | 106.724670 | 104.968229 | 111.411540 |
| Ubuntu / Node 22.23.2 | 108.491002 | 97.235712 | 112.873352 |
| Ubuntu / Node 24.19.0 | 100.817681 | 100.817681 | 101.139821 |
| Windows / Node 22.21.0 | 109.253735 | 95.525155 | 113.270161 |

Only the server column has the candidate's 110% budget. The client measurements
above 110% are explicit, not subtracted or represented as passing that budget.
One run per environment demonstrates these executions, not repeatability or
production capacity. The original shared-process CI failures remain unchanged.

Ubuntu artifacts are retained locally under
`coverage/server-recovery-matrix-33352534392/`; hosted retention is 30 days.
Each artifact is named `server-recovery-<node>-15c5a4eef60a7a544745a9382bf9f517c02a30f8`.
SHA-256 for each `report.json`:

- Node 18.20.8: `9899ea2201724957fc1aba88d0eb901cea0a0e7e17f43ebc3e21a7593cdca9c4`.
- Node 20.20.2: `8b0949c154e905122091ba6a0e37019d404c1a21266406ce00b23b6c73464860`.
- Node 22.23.2: `41f55fb4fbb1b90079d624f4602a3a4d5441391dd112c992fabdef5b720f523b`.
- Node 24.19.0: `e7ec1c25a3c94aa6b48d30382cf044f8425fab01a09dd548fd0285e06544733e`.
- Windows `coverage/server-recovery-local-15c5a4e/report.json`:
  `26e90708d03537f16a1b73b5ba16c57cbee9743e4fff2c770933118ffdcf032d`.

The temporary collection workflow was removed after completion; no measurement
rerun occurred. Adoption was pending at this historical checkpoint and is now
authorized as described above.

The senior critic independently verified the actual PR commit, all five reports,
the Ubuntu manifests against 104 committed inputs, delivery/sample/inventory
reconciliation and log hashes. The reviewer recommends presenting adoption for
the maintainer's decision without another experiment. The justification is
isolating server retention from the load generator, not proving the original
failures harmless or claiming their cause was fixed.

## Full regression and unchanged CI at 15c5a4e

Windows `npm test -- --runInBand --silent` completed successfully: 918 tests in
86 suites, 447.46 seconds, including the normal generated-content/type pretest.
The configured library scope remains all-four 100%: 5,445 statements, 4,044
branches, 978 functions and 4,464 lines. The coverage report
`coverage/coverage-final.json` has SHA-256
`961dd4e6bc2e90df001df71281622140f153024ae71e4295e7b2ed92d49cb045`.
The candidate tooling coverage is the separate scoped result above.

Ordinary [push CI](https://github.com/lakam99/redweb/actions/runs/33352534344)
passed. Ordinary [PR CI](https://github.com/lakam99/redweb/actions/runs/33352536964)
failed only the unchanged Node 22 shared-process recovery check: storm 4 reached
110.530483% of warm against the 110% limit; final heap was 97.045378%, with empty
registries. Its tests and load check passed; its subsequent audit was skipped.
Node 18/20/24 and the lifecycle/browser/package job passed. No retry occurred.
These results preserve the distinction between a passing candidate and the
still-failing existing acceptance contract; this is not merge approval.
