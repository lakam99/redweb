# Diagnostic runtime compatibility

This increment fixes private verification tools, not Redweb's public runtime or
the recovery acceptance contract. The existing recovery workloads, deadlines,
thresholds and historical evidence remain unchanged. It does not establish
release readiness.

## Confirmed causes and narrow fixes

- Node 18.20.8 and 20.20.2 reject `--trace-flush-code`. Trace workers now use
  `--trace-flush-bytecode` on those major versions and retain the modern flag on
  Node 22/24. These traces have different scope; bytecode flushing is not proof
  of all code flushing. Reports retain the actual flags and runtime identity.
- Node 18 lacks `--no-log-source-position`. Omitting it emitted prohibited
  source-position/feedback records in a real test. Code/deoptimization logging
  therefore rejects Node 18 before either worker or an output directory starts;
  no privacy assertion is weakened. Other diagnostic modes remain available.
- Legacy V8 heap-snapshot streams never completed their destroy callback,
  causing an actual Node 18 capture timeout. Node's upstream fix is documented in
  [PR #58846](https://github.com/nodejs/node/pull/58846). The capture owner uses
  `Readable.wrap` only when the snapshot's existing `_destroy` signature has no
  callback parameters; modern streams retain their original pipeline. This is
  read-only compatibility with the known implementations, not a guaranteed
  future capability API. A major-version cutoff would miss older Node 20/22/24
  releases before that upstream fix.
- The output-limit regression now snapshots a small owned child instead of the
  entire Jest process. It still verifies the actual one-byte limit, poisoned
  session and exclusive file creation without mocks or increased deadlines.
  This bounds the test workload; it is not proof of the cause of every prior CI
  timeout.

The 64 MiB file limit does not bound V8's synchronous snapshot-generation memory
or pause. Existing process ownership/deadlines remain necessary. Heap graphs
remain private local artifacts and are not committed or uploaded.

## Verification

Sequential focused Jest runs passed 34 tests across four suites on Windows:
Node 18.20.8, 20.20.2 and 22.21.0. Suites cover flag units, real diagnostic workers,
native code-log privacy/preflight rejection, deoptimization parsing boundaries,
and real network heap captures. The Node 18/20 Jest runs preceded the final
signature refinement with equivalent paths; Node 22 ran the final source.

The final source additionally passed eight native tests on Node 18 and eight on
Node 22, sequentially, combining original-source V8 coverage for legacy and
modern capture paths. Only `scripts/diagnostics/ClientHeapCapture.cjs` is claimed
at 100% here: 56 statements/lines, 17 branches, three functions. This is not
whole-diagnostic or whole-repository coverage. Node 24 execution of this change
remains a hosted CI gate, not a local result.

- Capture source SHA-256:
  `949e63376b402b7202b3a23e8bc0c381681766c79091b9a9c82156235048ae38`.
- Local report: `coverage/compatibility-capture-runtime/coverage-final.json`.
- Report SHA-256:
  `d166288f7cce3d35441f6f2e1457a331631cf082383665660493b6c5b514521c`.
- All matching native report ranges fit the same 2,553-character original source;
  Jest-wrapped source was not merged into this coverage result.

Rejected candidates are not passes: omitting the privacy flag leaked forbidden
records; wrapping every snapshot caused a Node 22 premature-close failure;
earlier concurrent attempts also timed out. Final focused runs were sequential.
No recovery gate was retried or relaxed to qualify these changes. The senior
critic independently inspected the final code and hashes and gave scoped
approval, explicitly not release approval.

The separate recovery acceptance decision remains documented in
`docs/RECOVERY_COMPARISON.md` and `docs/RECOVERY_FOLLOWUP_SPIKE.md`.
