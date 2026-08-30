# Client code-creation census — 2026-08-30

Status: concrete compilation candidates identified; **original recovery failure
not resolved**. This follows the [JIT control](RECOVERY_RUNTIME_CONTROLS.md).

## Method and boundaries

One predeclared run, executed once after unit/real-network tests and critic review:

```sh
node scripts/diagnostics/recovery-split.cjs client-code
```

The server retains normal flags. Only the client adds `--log-code`,
`--no-log-source-code`, `--no-log-source-position`, `--no-logfile-per-isolate`
and `--logfile=-` to `--expose-gc`. Inherited Node options/coverage do not enter
measured workers. No tests ran concurrently with measurement. Runtime is unchanged:
Windows, Node 22.21.0, V8 12.4.254.21-node.33, ws 8.21.3.

The pinned V8 [flag definitions](https://github.com/nodejs/node/blob/v22.21.0/deps/v8/src/flags/flag-definitions.h)
show code logging normally enables source logging; the explicit negative flags
prevent that. V8's [logger implementation](https://github.com/nodejs/node/blob/v22.21.0/deps/v8/src/logging/log.cc)
records instruction size, code kind, logger-relative microseconds, function name
and location. Numeric kinds are interpreted using the exact pinned
[code-kind enum](https://github.com/nodejs/node/blob/v22.21.0/deps/v8/src/objects/code-kind.h).
Other V8 versions are rejected by the parser, not silently decoded with this enum.

Two tiny diagnostic functions are first invoked **after** the warm and final
samples. Their native code-creation records bracket the interval in the same V8
stream; JavaScript stdout markers are not mixed into it. Both are interpreted
functions, two instruction bytes each. The parser requires exactly one of each,
in order, and monotonic code-event timestamps. It rejects missing/repeated/reversed
boundaries, malformed records, unknown kinds, private detail records and oversized
or incomplete input. The existing coordinator preserves bounded logs and hashes;
census failure invalidates the result. Summary names/locations are limited to
known code sources, with other entries explicitly unclassified.

Logging, native markers and their allocations perturb this run. The census window
is after-warm-sample to after-final-sample, not precisely the two heap-read
instants. This is not acceptance-equivalent. Creation events/instruction bytes
are **not retained objects, retained size, total heap size, or a deoptimization
diagnosis**. Raw local logs still include addresses, paths and code labels; they
are not published as sanitized reports. No heap snapshots were taken.

## Results

All 7,400 exact reply IDs were acknowledged. Client tracked connections and server
client/room/session registries were empty at every sample. Both workers exited.
All source fingerprints remained unchanged through measurement and were rechecked
afterward. Every raw log's byte length, completeness and SHA-256 was independently
verified; reparsing its serialized census reproduced the report exactly.

The log has 4,360 code-creation records: 3,502 through the warm boundary,
**851 between boundaries**, and seven at/after the final boundary. Native boundary
timestamps are 2,873,133 and 12,657,842 microseconds. Of the interval events, 843
are TurboFan (1,620,872 instruction bytes) and eight baseline-tier (9,004 bytes).
These are cumulative creation sizes, not a memory-retention total.

| Source category | Interval creation events | Cumulative instruction bytes |
| --- | ---: | ---: |
| Node core | 653 | 1,170,660 |
| `ws` | 106 | 293,460 |
| Load-test harness and worker | 41 | 144,184 |
| Unclassified | 51 | 21,572 |

Largest named TurboFan groups:

| Function | Source | Events | Cumulative instruction bytes |
| --- | --- | ---: | ---: |
| `initAsClient` | `ws/lib/websocket.js:667` | 4 | 71,176 |
| `ClientRequest` | `node:_http_client:190` | 4 | 67,520 |
| `Socket._writeGeneric` | `node:net:935` | 5 | 29,520 |
| `onEvent` | `scripts/realtime-harness.js:13` | 5 | 28,004 |
| `Socket._destroy` | `node:net:808` | 4 | 27,888 |
| `parserOnHeadersComplete` | `node:_http_common:74` | 4 | 24,208 |

For `initAsClient`, all four events share one SharedFunctionInfo address but have
four distinct code addresses and instruction sizes of 16,144 / 18,860 / 17,220 /
18,952 bytes, at 5,508,294 / 7,818,047 / 9,753,664 / 11,684,671 microseconds.
That is evidence of distinct optimized versions associated with the same function
in this run, not just four identical records. It does not say why new versions
were generated, whether earlier versions survived, or which objects retained them.

### Memory observations (not a gate)

| Phase | Server heap bytes | Client heap bytes | Client code-and-metadata bytes |
| --- | ---: | ---: | ---: |
| Preconditioning | 10,190,376 | 7,030,952 | 2,860,536 |
| Warm | 10,190,592 | 7,005,648 | 2,834,870 |
| Storm 1 | 10,462,648 | 7,242,200 | 2,986,582 |
| Storm 2 | 10,791,136 | 7,693,424 | 3,283,972 |
| Storm 3 | 11,087,200 | 7,816,488 | 3,346,328 |
| Storm 4 | 10,964,832 | 7,853,856 | 3,355,785 |
| Storm 5 | 9,910,160 | 7,844,472 | 3,330,512 |

Client warm-to-final heap growth is 838,824 bytes; code-and-metadata growth is
495,642 bytes. Peak/final heap ratios are 112.10748812957773% and
111.97353906448055%. Client bytecode-and-metadata rises from 756,440 at warm to
756,544 at storm 1 and stays there; marker overhead is not subtracted. External
memory (2,331,012) and array buffers (35,458) remain constant after warm-up.
Server peak/final ratios are 108.79838973044941% and 97.24812846986711%; its
bytecode-and-metadata again drops late, from 908,728 to 205,328 bytes. None of these
overlapping statistics is added to/subtracted from heap to manufacture a pass.

## Evidence and verification

- Tooling commit: `200fb30` on `codex/agent-ready`.
- UTC run: 2026-08-30 19:46:02.966–19:46:15.721.
- Local directory: `coverage/recovery-split-4EG5qI` (report, samples and four logs).
- Report SHA-256: `8cc597cf22bdaef4b6af90943b36a4a541e49af03ec8bc43ef76fc95390c8cdb`.
- Client stdout: 419,734 bytes; SHA-256 `55a02d595bf57b26e39aac6cc609db49a4062df24f2876b5c2fd9766204709c4`.
- Other three logs: empty, complete, hashes verified.
- Parser source SHA-256: `759961f48151f8e74cbc6f9490bec640f9e42508023fa5e4082b866eb9c7acec`.

Fifty-nine focused unit/real-child/real-HTTP-WebSocket tests passed. The new parser
has **100% statements, branches, functions and lines**, in both Jest and native V8
coverage. The real-network test exercises logging isolation, boundaries, complete
hashes, source-text exclusion and listener cleanup. On other V8 versions it checks
explicit parser rejection, while still exercising traffic and capture; it does
not claim schema support for those versions.

The final-tree combined three diagnostic scripts remain below the unchanged native
100% gate: **80% statements/lines, 97.02% branches and 93.54% functions**. That
coverage command exited nonzero despite all 59 behavior tests passing. The worker
is 100% statements/lines/functions but 98.14% branches (cleanup-barrier timeout
uncovered); coordinator CLI/orchestration/error paths remain uncovered. These
numbers supersede the earlier pre-finalization coverage check. No thresholds or
exclusions changed.

Full-suite verification passed **813 tests / 77 suites** in 411.353 seconds,
including pretest/generated-documentation checks and all three TypeScript
configurations. Instrumented-library coverage is 100% for statements, branches,
functions and lines (5,445 statements, 4,044 branches and 978 functions, none
uncovered). This excludes the separately measured diagnostic scripts above.
Result: `coverage/recovery-code-full-suite.json`, SHA-256
`562e3d65c12ae5073fa51a5f8cedc25a3e0adf705fb91b22235c0e54b7603999`.
The previous milestone's 777-pass/one-shutdown-timeout result remains recorded;
the same test passing now does not explain that failure or waive it as harmless.

The senior critic independently verified source/report/log hashes, serialized
census reproduction, all phase measurements, grouped events and function identity.
Both the preflight and findings write-up were approved with no outstanding finding.
After updating the evidence, generated-documentation and TypeScript checks passed
again, followed by 63 focused documentation/diagnostic tests across four suites.

## Next causal question

The shortlist is now specific: the HTTP/WebSocket handshake and stream lifecycle,
plus the load-test event helpers. Investigate why these functions acquire multiple
optimized versions (deoptimization reasons and dependency invalidation), then
verify surviving code/feedback objects and retaining paths if needed. Do not
rewrite Redweb or its client based only on these creation counts: this native
load generator does not import either runtime. No acceptance workload, warm-up,
memory limit, production source, dependency, frozen helper, npm link, publication,
deployment or merge changed. Release gates remain open.
