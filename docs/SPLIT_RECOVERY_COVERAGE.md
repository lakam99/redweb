# Authored split-recovery coverage

The maintained `npm run verify:recovery:coverage` gate now includes both original
split-runner source files, not just the server policy and command wrapper.
All 161 tests across ten suites passed in 32.290 seconds on Windows Node 22.21.0.

| Authored file | Statements | Branch outcomes | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| `diagnostics/recovery-split.cjs` | 224 | 96 | 44 | 184 |
| `diagnostics/recovery-split-worker.cjs` | 101 | 49 | 17 | 84 |
| `lib/ServerRecoveryCandidate.js` | 68 | 13 | 15 | 61 |
| `lib/ServerRecoveryPolicy.js` | 60 | 10 | 8 | 55 |
| `verify-server-recovery.js` | 4 | 2 | 2 | 4 |
| Total, all 100% | 457 | 170 | 86 | 388 |

Paths in this table are relative to `scripts/`. Report:
`coverage/server-recovery-acceptance/coverage-final.json`, SHA-256
`7ed28a1a33d1fdfcb3e7724aabee7a669f0ffca706806e45c5680a2bb9b4fdb4`.
CI retains this directory after success or failure. No coverage threshold,
ignored source, workload, sampling or acceptance limit changes.

## What these tests establish

The existing real worker/IPC/socket integration suite runs once.
It is complemented by explicit process, transport, clock, GC and report-failure
unit boundaries. Synthetic byte counts are not memory evidence. The VM executes
the original file at its original filename, validates unchanged source bytes,
and verifies statement/function/branch maps against both its instrumenter and
any existing Jest map before merging into the explicitly selected tool scope.
All 61 functions in the two authored runner files are represented; historical
converted maps with smaller function denominators are not used as proof.

Tests cover exact batch ordering and delivery reconciliation, request failures,
deadline/listener cleanup, partial acquisition, late socket acquisition,
independent worker/output cleanup, snapshot privacy and identity, input changes,
and combined primary/report/finalization errors. The ten existing worker-error
units reuse the same boundary helper instead of duplicating VM setup. The
critic strengthened the finalization error-order oracle and late-acquisition
cleanup assertions before final verification.

An intermediate 68-test selection passed behavior but failed coverage at
99.38% statements / 99.31% branches / 100% functions / 99.25% lines. It lacked
the existing native output-limit path and the instrumented existing worker
error cases; including those original tests closes the gaps without adding
another default 7,400-message measurement. The partial report hash is
`b9ab23a8de56675a48478e4515d98119fe9475d62b5968a7df3e014658145575`.

Snapshot branches in this gate use explicit VM unit boundaries. Actual private
snapshot capture belongs to separate existing client-heap/recovery-verifier
integration and full-regression evidence, not this 161-test selection.

The separate uninstrumented server acceptance recorded in
[failure handling](SPLIT_RECOVERY_ERROR_HANDLING.md) remains the relevant clean
memory measurement. Completing source coverage does not resolve historical
throughput, cleanup or original shared-process diagnostic failures.

## Full regression and contrary hosted evidence

The full Windows suite at unchanged commit `df58f94` completed: 1,943 passed,
five skipped, 175 suites, 1,501.012 seconds. It predates the new boundary tests
and soak retention changes. Scoped `NODE_OPTIONS=--use-system-ca` enabled the
system certificate store for npm consumers; TLS verification stayed enabled.
Library coverage is 5,449 statements / 4,046 branch outcomes / 978 functions /
4,468 lines, all 100%, not whole-repository coverage.

- Full JSON: `coverage/release-df58f94-tests.json`, SHA-256 `49392363f314cb95e37b0b3adf42ff611af5937d6b8e6a2b8de7a4a4e3c03582`.
- Map: `coverage/release-df58f94/coverage-final.json`, SHA-256 `9961a216b47d33803286fab9bffe81d7400c0a8f61478459bd437b7b45cbfb82`.
- Both `019b010` hosted runs passed: PR 33431726293 and push 33431722990.
- `df58f94` push 33432417846 passed, but PR 33432429300 failed its Node 24 soak delivery assertion. That failure is not superseded by the Windows or push pass; see [soak observation](SOAK_ROTATION_OBSERVATION.md).

No new hour soak, publication, deployment, merge or release approval is claimed.
