# Starter coordinator verification

Both starter coverage coordinators now have a maintained direct coverage gate:
`npm run verify:starter-coordinators:coverage`. This is a private-tool scope, not
a change to the shipped runtime or a whole-repository coverage claim.

## Corrections

The V8 measurement previously fingerprinted inputs only after testing. It now
records the generated source/test/configuration inventory before execution and
requires identical bytes afterward. A real copied-repository regression changes
a source comment during the generated test command: compilation and all 14 real
tests pass, but the coordinator rejects the changed input and retains raw output.
The authored-source coordinator already enforced this correspondence; the same
native regression now exercises it directly.

Both runners previously wrote their success summary before updating the latest
index. An index-write failure could therefore leave a successful summary behind
while the command failed. Shared `finishVerificationSummary` records failure and
attempts one best-effort rewrite. Recording failures always remain command
failures, including when the corrective write succeeds. Primary and secondary
errors remain available; retained-workspace metadata survives repeated aggregation.
This is not atomic storage: an unwritable filesystem can still leave partial or
stale artifacts, so a summary alone never overrides a failed command outcome.

Both runners defensively reject an empty template inventory, and measurement also
rejects an empty source inventory. These are explicit boundary tests, not a claim
that the current six-template inventory was empty in ordinary execution.

## Tests and ownership

On Windows / Node 22.21.0, 56 tests in three suites pass in 22.027 seconds:

- 47 explicit unit fault cases instrument the exact coordinator source in a VM.
  Compiler, process, filesystem and collector boundaries are injected here; these
  cases are not described as mock-free integration.
- Seven native managed-child/filesystem cases obstruct report paths and exercise
  actual successful, failed, recoverable-write and persistent-write outcomes.
- Two native copied-repository cases use the real initializer, compiler, generated
  HTTP/WebSocket tests and coverage tools to reject source mutation after testing.

The native repository fixture awaits the real private `main` entrypoint, avoiding
an outer process timeout that could orphan independently owned descendants. Each
inner command retains its existing deadline. Cleanup uncertainty preserves the
outer fixture before assertions; normal confirmed cleanup removes owned projects.
The fixture selects TAP output explicitly and restores the prior environment.
The ordinary CLI entrypoints remain separately exercised by full starter runs.

CI retains reports for 30 days and gives the scoped tests 90 minutes and the two
full starter commands 65 minutes. These conservative outer limits cover existing
failure/cleanup budgets; they do not increase inner command deadlines. Normal
execution is substantially shorter. No success is inferred from timeout expiry.

## Exact coverage identity

All four metrics are 100% over exactly three files: 180 statements, 34 branches,
25 functions and 148 lines. The VM maps join coverage only when this private scope
is explicitly selected; they do not enlarge the normal 91-file library scope.

| File | SHA-256 |
| --- | --- |
| `scripts/measure-starter-coverage.js` | `76d475e1f9fa2d3adbdcadd6947d3ed2179646bc0122dad2054a868923d4be3c` |
| `scripts/verify-starter-source-coverage.js` | `833c7511b3799ac4e9513db5a45584fd3095ad2c1409653e90bc1ed8368d6457` |
| `scripts/lib/finishVerificationSummary.js` | `ffd7bfa685e5d260ffa176377e1de6adb835244134f0cda290214961f9423b80` |

Report `coverage/starter-coordinators/coverage-final.json` SHA-256:
`1d5453ad7a2e9ba3450df49aa4fdf4ad65998b72b693eb25b9bda1dfd5a90415`.

The senior critic approved the final source and checked these identities. The
preceding 1,322-test regression does not include these 56 cases or the ten later
report-retention cases. Both hosted workflows for `7a25d48` and `1eddee0` passed;
those earlier results are not assigned to this new source.

## Full starter workflows

Both actual CLI entrypoints completed against the final source above. Measurement
ran all six applications and 104 tests, retaining `measured` status. Its separate
V8 function gaps remain realtime 58.33%, chat 59.09% and dashboard 88.70%; the other
three applications have all-four 100% in that map.
`coverage/starters/271e9e10-5069-4983-b60f-612d660b04c9/summary.json` SHA-256:
`0b6507753dc1d49a6c1e99bd59df6cf3000767f3317620307abc351260692159`.

The authored-source gate passed all six applications, 104 tests in each plain and
instrumented mode, no failures or skips, and all 96 process reports retained.
All-four 100% covers the unchanged 600 statements, 299 branches, 160 functions and
472 lines. Raw report/log hashes were checked against each summary entry. This
uses actual HTTP/WebSockets, files and SQLite, including the one-minute rate
window in each dashboard mode. The unchanged collector's five tests also pass.
`coverage/starter-source/900bf78d-3e77-40b4-b645-c6599a7b1728/summary.json` SHA-256:
`8679e03a06e441403f08bbfca069c3e82b56ec2bfdd9a23f427885b0e820f050`.

Full pretest/generated/type checks pass. The complete root regression selected
for this increment then passed 1,388 tests across 132 suites in 724.472 seconds,
with two POSIX-only skips on Windows. Exactly 91 library files retain all-four
100%: 5,449 statements, 4,046 branches, 978 functions and 4,468 lines. The private
VM maps did not enlarge that denominator. The subsequent lifecycle-coordinator
tests were added after selection and are not included in this inventory.

Full report `coverage/coverage-final.json` SHA-256:
`f9a99527a5d288640750ddab72858dc571e524864d5ed2a4012e34c6ee0df44b`.
Inventory `coverage/starter-coordinators-full-results.json` SHA-256:
`a17c022d9c38738bdcbe736496015781abb02a903548e1a52ef27012a1cd7348`.

The critic approved all 13 actual remote changed blobs at `377f029`, including
the retained full-starter artifacts. Both hosted workflows then passed completely:
PR `33380771673` and push `33380765217`. Later evidence/implementation heads retain
their own separate hosted outcomes.

No compiler/runtime behavior, coverage thresholds, frozen evaluation files,
publication, deployment or performance acceptance changed. V8 compiler-generated
function gaps remain diagnostic; authored-source coverage is the separate gate.
The unresolved throughput result in `BENCHMARK_VERIFICATION.md` remains open.
