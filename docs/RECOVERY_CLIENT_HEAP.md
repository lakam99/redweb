# Client heap survival investigation — 2026-08-30

Status: diagnostic prepared; measurement pending. The original recovery acceptance
gate remains open. This follows the [deoptimization investigation](RECOVERY_DEOPTIMIZATION.md).

## Predeclared method

One measured run after tests and senior critic preflight:

```sh
node scripts/diagnostics/recovery-split.cjs client-heap
```

The existing seven-phase, 7,400-connection split workload is unchanged. Both workers
retain normal `--expose-gc` flags; no compilation/deoptimization logger or coverage
is enabled. Only the native `ws` client captures snapshots, through separate RPCs
after its warm and storm-5 samples have returned. Server and client measurements
precede capture; the later workload therefore observes the warm snapshot's effects.
The client still does not import Redweb or redweb-client. No concurrent tests run
during measurement, and no rerun is selected because its memory result is greener.

[Node's pinned V8 API](https://nodejs.org/download/release/v22.21.0/docs/api/v8.html)
warns that snapshot generation blocks execution and may need roughly twice the
heap's memory. Its format is undocumented and version-specific. The analyzer is
pinned to Node 22.21.0 / V8 12.4.254.21-node.33. Snapshot capture initiates collection;
[Chrome's snapshot documentation](https://developer.chrome.com/docs/devtools/memory-problems/heap-snapshots)
distinguishes comparison, containment, shallow sizes and retained sizes. Our
comparison reports shallow bytes and graph paths, **not** dominators or retained size.

## Capture and analysis safeguards

- Raw snapshots stay in a newly created local temporary directory, outside the
  repository. They may contain secrets; do not upload or commit them. Unix permissions
  are restricted to the owner; Windows uses the current user's inherited temporary
  directory ACL (the Unix mode is not an independent Windows privacy guarantee).
- Files are opened exclusively before capture and limited to 64 MiB of saved data.
  Partial/failed captures invalidate the run and cannot be reused. This limit does
  not bound native generation memory or its pause; the coordinator has a 60-second
  capture deadline and owns child termination/cleanup.
- Both captures must have the same worker-generated UUID/PID identity, runtime,
  ordered phases and verified SHA-256/file lengths. Snapshots are parsed offline,
  after the workers exit, not inside the measured client.
- The existing validated graph parser is shared with the earlier marker-based
  analyzer. Parsing is capped at 250,000 nodes and 1,500,000 edges per snapshot.
- A single breadth-first search starts at the validated synthetic root, excluding
  weak and shortcut edges. Paths use only fixed category labels and edge kinds;
  arbitrary function/property names, node IDs, addresses and contents are withheld.
  Paths over 32 edges are explicitly truncated; unreachable nodes remain counted.
  These are shortest paths in the filtered snapshot graph, not unique ownership
  proofs or a complete interpretation of ephemeron/engine retention semantics.
- Added, removed and surviving IDs are separated. Survivor bytes/counts before and
  after are both included, so size/category changes reconcile with gross deltas.
  The final public comparison is bounded to 1 MiB; errors are redacted.

This run can show which code-related objects survive in a snapshot-instrumented
client. It cannot identify the earlier run's exact surviving compiled versions,
equate instruction sizes with snapshot self sizes, or explain every byte of the
original shared-process recovery failure. No code amount is subtracted from heap
usage to manufacture acceptance.

## Verification before measurement

Sixteen focused unit and real snapshot/process/network tests pass. Native V8
coverage is 100% statements, branches, functions and lines across all five snapshot
capture/parser/analysis modules. Real integration tests use no mocks, check exact
request/reply IDs, exercise two captures in one worker, verify reusable listener
ports, reject altered identities/versions/lengths/hashes, enforce the capture size
limit, and preserve an existing file on overwrite attempts. Synthetic graph tests
cover cycles, weak/shortcut-only reachability, truncated paths and survivor changes.
The preexisting broader coordinator coverage gaps are not claimed closed by this
focused result. Full-suite verification and measurement results follow separately.
