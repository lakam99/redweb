# Coverage scope and remaining work

This inventory separates shipped authored code from verification machinery.
Passing behavior tests do not establish complete coverage; a coverage report's
instrumentation hash alone does not prove correspondence with current source.
No aggregate whole-repository 100% claim is made. This does not waive the open
coverage requirement in `AGENT_READY_ACCEPTANCE.md`.

## Established scopes

- Library: all 91 files in the configured root-entrypoint / `src/**/*.js` scope,
  5,449 statements, 4,046 branches, 978 functions and 4,468 lines, all 100%.
  Latest full local evidence: 1,322 tests/128 suites for the source set in `1049ff8`,
  with two POSIX-only skips, including the
  benchmark, terminal-interruption, generator, memory, load and navigation corrections. Exact
  scoped/full-run results are below; the preceding runtime/resource/package checkpoint remains
  in `ADMISSION_TIMEOUT_VERIFICATION.md`.
  Exact current full-run and isolated package evidence is in
  `ACTION_INPUT_VERIFICATION.md`; hosted checks for that head remain in progress.
  The preceding clean load/memory/recovery/soak/audit checkpoint and passing
  workflows remain in `PACKAGED_EXAMPLE_VERIFICATION.md`.
- Shipped `bin/redweb.js`: separate real-subprocess CLI gate, all four 100%.
- Six starter applications and shared `run-app.ts`: original-TypeScript gate,
  104 tests per mode, 600 statements, 299 branches, 160 functions and 472 lines,
  all 100%. Includes the canonical chatroom component.
- Client authored source: 791 statements, 521 branches, 125 functions and 659
  lines at 100%, with 77 tests per mode plus native browser acceptance. Published
  client 0.2.0 runtime bundles match the tested build.
- Emitted frontend and development refresh: separate native-browser gates,
  all-four 100%; not inferred from coverage of strings that generate scripts.
- Site documentation: seven declared modules at 100% line/branch/function
  coverage, six tests and real HTTP/build checks; not whole-site coverage.
- Server recovery policy/coordinator/CLI: maintained CI coverage command,
  76 tests/five suites, 132 statements, 25 branches, 25 functions and 120 lines,
  all 100%. See `SERVER_RECOVERY_CANDIDATE.md` for exact report identity.
- Shipped `recipes/shared/copy-assets.cjs`: `npm run verify:assets:coverage`
  now measures the original source under c8 through actual subprocess/filesystem
  tests and requires all-four 100% in CI. Nested CSS/HTML copying, excluded source
  files, existing compiled-code preservation, stylesheet replacement and a missing
  source failure are checked without mocks. This closes one of the initial eight
  shipped-source gaps.
- Both `recipes/add` authored templates: the existing addition matrix now runs
  each generated page, component and socket route normally and instrumented,
  using actual HTTP/WebSocket tests in CJS/ESM and standard/legacy decorator modes.
  All twelve generated artifacts require complete original-source coverage.
  Unit coverage of template generation remains in the library scope.

Addition evidence: all six enclosing tests passed in 87.697 seconds on Windows,
Node 22.21.0 / TypeScript 5.9.3. Each page/component covers three statements/lines
and two functions; each socket route covers four statements/lines and two
functions (no authored branches). All four metrics are 100% for each artifact.
Reports under `coverage/addition-source/` retain pre-build source/test/template/
compiler-config and collector fingerprints, plain/instrumented outcomes and raw
child maps, including failure evidence outside disposable workspaces. Run IDs:
`851bfab5-4ebf-45e9-917e-07935946a060` (CJS standard),
`8a047f5d-5c49-4371-b6be-5b20d5f461d6` (ESM standard),
`5d36acc9-7a40-4a06-a46b-2de3069103cd` (CJS legacy),
`c11c44cf-656d-4f45-8d56-e493d8444c11` (ESM legacy).
The independent critic approved the source correspondence, failure reporting,
module-format handling and bounded process cleanup. Both CI runs at `0ca4a7f`
also passed; the addition extension above follows that checkpoint.

Asset-copier evidence (Windows/Node 22.21.0): two integration tests pass; all eight
statements/lines, three branches and one function are covered. Original source
SHA-256: `5e340377eec8a59b64e0dc0d5791de0826dec8b82d40c3502b67eda6f7aaefee`.
Report `coverage/recipe-assets/coverage-final.json` SHA-256:
`bc857afaed89d95aea1bfa448641f5ac2433467e8eed75afbeec99d2ad12c280`.

The subsequent complete local regression at `db9e469` passed 925 tests/88 suites
in 455.485 seconds with all-four 100% library coverage; report SHA-256:
`38aec4ec3b394f15fa96bfc11d87683a1da83ff9c0fd37f8b21a7a47815e0cab`.
Both [PR CI](https://github.com/lakam99/redweb/actions/runs/33354236822) and
[push CI](https://github.com/lakam99/redweb/actions/runs/33354234299) passed all
Node 18/20/22/24 and lifecycle jobs. The asset-copier tests above were added after
that full run and passed separately; they are not retroactively included in 925.

The exact historical package/client/browser/starter identities and mock boundaries
remain in `CLIENT_POLISH_VERIFICATION.md`, `POLISH_RELEASE_CHECKPOINT.md` and the
acceptance work log. Integration uses actual networking, processes, files and
browsers. Explicit unit fault injection is not called mock-free integration.

## Shipped-source audit gaps closed

The standalone-example gate now measures these five original authored modules:

```text
examples/live-html/cards.ts
examples/live-html/components.ts
examples/live-html/counter.ts
examples/live-html/jsx-page.tsx
docs/snippets/room-access.tsx
```

Generated example `.js` files are compiled derivatives of their maintained
TypeScript, not independent authored implementations. Their compilation and
runtime behavior remain verified by the same unchanged real-network suite against
ordinary and instrumented builds, in standard and legacy decorator modes. The
existing original-source collector covers 56 statements, 20 branches, 25 functions
and 47 lines, all 100%. Each run executes 28 tests across three suites; retained
Jest JSON reports enforce matching inventories, passing statuses and no skips.
Launcher defaults, signal handlers and authorization truth tables have explicitly
separate unit stubs. HTTP, sockets, page actions, authentication, joining,
broadcast and revocation use actual implementations in integration tests.

Final focused matrix: two outer tests pass in 27.915 seconds, Windows/Node22.21.0.
Reports under `coverage/example-source/<run>/report.json`:

| Mode | Run | SHA-256 |
| --- | --- | --- |
| Standard | `87bee699-81ae-47d0-aef4-92eba2efddd8` | `dd708de4786da5beb470b02fd87440be225576290a9f24a7d91bb1d122abdc00` |
| Legacy | `c1d64975-5ecf-4ebb-bda1-66bb6fa8cedc` | `75eeb3ecaca08efee1e9d79f3bd75d8206105839b437d24963c8906dfe42ca24` |

The shared room verifier was extracted rather than duplicating its integration
checks. Review uncovered a cleanup flaw: a rejected peer close could skip server
shutdown and hide the primary error. Both cleanup operations are now attempted
independently, preserving all failures. Eight unit failure combinations plus the
real source-free room integration pass. `npm run verify:room:coverage` enforces
all-four 100% in CI: 47 statements, six branches, five functions and 40 lines.
Source SHA-256: `5484a90e42a45d51552a5bd80796f2c25e0f71cf999f25055edd461469808094`.
Report `coverage/room-verifier/coverage-final.json` SHA-256:
`c1360e5405610039332629493eab4c4aa61b449f96b74b2d1fac7916904830e0`.

Together with asset copying and addition templates, this closes the initial eight
shipped-source audit gaps. It does not close the private-tool inventory below or
claim whole-repository coverage.

## Private tools with existing complete scoped reports

These report directories contain all-four 100% maps for the listed files.
They are separate measurements, not a merged coverage total. Report-to-source
correspondence must be retained from the relevant recorded input/checkpoint before
using an old report to certify new edits.

| Report under `coverage/` | Files (under `scripts/`) |
| --- | --- |
| `package-tools` | `lib/ClientCandidate.js`, `lib/InstalledClient.js`, `lib/PackedBrowserHarness.js`, `lib/preservePackedBrowserReport.js`, `lib/verificationError.js`, `lib/compile-consumer.js`, `lib/verify-documentation.js`, `lib/verify-starter.js` |
| `memory-tools` | `memory-worker.js`, `verify-memory-overhead.js`, `lib/MemoryMeasurement.js`, `lib/VerificationWorkspace.js` (updated owner; evidence below) |
| `server-recovery-acceptance` | `lib/ServerRecoveryCandidate.js`, `lib/ServerRecoveryPolicy.js`, `verify-server-recovery.js` |
| `browser-collector` | `lib/BrowserCoverage.js` |
| `application-collector` | `lib/ApplicationCoverage.js` |
| `room-verifier` | `lib/verify-room-example.js` |
| `tool-source/<run>` | `build-live-html-examples.js`, `generate-docs.js`, `generate-protocol-types.js` (separate reports below) |
| `client-check-preflight` | `lib/ClientSourceCoverage.js`, `lib/reportCommand.js` |
| `compatibility-capture-runtime` | `diagnostics/ClientHeapCapture.cjs` |
| `code-attribution-native` | `diagnostics/CodeAttribution.cjs`, `diagnostics/HeapCodeComparison.cjs`, `diagnostics/HeapSnapshotGraph.cjs`, `diagnostics/recovery-heap-graph.cjs`, `diagnostics/recovery-heap-summary.cjs` |
| `recovery-deopt-native-final` | `diagnostics/DeoptimizationCensus.cjs`, `diagnostics/recovery-code-summary.cjs` |

The independent critic confirmed the five attribution/graph files are unchanged
since reviewed checkpoint `8a15569`, the two deoptimization parsers since
`8b4694c`, and capture since `daacdac`. Do not substitute the older
`client-source-collector` report for expanded checkout validation or the older
`recovery-native-exact` map for the later shared-graph extraction.

## Generator checkpoint: ba4a0bc

The example builder now rejects invalid compiler options and configurations that
emit no JavaScript. Windows malformed-config paths are normalized before asking
TypeScript to format diagnostics, avoiding its internal path assertion. Actual
compiler tests cover `.js`, `.mjs`, `.cjs`, type errors, skipped emission and
non-emission, import rewriting, missing/stale output and CRLF equivalence.
The documentation generator's existing release/snapshot/README checks are reused
with explicit released/unreleased fixtures, not duplicated or dependent on the
repository remaining unreleased. Protocol output is checked against exact types.

`npm run verify:build:coverage` runs identical real CLI cases against ordinary and
original-source-instrumented scripts. It reuses `ApplicationCoverage` and the
managed workspace owner. Fixture files, compiler, original script, test, collector
and helper inputs are fingerprinted. Each instrumented invocation, including an
expected command failure, must produce exactly one validated raw coverage map;
ordinary invocations must produce none. Matched command inventories and source
correspondence are required before accepting complete coverage. Reports survive
temporary-workspace cleanup. CI retains them for 30 days on success or failure.

Final focused run: 12 passing tests/four suites in 26.592s, Windows/Node22.21.0,
TypeScript5.9.3. Three unrelated documentation tests are intentionally filtered by
this command, not counted as passing. Integration uses actual compiler, files and
processes, with no API mocks. Five explicitly labelled unit fault cases inject
falsy thrown values; real-process negative controls remove/duplicate/add owned
report files to prove invalid evidence is rejected. The critic approved the
implementation, cleanup budgets and actual PR head.

| Original script | Statements | Branches | Functions | Lines | Child reports |
| --- | ---: | ---: | ---: | ---: | ---: |
| `build-live-html-examples.js` | 35 | 18 | 8 | 28 | 16 |
| `generate-docs.js` | 50 | 37 | 7 | 42 | 41 |
| `generate-protocol-types.js` | 13 | 6 | 1 | 12 | 7 |

Every listed metric is 100%. Reports under `coverage/tool-source/<run>/report.json`:

| Script | Run | SHA-256 |
| --- | --- | --- |
| Example builder | `6d6d82f8-db83-456a-b429-58d8613a6f00` | `c48f5076a0e325e2cd93ea2b015c327e0e319fa0317cfec1eb4903563789dec1` |
| Documentation | `6df5c048-eab7-4462-8108-008dd0f32658` | `d8f8a7a69848000006f34ae4b2276183948313fe71fccefe260772ddcbb8c2ab` |
| Protocol types | `74c46f2f-ea89-4814-849c-01d70d13b86f` | `6f35424ef444a384a04f287b88249c63481d00381d7552689313c4bfde3d4fd0` |

All current tooling hashes, paired inventories and 64 raw-report hashes were
rechecked after this run. Full local regression at the same code checkpoint
passed all 951 tests/95 suites in 517.317s, including normal pretest/generated/type
checks. Library counts remain those listed above, all-four 100%.
`coverage/coverage-final.json` SHA-256:
`24b22792ad69ee6460f2282814046ccb6c53796be25008bb11b0c9389d62e456`.
Hosted PR33358575524 and push33358573729 subsequently passed, as did the evidence
follow-up `3c4010e` PR33359014962 and push33359012472. No new runtime/resource/long-soak result, npm publication, deployment
or merge is claimed by this build-tool increment.

## Memory verifier correction: 7e94e99

An actual zero-client command previously exited zero with null per-connection
values and zero computed metadata. The correction validates positive safe counts,
derived capacity/trial arithmetic and finite budgets before launching workers.
Complete worker JSON must match the requested mode/count, contain a safe signed
heap delta and a finite per-connection value equal to that delta divided by count.
Invalid/duplicate JSON, missing trials and non-finite comparisons cannot pass.

The existing workspace owner runs sequential workers with 60-second deadlines.
Its new opt-in strict-output flag rejects a truncated stdout or stderr stream;
ordinary callers retain the existing bounded-tail behavior. Real child tests
prove that oversized junk followed by a valid JSON tail still fails strict mode.
Each worker owns peers before waiting for connection, attempts every peer/server
cleanup independently, and prints success only after cleanup. The existing nested
error formatter preserves primary and cleanup failures at the CLI boundary.
Defaults (500 clients, three alternating trials, 2,048-byte limit), batches,
sampling points, GC sequence, upper median and signed deltas are unchanged.

The actual uninstrumented default run passed: legacy 8,901.888, enabled 10,783.68,
and computed metadata 1,881.7919999999995 bytes/connection, below 2,048.
Small four-client integration fixtures verify mechanics, not this acceptance
budget. They launch real processes/sockets/GC for all nine feature modes and
invalid CLI inputs; no integration API mocks are used. Launcher, configuration,
report and injected cleanup-failure units are explicitly separate.

The initial scoped gate passed 68 tests/four suites in 41.838s. Full Windows
regression then passed all 1,001 tests/98 suites in 506.606s, including pretest and
type gates, with all-four 100% library coverage. Report SHA-256:
`761a9158ddd829a3aed9f81f8e3dd21aaa02f58bcea440daaf293c6e11f4cab3`.
All Node18/20/22/24 jobs passed in both [PR CI](https://github.com/lakam99/redweb/actions/runs/33359772699)
and [push CI](https://github.com/lakam99/redweb/actions/runs/33359769989).
Both lifecycle jobs failed coverage: Linux passed all 66 selected tests but skipped
two Windows-only file-lock cases, leaving the shared owner's removal-error branch
uncovered. Later lifecycle/package/browser steps were skipped, not passed.

The follow-up keeps the 100% threshold and adds two portable deletion-failure unit
cases plus two real POSIX nonempty/non-writable-directory cases. Root skips the
permission cases because its privileges bypass them; portable unit cases remain
active. Permission restoration and unit-spy restoration precede test cleanup.
The revised Windows gate passes 70 tests/four suites in 40.634s with two explicitly
skipped POSIX cases. These new cases are not retroactively included in 1,001 above;
hosted verification of the correction passed in both `e035657` runs. CI now retains memory coverage
maps on success or failure. The critic approved both actual code and this correction.

The maintained `npm run verify:memory:coverage` Jest/Istanbul scope is all-four100%:
163 statements, 93 branches, 30 functions and 139 lines across four files.
`coverage/memory-tools/coverage-final.json` SHA-256:
`30d70e08956b46e13bb4c004c60eed30a4f12ba56f47c1cfc20c18827980c395`.

| Source (under `scripts/`) | SHA-256 |
| --- | --- |
| `memory-worker.js` | `ad949d7061081df8b32f2e650d3c861f1e32aafaac1efef7bd164cb633a9441c` |
| `verify-memory-overhead.js` | `5f5aa797a68c0591695a39fcd497ab9b6590c7f0012dd5f457e16ccc21fb64f0` |
| `lib/MemoryMeasurement.js` | `f71d11dd56e18f8ab0e0a3252620d05bdd60f1f84864a39d0c9fe16809e3b1ae` |
| `lib/VerificationWorkspace.js` | `21ba3dea77089ef6ba90ae2cf5c93671ad5822251a014a4548ef04506ec6407c` |

An exploratory native c8 map was partial and is not represented as complete native
coverage. The above scope combines explicitly instrumented unit coverage with
separate actual process/socket integration. It does not replace the remaining
private-tool inventory, certify older owner maps against its new strict-output
code, or claim a new long soak/publication/deployment/merge.

## Load verification and navigation follow-up

The `e035657` push [33360581687](https://github.com/lakam99/redweb/actions/runs/33360581687)
passed every job. Its PR [33360585345](https://github.com/lakam99/redweb/actions/runs/33360585345)
passed memory coverage and all Node18/20/22/24 jobs, but failed the packed refresh
browser phase at a heading-readiness expression with `Uncaught`; soak was skipped.
The saved log does not retain the underlying browser exception. Two exploratory
streamed-document probes timed out before reaching that predicate and cleaned up;
they are not successful reproductions. A maintained real-HTTP/native-browser case
now establishes that the old expression throws a TypeError when the heading is
absent, while the shared null-safe predicate returns false until the exact heading
exists. Unrelated evaluation errors remain fatal. Both ordinary and instrumented
refresh runs pass (report `07037c8f-d4d9-4e22-9af6-1d2c921f6b7e`), retaining all-four
100% of the unchanged generated refresh source. CI retains packed-browser reports
on success and failure. The original CI failure is not relabelled passing.

An actual load run accepted `NaN` latency/throughput limits and exited zero. The
corrected policy rejects invalid limits before opening sockets, consumes exact
per-client outstanding IDs once, and requires finite complete results. Workload
defaults remain 32 clients, 100 messages each, 250ms p99 and 500 messages/second;
one request per client, JSON parsing before latency completion, the 30s response
deadline and original slow-consumer probe remain. Partial acquisitions settle
before cleanup. Socket close now waits for actual CLOSED state after termination;
a real paused-peer test failed before this fix. Synchronous close failures cannot
skip termination or abandon observers, and probe/cleanup failures remain visible.

`npm run verify:load:coverage` passes 41 tests/six suites in 40.628s on Windows,
Node22.21.0: 213 statements, 99 branches, 41 functions and 160 lines, all100% across
four files. Explicit coordinator/transport boundary units are separate from actual
WebSocket/CLI/timeout integration; no API mocks occur in those integration cases.
The coverage run is not the clean performance measurement. Report SHA-256:
`07c1e9e492ea88262c594114d62d73d1579d74fcbd2b23f3701da6ed465ab8be`.

| Source (under `scripts/`) | SHA-256 |
| --- | --- |
| `verify-load.js` | `551e318a275658d3cc70343ce26d838fe4ca45692c79038d2e05020e1555e8ef` |
| `lib/LoadMeasurement.js` | `4c6b23311a7db539c971df5676cd0df133f99861b042e6c4fbc3667dee6a36e2` |
| `lib/measureLoadTraffic.js` | `8e68504a61efcf21813779e37d413b5e8bd4b8692af6cc31469a478ae1351370` |
| `realtime-harness.js` | `12e5905b576cc861017a1a18393bac347d122db5a19e22a7804dbd65031add22` |

Before the critic's final synchronous-failure refinements, default load passed
6,659.875 messages/second and 6.4039ms p99; memory passed1,881.744 bytes/connection.
Server recovery delivered all7,400 replies, peaked109.0175% and finished97.1814%
of warm heap. The30s/16-client soak passed all eight trends, with4,352 sent and4,348
received (99.9081%, not lossless), zero final registries and100.3442% final warm heap.
The original shared-process recovery diagnostic failed its110% limit at111.4056%
despite finishing97.9749%; that remains visible and non-blocking by the approved
contract. These interim measurements do not certify the final helper hash above
or constitute a new60-minute soak. Final clean regression/hosted follow-up remains
pending at that interim checkpoint; no publication, deployment or merge is claimed.

Final `d576278` verification (Windows, Node22.21.0): the full command including
pretest/types passed1,045 tests/105 suites in570.020s, with two POSIX-only skips
and all-four100% of the unchanged91-file library scope. Full report SHA-256:
`b350add1cf03432f77ad0a8f0844195c25a56dabd1656ef4564d2f3e5c82746e`.
Both [PR33362263127](https://github.com/lakam99/redweb/actions/runs/33362263127)
and [push33362261457](https://github.com/lakam99/redweb/actions/runs/33362261457)
passed every Node18/20/22/24 and lifecycle job, including packed refresh, retained
coverage artifacts and the short soak. No selective retry hid the prior failure.

After other local test/package jobs exited, sequential uninstrumented checks
passed: default load5,683.736 messages/second,7.1724ms p99 and contained slow peer;
default500-client/three-trial metadata1,881.744 bytes/connection; server recovery
all7,400 replies, peak108.5190% and final96.9803% of warm heap, with empty registries.
Client113.0027% remains diagnostic, not server acceptance. HTML load passed200
expired renders/110 clients with8,058,856-byte heap delta; JSX10,000rows passed in
56.7ms with1.3MiB retained. The30s/16-client soak passed all eight resource trends,
4,368 sent/4,364 received (99.9084%, four missing—not lossless), zero final registries,
100.3000% final warm heap and handles1→2. This does not replace the historical60min
soak. Production audit reports zero vulnerabilities with certificate validation on.

The completed local package gate verified publishedclient0.2.0, all generated and
source-free consumers plus native browser acceptance/runtime/refresh. Archive hash
`0fb2dce8fdd6b51ed5b607e5bdb47bc2c5f893f96a823a40295fd06356aa6415` predates this
increment's README/evidence-only edits; runtime/harness fixes match the checkpoint.
Packed report `75975202-ee63-4880-ab92-91f6cf1e65ee`, SHA-256
`fc53aaedc67693c7b42774af7c7255761222ae7cb70f3f201465cb06cd4d2653`.
Hosted package checks above cover the committed documentation too. The senior
critic approved all20 remote changed-file blobs with no remaining findings.
Site checkpoint `20f56dd` synchronizes canonical docs locally:98pages/154assets,
all HTTP/link/download and atomic rollback checks, six tests/seven scoped modules
at100% line/branch/function coverage. No site deployment or npm publication occurred.

The documentation-only `4267db1` follow-through passed both hosted runs:
PR33363026371 and push33363023458, including every matrix and lifecycle job.

The subsequent disabled-feature benchmark increment closes unchecked worker
values, unbounded response waits and incomplete reply accounting. Its six-module
scope reaches all-four100% (204 statements/111 branches/30 functions/174 lines),
52 unit and actual-network/process tests. The shared strict-output owner now also
rejects truncation on failed exits; its updated memory-tool scope passes71 tests
with two POSIX-only skips and all-four100%. See `BENCHMARK_VERIFICATION.md` for
precise boundaries and retained performance results: the first default registry
comparison passed, but the second failed the unchanged3% throughput limit at
4.7850% regression. This remains an open performance result, not waived by
coverage, an earlier pass or the separate recovery diagnostic decision.

Final benchmark implementation verification at `43c6d73`: full1,098 tests/110
suites,614.552s, two POSIX-only skips and all-four100% library coverage. Both
PR33365382012 and push33365378641 passed every hosted job. Sequential default
load/memory/server-recovery, HTML/JSX, short-soak and audit checks also passed;
exact counts/hashes and remaining throughput failure are retained in
`BENCHMARK_VERIFICATION.md`. The critic approved all21 remote changed-file blobs.
One bounded diagnostic profile pair found no candidate-specific hotspot and does
not justify speculative runtime changes or waive the default benchmark failure.
The local site was synchronized and tested at `caa166f`; nothing was published.

## Remaining private-tool measurement gaps

The unchanged application recorder now has a direct maintained source scope:
six selected tests/two suites, six statements, two branches, one function and six
lines, all 100%. The actual exit/pipeline checks remain separate from the direct
callback unit. A native converter omitted the anonymous callback from its function
denominator; that older zero-function map is diagnostic only, not accepted as
authored function coverage. Source/report identity and scope are documented in
`APPLICATION_RECORDER_VERIFICATION.md`. Eight unrelated cases are filtered.

The soak correction adds a direct maintained scope: 80 tests/four suites cover
241 statements, 100 branches, 65 functions and 173 lines at all-four 100% across
the coordinator, measurement policy and socket owner. Native undersampling
reproduction, exact reply/ownership checks, preserved acceptance boundaries and
short-run results are in `SOAK_VERIFICATION.md`. Full regression passed 1,246
tests/119 suites with two POSIX-only skips and unchanged all-four 100% library
coverage. This is not a new one-hour soak or a substitute for the unresolved
benchmark result and remaining hosted/release gates.

The next Live HTML load correction closes its direct coverage gap:54 tests/three
suites, all-four100% across the coordinator, bounded HTTP reader and client owner
(195 statements,49 branches,52 functions,139 lines). Exact source/report hashes,
native malformed-JSON reproduction, fixture correction and unchanged acceptance
limits are in `LIVE_HTML_LOAD_VERIFICATION.md`. Clean default load passed200
renders/110 clients with6,824,576-byte heap growth. The critic approved the scoped
correction. The full regression then passed 1,152 tests/113 suites in 631.578s
with two POSIX-only skips and all-four 100% library coverage; source/report
identity is retained in that document. Hosted verification remains pending. This does not waive
the separate unresolved benchmark throughput result.

The JSX performance verifier now has a maintained direct scope: 14 tests/two
suites cover 27 statements, eight branches, four functions and 23 lines, all 100%.
Exact markup validation replaces the demonstrated false-pass predicate, while
timing and memory limits remain unchanged. Native CLI checks and explicit boundary
units are separate; the critic approved the correction. See
`JSX_PERFORMANCE_VERIFICATION.md` for hashes and measurement boundaries. These new
tests are not retroactively included in the preceding full regression inventory.

Only partial historical maps were found for these files; they changed after some
reports, so historical percentages do not certify current coverage:

```text
scripts/diagnostics/recovery-split.cjs
scripts/diagnostics/recovery-split-worker.cjs
scripts/verify-recovery.js
```

The packaged-example probe, its dependency coordinator and guarded action helper
now have a maintained exact source scope: 40 tests/five suites, 178 statements,
44 branches, 20 functions and 150 lines, all 100%. Explicit fault units complement
actual native peers and a clean packed/installed consumer that compiles and runs
generated additions. The probe VM map is private outside its explicitly selected
scope; the library denominator is unchanged. See `PACKAGED_EXAMPLE_VERIFICATION.md`.

The action-input verifier now has its own maintained scope: 42 unit/native tests
across three suites cover 63 statements, eight branches, nine functions and
53 lines at all-four 100%. Both source-free decorator compiler modes and the
original action/context/revocation assertions remain in the native integration
flow. Outer test budgets and cleanup were corrected without changing the inner
limits. The final scope, isolated package and full regression gates pass.
See `ACTION_INPUT_VERIFICATION.md`.

The starter measurement/authored coordinators below now retain available raw
reports before parsing or workspace cleanup. Their shared `reportCommand` helper
has a maintained 15-test scope at all-four 100% (16 statements, eight branches,
one function, 14 lines). This does not remove either coordinator from the remaining
direct-coverage list. See `STARTER_REPORT_RETENTION.md`.

No direct coverage map was found for these remaining active verification/build files:

```text
scripts/measure-starter-coverage.js
scripts/verify-browser-coverage.js
scripts/verify-client-source-coverage.js
scripts/verify-development-refresh-browser.js
scripts/verify-live-html-browser.js
scripts/verify-live-html-package.js
scripts/verify-starter-lifecycle.js
scripts/verify-starter-source-coverage.js
scripts/lib/verify-action-feedback.js
scripts/lib/verify-dashboard-browser.js
scripts/lib/verify-live-page-ownership.js
scripts/lib/verify-packed-browser.js
scripts/lib/verify-refresh-controls.js
scripts/lib/verify-refresh-coverage.js
scripts/lib/verify-runtime-browser.js
```

Frozen evaluation tooling also lacks a complete direct map in the reviewed set:

```text
scripts/evaluation/prepare.js
scripts/evaluation/process.js
scripts/evaluation/run-trial.js
scripts/evaluation/seal.js
scripts/evaluation/validate.js
scripts/evaluation/verify.js
```

Keep frozen source/evidence unchanged. The evaluation fixture, recipe tests,
shared test networking, repository tests/helpers and fixtures are test
infrastructure, not silently part of the library denominator. The client’s
standalone Node-only V8 diagnostic remains a separate known failure; original
authored-source and browser coverage do not relabel it passing. Coverage work
does not require restarting the deferred scientific runtime investigation.

Load policy, reply accounting and helper coverage are now recorded above. Remaining
verification machinery still needs direct coverage; valid historical workload
results are not silently replaced by smaller coverage fixtures.
