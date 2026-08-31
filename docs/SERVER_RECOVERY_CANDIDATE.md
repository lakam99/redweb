# Server-focused recovery candidate

Status: development and review authorized by the maintainer; **not adopted as the
release acceptance gate**. Original `npm run verify:recovery` and CI remain
unchanged. Historical failures, including the Node 22 PR peak of 110.111615% at
`3166468`, are not erased by a candidate pass.

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

Reports must retain `candidateOnly: true`; `candidatePassed` is not release
approval. Adoption requires a separate explicit decision after code review and
actual cross-runtime results. The original measurement remains available with
its original exit status and failures visible.

## Run the candidate

After the review approves measurement, run `npm run verify:recovery:server` once
in a clean environment. It creates an exclusive directory under `coverage/` and
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
