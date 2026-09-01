# Offline client code attribution

The existing private snapshots show a broader set of compiled code attached to
**preexisting functions and closures**, not an accumulating collection of detached
optimized versions. This is a narrower, supported conclusion about this diagnostic
client; it does not establish the entire cause of the original CI recovery failure.

An independent research agent began without inherited conversation or a proposed
cause. It subsequently encountered earlier investigation notes in the repository
and disclosed that exposure. Its structural findings were reproduced by the
tested offline analyzer and submitted to a separate senior critic.

No new measured workload or capture was performed for this milestone. Both inputs
are the unchanged Windows/Node 22.21.0, V8 12.4.254.21-node.33 snapshots documented
in [the capture report](RECOVERY_CLIENT_HEAP.md). The original capture command
failed its detailed-output size limit; its report and failure remain unchanged.
The new offline result is not a successful replacement recovery run.

## Function identities, not names

| Observed structure | Warm | Final |
| --- | ---: | ---: |
| Code objects with deoptimization data | 96 | 261 |
| Associated SharedFunctionInfo identities | 95 | 260 |
| Identities with one such Code object | 94 | 259 |
| Identities with two such Code objects | 1 | 1 |
| Code objects referenced by an owning closure's current code field | 96 | 261 |
| Feedback vectors | 487 | 532 |

The final 261 Code objects comprise 57 surviving and 204 added identities; 39 warm
Code identities disappeared. All 261 have an owning function identity and a
matching owning closure already present in the warm snapshot. The only two-code
group contains exactly the same two Code identities in both snapshots, both
referenced by current closure fields. There were no unresolved, ambiguous or
conflicting code/feedback associations in this pair.

"Current" means a `closure.code` reference, **not proof that the code remains valid
or is executing**. V8 permits attached code to be marked for deoptimization; that
primitive status is not available in these snapshots. See the pinned
[JSFunction implementation](https://github.com/nodejs/node/blob/v22.21.0/deps/v8/src/objects/js-function.cc).
This analysis cannot match the exact invalidated versions in the separate earlier
logging run to these objects.

| Source of added Code objects | Objects | Code plus instruction-stream shallow bytes |
| --- | ---: | ---: |
| Node built-ins | 180 | 299,360 |
| ws | 22 | 57,296 |
| Realtime test harness | 2 | 8,112 |

These byte totals describe added Code objects plus their attached streams, not
exclusively newly allocated nodes: one added Node Code references a surviving
2,752-byte instruction stream. There are 204 added Code objects but 203 added
instruction-stream identities.

Of 45 added feedback vectors, 44 belong to Node built-ins (9,744 shallow bytes)
and one to the snapshot observer (184 bytes). Observer allocations are explicitly
included, not silently attributed to workload code.

The deduplicated union of Code, instruction streams and immediate deoptimization,
relocation and source-position metadata grows from 201,752 to 861,664 shallow
bytes (+659,912). Feedback vectors are excluded from this union. These are
selected graph-node self-sizes, not exclusive retained sizes, all code-related
memory, or bytes that can be subtracted from the recovery gate. Per-function
metadata can overlap; adding those rows would double-count shared objects.

## A concrete persistent path

`ws.initAsClient` has the same single closure and SharedFunctionInfo identity in
both snapshots. Its baseline code remains in `function_data`; one new
deoptimization-bearing Code occupies the closure's code field at the final
capture. That new Code and instruction stream occupy 20,056 shallow bytes, with
15,304 bytes of associated immediate deoptimization data. There is no collection
of old detached optimized versions for this function in the final snapshot.

The analyzer finds this unique chain in both snapshots, with all eight node
identities unchanged:

```text
process
  -- property/_events --> events object
  -- property/message --> worker IPC listener
  -- internal/context --> listener context
  -- context/WebSocket --> ws WebSocket constructor
  -- internal/context --> constructor context
  -- internal/previous --> enclosing context
  -- context/initAsClient --> initAsClient closure
```

The listener is sourced from `recovery-split-worker.cjs`; its context also holds
the harness's `closeClient` and `waitFor`. Two root-reachable module objects export
the same WebSocket constructor in each snapshot (`ws/index.js` and
`ws/lib/websocket.js`). This establishes persistent worker/module reachability,
not a unique owner or a leftover per-connection closure.

The three unchanged objects named `Socket` are also resolved structurally:

| Role | Shallow bytes | Identifying reference |
| --- | ---: | --- |
| Cached stderr stream | 320 | `getStderr` context's `stderr` binding |
| TLS socket prototype | 56 | `TLSSocket.prototype` |
| JS stream socket prototype | 24 | `JSStreamSocket.prototype` |

Classification requires the appropriate built-in source and edge structure, not
the displayed size or constructor name alone. All three retain the same identity
and role; none is identified as a leftover workload connection. Independent
inspection also found 50 of the 51 unchanged HTTPParser objects reachable through
the parser FreeList. One remaining parser's semantic role is unresolved despite
a path through global handles and a native context. The reusable analyzer does
not classify HTTPParser ownership.

## Method and limits

`CodeAttribution.cjs` composes the existing validated graph reader. It identifies
SharedFunctionInfo structurally, follows Code/deoptimization-data associations,
cross-checks closure ownership and requires reciprocal instruction-stream links.
Identity groups remain separate even when function names coincide.

It does not assume that a snapshot's numerical hidden edge is a V8 field offset.
The [pinned snapshot generator](https://github.com/nodejs/node/blob/v22.21.0/deps/v8/src/profiler/heap-snapshot-generator.cc)
compacts hidden visitor indices. The outer function association is the unique
direct strong structural SFI reference, not nested inlined-function references
in the [deoptimization data](https://github.com/nodejs/node/blob/v22.21.0/deps/v8/src/objects/deoptimization-data.h).
Missing, conflicting, ambiguous and unsupported structures remain explicit.

Inputs retain the paired-process identity, exact runtime, phase, size and SHA-256
checks. Graphs are capped at 250,000 nodes and 1,500,000 edges; metadata association
work is capped at 2,000,000. Exceeding a bound fails instead of reporting partial
success. Detailed output contains at most 128 function groups (135 of 263 groups
are explicitly omitted here); global counts include every group. Output stays
within 1 MiB, uses narrow fixed source/function labels, and contains no raw object
IDs, arbitrary values, absolute source paths or code addresses.

To analyze this pinned capture format locally, without starting the workload:

```powershell
node scripts/diagnostics/HeapCodeComparison.cjs <original-report.json> <private-snapshot-directory> <new-report.json> attribution
```

Output creation is exclusive; an existing output is not overwritten. Raw
snapshots remain private and local.

## Evidence and verification

- Implementation: `8a15569` on `codex/agent-ready`.
- Original report: `coverage/recovery-split-f7owK8/report.json`; SHA-256 `1b894777de9ec50f53faa7e66f144bfe4feb89793ae1bfe068365000833acbe7`.
- Separate offline attribution: `coverage/recovery-split-f7owK8/code-attribution.json`, 67,985 bytes; SHA-256 `af299ace748edc2c01eb02d18ab93cb256fc28a5883adb853b03e146e2ef3971`.
- The attribution report embeds original-report and analyzer hashes. Snapshot identities/hashes remain those in the capture report.
- Native verification: 29 unit and real-process/socket/snapshot tests passed in 8.304 seconds. All six snapshot modules have 100% statements, branches, functions and lines, with unchanged thresholds and no exclusions added. Integration tests use actual native snapshots, CLI processes and network traffic, without mocks.
- Native coverage: `coverage/code-attribution-native/coverage-final.json`; SHA-256 `fd9c8b997f5d40e7367d79c4ca793435f93e1594a8f4f91f58c3b09af47e535d`.
- Full regression at implementation `8a15569`: **853 tests in 82 suites passed** in 434.002 seconds, with a normal exit, pretest/generated-documentation checks and all three TypeScript configurations. The subsequently edited evidence prose is checked separately; no runtime or test inputs changed during the suite.
- Instrumented-library coverage: 100% across 5,445 statements, 4,044 branches, 978 functions and 4,464 lines. The owned-HTTP-shutdown test passed, without resolving its historical timeout.
- Full-suite JSON: `coverage/code-attribution-full-suite.json`; SHA-256 `7274abbb5915e7865f5e3082afaa32d9a08a624732e24664f916600876c961bc`.
- After updating the evidence prose and generated catalogue, pretest/type checks and 30 focused documentation/attribution/graph tests in four suites passed (1.241 seconds for tests).

The senior critic approved the scoped analyzer after a reciprocal-stream
double-counting risk was fixed and regression-tested, then independently reproduced
the saved attribution and approved this report's interpretation. This is not approval of
release acceptance or a claim that broader coordinator/worker coverage is 100%.

## Remaining decision boundary

Existing snapshots answer which functions hold this code and disfavor detached
version accumulation as the explanation for this captured client. They cannot
answer whether the attached code is marked for invalidation, prove every retained
byte benign, or reproduce the original Ubuntu/Node 22.23.2 shared-process failure.
That original fourth-storm 110.218742% result remains above the unchanged 110%
limit even though the final storm declined. The historical shutdown timeout also
remains unexplained.

There is no supported Redweb production fix to apply from these findings alone.
Closing the original failure requires evidence under its comparable environment
and protocol, not another aggregate snapshot, code-byte subtraction or repeated
runs selected for a pass. No production runtime, dependency, npm link, workload,
acceptance limit, publication, deployment or merge changed in this milestone.
