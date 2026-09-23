# Client heap survival investigation — 2026-08-30

Status: surviving code-related structures identified in the instrumented client;
the original recovery acceptance gate remains open. This follows the
[deoptimization investigation](RECOVERY_DEOPTIMIZATION.md).

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
  The final public comparison is bounded to 1 MiB; errors are redacted. Complete
  category/cohort/path-status totals are retained; at most 128 detailed path groups
  are shown, prioritizing added objects then descending shallow bytes. Omitted
  group counts are explicit. These examples are not representative statistics.

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
focused result.

## Original run and offline repair

Exactly one workload was run, at tooling commit `4d036b4`, from
20:37:09.177Z to 20:37:23.539Z. It reached the post-worker-cleanup comparison stage
after all 7,400 exact acknowledgements and empty client/server registries at every
sample. All four output logs were complete and empty. Source hashes were checked.

The run nevertheless **exited 1**: the initial detailed comparison was 1,391,590
bytes, exceeding the 1 MiB output cap. Its original report remains unchanged with
`deliveryAndCleanupPassed: false`. This is a failed diagnostic, not a release pass.

The correction at `bd68503` bounds detailed examples while preserving complete
numeric totals. Its new 3,000-path fixture checks omission accounting and output
size; a real CLI test checks provenance, redacted errors and overwrite refusal.
The same existing snapshots were reanalyzed offline, without another workload or
snapshot capture. Native coverage after the correction passed 17 tests and all-four
100% across the five snapshot modules. The senior critic independently reproduced
the reanalysis and verified hashes, reconciliation, omission counts and path totals.

Reproduction uses a new output file; it never overwrites the original report:

```sh
node scripts/diagnostics/HeapCodeComparison.cjs <original-report.json> <private-snapshot-directory> <new-summary.json>
```

## What survived

The snapshots contain 77,725 then 80,910 nodes: 4,771 added IDs, 1,586 removed IDs,
and 76,139 surviving IDs. Net snapshot shallow bytes increased by 937,387. The
complete V8 `code` category increased by 801,792 shallow bytes; it includes several
different kinds of internal data, not just executable instructions.

| Code-related category | Net shallow bytes |
| --- | ---: |
| Remaining unclassified code nodes | +543,408 |
| Deoptimization data | +113,880 |
| Relocation information | +91,608 |
| Bytecode arrays | +19,064 |
| Generic code objects | +14,520 |
| Feedback vectors | +9,928 |
| Constant pools | +7,440 |
| Feedback cells | +2,184 |
| Uncompiled data, combined | −240 |

These labels follow fixed tags in the pinned
[V8 snapshot generator](https://github.com/nodejs/node/blob/v22.21.0/deps/v8/src/profiler/heap-snapshot-generator.cc).
Unrecognized names remain unclassified. The other major net category was hidden
runtime data (+122,672 shallow bytes). These are distinct snapshot categories;
they must not be added to overlapping `getHeapCodeStatistics()` measurements.

There were no WebSocket, Sender, Receiver or Timeout instances in either snapshot.
All three Socket instances and all 51 HTTPParser instances survived unchanged,
with no additions. That narrows the evidence away from accumulating connection
instances in this client; it does not establish that every retained object is benign.

All 33,449 final code nodes are included in path totals: 33,441 have a path from the
root in the filtered graph; eight surviving nodes (512 shallow bytes) do not.
No path was depth-truncated. The 2,802 grouped paths yield 128 detailed examples
and 2,674 explicitly omitted groups. Some examples run through global handles,
closures and code objects; others include a Socket. A shortest path is neither a
unique owner nor evidence that such a Socket is a leftover workload connection.

## Observer effects and remaining causal question

| Phase | Server heap bytes | Client heap bytes |
| --- | ---: | ---: |
| Preconditioning | 10,176,480 | 6,596,520 |
| Warm, before first capture | 10,195,968 | 6,567,568 |
| Storm 1 | 10,480,392 | 7,498,024 |
| Storm 2 | 10,873,856 | 7,831,056 |
| Storm 3 | 10,965,904 | 8,014,120 |
| Storm 4 | 11,055,136 | 8,040,528 |
| Storm 5, before final capture | 9,925,432 | 8,054,112 |

Client heap growth was 1,486,544 bytes (122.63% of warm), while code/metadata
statistics grew by 534,410 bytes. Bytecode/metadata statistics changed from
758,616 to 666,216 after the warm snapshot. These readings are before capture,
whereas the snapshot inventories are collected during capture, with extra GC and
diagnostic machinery. The unequal deltas must not be treated as a missing-byte
equation or used to claim the original unsnapshotted growth is fully explained.

The next useful step requires **no new workload**: attribute the largest added
code/deoptimization groups to known Node, ws and harness functions through narrowly
allowlisted structural relationships in these snapshots. Distinguish module/cache
roots and standard-stream sockets from workload connections. This milestone does
not identify the exact earlier invalidated versions, prove exclusive retention,
explain all hidden data, or resolve the original recovery failure or historical
shutdown timeout. No speculative production optimization or acceptance change was made.

Follow-through: [offline function and root attribution](RECOVERY_CODE_ATTRIBUTION.md)
now records that analysis of the same snapshots, including persistent function
identities and all three standard-stream/prototype Socket roles. The original
capture and verification evidence below remains unchanged.

## Evidence identity

- Original local run: `coverage/recovery-split-f7owK8`.
- Original report SHA-256: `1b894777de9ec50f53faa7e66f144bfe4feb89793ae1bfe068365000833acbe7`.
- Warm snapshot: 7,512,482 bytes; SHA-256 `339a0fe74d9bb942c64a5514975b2918376004436125ca8af169ccdc86dfdaa3`.
- Final snapshot: 7,796,848 bytes; SHA-256 `7e494dbe82222c4045d673d5bd1cf79a953708025219ebb632fcaf0fdb59576d`.
- Separate offline report: `heap-reanalysis.json`, 88,196 bytes; SHA-256 `f3904afc8ee5786fec862737404f69ba1076cd46c8f828a5d530781c7dc64aa9`.
- Offline analyzer SHA-256: `afa8981ec976a6a9405207f4297257c518483941c919b2d3f0ffd868b3155392`.

The offline report includes the original report hash, unchanged failure status and
all analyzer input hashes. Raw snapshots remain private and local; no publication,
deployment, dependency change, npm-link change or merge occurred.

## Final verification

At implementation commit `bd68503`, the full suite passed **841 tests in 81 suites**
in 435.006 seconds, including the owned-HTTP-shutdown test. Pretest documentation,
generated examples/protocol types and all three TypeScript configurations passed.
The historical shutdown timeout is still unexplained, not waived by this pass.

Instrumented-library coverage remains all-four 100%: 5,445 statements, 4,044 branches
and 978 functions, none uncovered. The separate untransformed native snapshot-tool
run passed 17 tests with all-four 100% across `ClientHeapCapture`, `HeapSnapshotGraph`,
`HeapCodeComparison`, `recovery-heap-graph` and `recovery-heap-summary`, including the
offline CLI. Broader split-coordinator/worker coverage gaps remain outside that
five-module claim. No threshold was lowered or uncovered code excluded to obtain it.

- Full-suite JSON: `coverage/client-heap-full-suite.json`; SHA-256
  `bb49cab38666d8d60c879aa970fcf44df494d7d900d5152548266662eea5d1cc`.
- Native snapshot-tool coverage JSON: `coverage/client-heap-native/coverage-final.json`;
  SHA-256 `f90cdb7ce7e02d611f8c88d1fc3e224803f3dc57c51bba184969be880136a886`.
