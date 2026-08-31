# Coverage scope and remaining work

This inventory separates shipped authored code from verification machinery.
Passing behavior tests do not establish complete coverage; a coverage report's
instrumentation hash alone does not prove correspondence with current source.
No aggregate whole-repository 100% claim is made. This does not waive the open
coverage requirement in `AGENT_READY_ACCEPTANCE.md`.

## Established scopes

### Frozen candidate preparation

`verify:evaluation:prepare:coverage` passed five tests in 12.289s on Windows /
Node 22.21.0. Two native tests use actual npm/tar/git execution: plain and
in-memory-instrumented CLI runs must produce matching archive, catalogue and
commit identities; a failed launch from an absent source directory must not
create a success manifest. Assertions verify emitted/on-disk manifest parity,
actual byte hashes, host metadata and empty trial directories. Temporary
artifacts are confined to the test's owned directory and removed afterward.
Frozen failed-preparation retention is not silently redefined as tool cleanup.
Three explicit subprocess-result units verify error/stderr/stdout precedence
and POSIX launch options; they are not native fault simulations.

The unchanged source covers 25 statements / eight branch outcomes / three
functions / 21 lines at 100%, including all three independently inventoried
functions. The previous existing-test baseline measured preparation at zero;
behavior-only success did not establish this scope. Retained map
`coverage/frozen-prepare-evidence/coverage-final.json` has SHA-256
`045d8055f326a8c9252426698bf12cbdc194e34856b856532b9d877377f520d1`;
unchanged LF-normalized source SHA-256
`9647fad32399076f10e5bafa29d65d9837f7f9066b82b3b989642ceb63d05106`.

The small `FrozenCoverage` test helper extracts the sealing test's existing
original-filename instrumentation, source-identity checks and exact map-shape
validation. It is test infrastructure, not silently included in the library
denominator. The maintained process/sealing regression passed 40 tests with one
skip in 8.054s; its complete map remains byte-identical, retained as
`coverage/frozen-prepare-evidence/process-seal-regression.json`, SHA-256
`cea882c6209d0dc9c03a28140ce81038cfbd613628ec3a04a8900c487d7f8b75`.
CI bounds and preserves the preparation map separately. No frozen source,
sealed evaluation, publication, new agent trial or acceptance limit changed.

### Explicit zero-budget page shutdown

The b2ca53a PR Node 18 [job](https://github.com/lakam99/redweb/actions/runs/33416866879/job/99569507960)
passed 1,770 tests with ten skips, but failed aggregate coverage at
99.92/99.97/99.89/99.91. Missing PageManager lines 532–534 and 540 identify render
drain timeout/reporting and outstanding render-page disposal. The existing native
test gives shutdown and aborted-render cleanup competing 20ms deadlines; either
can finish first. That explains a plausible coverage race, not proof of the
historical run's precise timer order or a runtime shutdown defect.

A focused unit uses real PageManager/LivePage ownership and controlled application
promises, with no timer/API mocks. Zero shutdown budget requires both timeout
causes and empty registries; application promises are released afterward. The
real-HTTP test now covers both zero and the existing 20ms budget, requiring the
nested render-timeout cause only for zero. Runtime source and limits are unchanged.

The full focused selection (all `tests/htmx`, `tests/unit/page-access.unit.test.js`,
and the page-access, live-html, reactive and runtime-diagnostics integration files)
passed 125 tests on Windows Node 18.20.8 in 11.199s and Node 22.21.0 in 10.285s.
PageManager covers 462 statements / 303 branches / 87 functions / 372 lines, all
100%. Both `coverage/page-shutdown-complete-node18/coverage-final.json` and
`coverage/page-shutdown-complete-node22/coverage-final.json` have SHA-256
`0e2653a6978178246aa8a73cefb1f5465bdd97713a93f034281fa9865335b344`;
unchanged LF-normalized source SHA-256
`8917ac1cb84cc6b5535c6aee95990842e374db06cb033e4d69e2a57ce3d47520`.
Earlier 38-test and 90-test partial selections passed behavior but failed coverage
because they omitted other existing PageManager paths; they are not acceptance
runs. The new tests are included by ordinary full-suite discovery. CI confirmation
and the broader release conjunction remain separate; no historical failure is erased.

### Isolated browser harness dependency correction

Both 665be56 workflows failed ([PR](https://github.com/lakam99/redweb/actions/runs/33415303095),
[push](https://github.com/lakam99/redweb/actions/runs/33415299477)). PR Node 22/24
and lifecycle logs identify `Cannot find module './lib/finishVerificationSummary'`:
the browser coordinator gained a shared dependency absent from the explicit
copied harness. Local browser-only success did not exercise that copy boundary.
b2ca53a also contains that omission; its earlier tool-coverage result is not a
passing isolated-package result.

The correction adds the unchanged helper to the copied set (26 to 27 files).
A TypeScript AST-based unit regression resolves every literal relative import
into `scripts/` or `tests/` from the real copied files and requires membership
in the fingerprinted input set. It fails on the preceding list. It does not
claim dynamic-import completeness or turn synthetic runtime-resolution fixtures
into integration tests. All 12 harness units pass in 1.483s, covering 53 statements,
11 branch outcomes, nine functions and 49 lines at 100%; the existing maintained
`verify:package:tools` command already includes this file and test selection.

The full `verify:package:coordinator:coverage` rerun passed 71 tests in 266.225s
on Windows / Node 22.21.0: the actual isolated package/registry-client workflow,
two real listener-cleanup cases and 68 explicit unit/filesystem cases. Normal TLS
verification used the system CA store; the environment override was restored.
Coordinator 173/69/12/162 and report helper 21/6/3/16 remain all-four 100%.
The owned temporary package workspace was removed normally. Runtime coverage
426/262/64/351 and refresh coverage 82/44/12/71 are complete; both refresh modes
observed actual back-forward-cache restoration. Real counter/chat, reconnect,
disconnect, authenticated dashboard and source-free generated applications passed.

Retained evidence:

- `coverage/package-harness-correction/harness-coverage.json`, SHA-256
  `c5b127f32a3bd382328e157e51b249871c9850db2d9d7af278c7a61be1e8cccc`.
- `coverage/package-harness-correction/package-coverage.json`, SHA-256
  `199e25f0d8f67c35119dbcd86e227ba6dace836aea14fe29e8d4f20d99791faa`.
- `coverage/packed-browser/2d7c8451-791e-4f36-9513-43f6fe67df54/report.json`, SHA-256
  `7598586fece41f5ae55f187932ad25a281cae6361259681d22629b5c26901552`.
- Packed archive SHA-256
  `c21f55ab86f74970a5cca9d4a93953e99d50ba17658e592b408807664c361f12`;
  211 package files / 27 unchanged harness inputs, registry client 0.2.0 without
  candidate override. The archive predates this evidence/documentation update,
  and the browser report is phase-specific, not a transcript of the whole gate.

Independent review approved the dependency correction and regression boundary.
Original throughput/client/Linux-cleanup diagnostics remain open. No new hour
soak, publication, deployment, merge or whole-repository 100% is claimed.

### Frozen evaluation process and sealing tools

`npm run verify:evaluation:process:coverage` measures the existing process and
sealing implementations without rewriting either source or any sealed evaluation.
The final Windows / Node 22.21.0 selection passed 40 tests with one platform skip
in 7.634 seconds: 23 explicit OS/process-boundary units and 17 real process,
filesystem/archive, CLI and listener checks. The existing 15 tests had passed
behavior but measured only 84% statements, 59.37% branches, 100% functions and
91.07% lines; that baseline coverage command failed and remains distinct.

Both authored files now have all-four 100%: process 52 statements / 25 branch
outcomes / 12 functions / 36 lines; seal 23 / 7 / 7 / 20. The reviewer independently
matched all 19 AST functions and complete map inventories to unchanged source,
with no coverage-ignore directives. The maintained command repeats the tested
selection; CI retains its map separately from actual agent-evaluation results.

A small test-only CommonJS preload substitutes instrumented source in memory,
preserving the real CLI filename, `require.main`, dependency resolution and
filesystem paths. The native sealing test checks that recorded checker identity
matches the original file, validates the emitted map's original-source locations,
and proves a second invocation cannot overwrite the first seal. Its synthetic
archive is only byte-sealing input, not a valid npm package or new agent trial.
The test loader is test infrastructure, not silently part of the library scope.
Native interface inspection runs only on Windows; other platforms check explicit
rejection. Platform-boundary doubles are not claims of native cross-platform faults.

Retained map: `coverage/frozen-process-seal-evidence/20260831-1657/coverage-final.json`,
SHA-256 `cea882c6209d0dc9c03a28140ce81038cfbd613628ec3a04a8900c487d7f8b75`.
Unchanged source SHA-256 identities:
process `8bfbf3ad3887b7f215b14414cc9433c1a1f0776f109c41cf2f5c7a6d02ed340b`;
seal `46bf4a65fef83f43ab9a7ec9250c2eeada06d35ffb19acefd4f6d4cac87ce09e`.
This closes these two direct-map gaps, not the other frozen tools, original Linux
cleanup observation, client/throughput diagnostics or release alignment.

### Browser coordinator terminal evidence and direct coverage

The coordinator reuses `finishVerificationSummary` to preserve primary errors and
retained-workspace identity, normalize rejected values, and retry terminal report
publication once with failed status. Correction is best-effort: persistent writes
can leave stale/partial evidence, but the command still rejects. Ten new report regressions failed on the
preceding implementation. Application shutdown failure now attempts guarded
listener unref, preserving uncertainty rather than claiming termination. Redundant
mode/launch flags were removed after checking their reachable states; no browser
assertions, collection scopes, cleanup deadlines or performance limits changed.

The maintained `verify:browser:coordinator:coverage` combines the coordinator with
the four already-covered runtime/refresh helpers, replacing the two separate
native invocations inside the umbrella browser gate. Final Windows / Node 22.21.0 /
Chrome 152.0.7977.64 execution passed 109 tests in 81.961 seconds: 101 units and
eight native integrations, with the linked-source case explicitly enabled. The
separate collector selection passed 27 tests in 3.931 seconds. All five authored
files are 100% statements/branches/functions/lines: coordinator 187/69/35/143;
page owner 32/2/5/29; runtime helper 58/0/5/55; refresh controls 206/60/26/165;
refresh coverage helper 189/44/34/132. Embedded browser-expression execution is
not measured by this host map; separate frontend/refresh maps remain required.

Evidence: `coverage/browser-coordinator-evidence/20260831-1636/`.
The exact authored map SHA-256 is
`846afe1d2aa625c7250cbe41670ad6732cab341acfdda7ef759cce1d6a7a5e15`;
coordinator LF-normalized source SHA-256 is
`3086c58d65701eda7639fc526a3d5c675df5cb939d4c1846477ce7a45bbef645`.
Retained runtime report SHA-256:
`56f8c564e2f7546789a7f7f973fda967f717e7c0afb75a6f166086a9425a6cb5`;
refresh report:
`ba82d45ef3dc52014954230387bdf885401984d73b5f27b009c6621fe83d6a41`.
Runtime remains 426/262/64/351 and refresh 82/44/12/71, all 100%; both refresh
modes observed actual back-forward-cache restoration.

The installed-client-only diagnostic remains **failed**, at 93.76% statements,
89.57% branches, 100% functions and 96.04% lines. Its retained report SHA-256 is
`22d56f5d24daa3d732fb557021771e65b98573dd629854c4178a1934021bb104`.
The native regression requires a fresh report, completed protocol/network/selection
checks and exactly the coverage assertion failure; an additional reporting failure
cannot pass under the same primary message. This is not client coverage acceptance.
The separately enabled source CLI passed its actual client tests, source builds,
browser checks and 791/521/125/659 original-source scope at 100%. It requires
`REDWEB_VERIFY_CLIENT_SOURCE=1`, a linked checkout and development dependencies;
ordinary registry-only CI skips that extra case (108 tests plus one skip).
The standalone source gate is unchanged.

Failure history is retained: the first native baseline had three passing cases,
the known incomplete-client failure, and a new test-driver realm mismatch when
calling the source CLI within Jest. Running the actual CLI in its native process
corrected the driver without weakening source inventory assertions. Baseline host
coverage was 81.67/67.07/79.41/90.41%. A later 54-test run passed behavior but failed
97.36% coordinator branch coverage; the first 109-test combined run likewise
failed at 99.43% aggregate branches. Its map is retained under
`coverage/browser-coordinator-evidence/20260831-1635-partial/`. Removing unreachable
state and exercising signal termination completed the direct map; none of those
earlier commands is relabeled passing. Independent review corrected the source
test's CI prerequisites and the diagnostic's aggregate-error oracle before the
final run. Frozen tooling, original performance/Linux cleanup findings, and
publication alignment remain open.

### Package coordinator failure and coverage follow-up

The package coordinator now normalizes rejected values at browser/harness/report
boundaries and owns each example server immediately after acquisition. A small
local owner is shared by the example group and smoke example; every shutdown is
attempted independently and bounded, with uncertain cleanup retained. Render
waits are bounded. Success is printed only after workspace cleanup completes.
Consumer assertions, isolated registry-client resolution and browser workloads
are unchanged. Private exports are test seams, not public npm APIs.

Sixteen new regressions failed on the preceding implementation. Final Windows /
Node 22.21.0 / Chrome 152.0.7977.64 verification passed 71 tests in 265.812 seconds:
68 unit/filesystem cases and three native integration cases. Explicit dependency
doubles are unit tests, not no-mock integration. Native cases run the full packed
consumer/browser workflow and prove two real HTTP listeners are closed after a
later constructor or acceptance failure, before rescue cleanup. The full consumer
case follows the dashboard's Node floor and is skipped on unsupported Node versions;
native ownership cases still run there.

`npm run verify:package:coordinator:coverage` maintains 100% statements, branches,
functions and lines: coordinator 173/69/12/162, report helper 21/6/3/16. Retained map
`coverage/package-coordinator-final/coverage-final.json`, SHA-256
`199e25f0d8f67c35119dbcd86e227ba6dace836aea14fe29e8d4f20d99791faa`.
The baseline consumer passed, but its direct coverage command failed at
85.71/66.19/87.5/87.16%; it is not relabeled a passing command. The earlier unit-only
measurement also failed coverage before adding CLI and native consumer execution.

Packed report: `coverage/packed-browser/6579e832-9946-489c-b1cc-77c5bae47cda/report.json`.
The tested archive SHA-256 is
`d0a9795a7e35456105af26a5a36dcf9c44d2f20a3fcbfad44889b8e2acadc60f`;
it used registry redweb-client 0.2.0 without a candidate override. Acceptance,
runtime and refresh phases passed, with 211 package files and 26 harness files.
Generated frontend coverage remains 426/262/64/351 and refresh 82/44/12/71,
all 100%; both refresh modes observed actual cache restoration. This archive
predates the subsequent documentation/CI edits, not a final release artifact.
CI replaces the standalone package invocation and retains both authored and
packed-browser evidence. Remaining browser/frozen scopes and failed performance
diagnostics are not waived.

### Generated-app development verifier follow-up

The development coordinator now reuses `BrowserPages` for bounded acquisition
and ownership across both templates and standalone refresh controls. Late page
openings remain owned; an unsettled opening retains workspace uncertainty.
Port reservation handles listener and close errors and releases its local handle
after uncertain cleanup. Template failures are normalized before their captured
output is attached; watcher stdout/stderr/unref releases are independently
attempted. HTTP page close checks status/body completion and preserves concurrent
socket-release failures. These changes do not modify generated application/runtime
code, browser assertions, rebuild workloads or existing acceptance deadlines.

Nine new boundary regressions failed against the preceding implementation.
The existing fifteen outer-cleanup units had stopped during template setup and
did not cover these deeper paths. Final verification combines those fifteen with
sixteen explicit dependency-boundary units and four no-mock integrations: the
complete generated realtime/site watcher workflow in Chromium, actual port
rebind, an HTTP 500 with a real WebSocket, and an adverse DevTools peer followed
by natural subprocess exit and temporary-workspace removal. Late/pending page
timing is exercised at unit boundaries, not claimed as a native-browser fault.

Windows / Node 22.21.0 / Chrome 152.0.7977.64: 35 tests across three suites passed
in 71.327 seconds. Authored coverage is 217 statements, 39 branch outcomes,
38 functions and 170 lines, all 100%; no ignore exclusions. This instruments
construction, not execution, of browser-expression strings. Actual browser
checks remain required. The measured command is maintained as
`npm run verify:development:coverage`; CI uses it in place of the old standalone
development invocation and preserves its map on success or failure.

Retained map:
`coverage/development-coordinator-evidence/20260831-1558/coverage-final.json`,
SHA-256 `845db843f705dd889ef5d22082b07413c13256ed0403c80e1dc0b45752e3082c`.
Coordinator source SHA-256 (LF-normalized):
`a23bcd62dddb4fc8aca807682e63beba858e43aa96e8c222cbdd60a04afb7522`.
Independent review approved the acquisition/cleanup correction and new test
oracles. This removes the development coordinator from the missing-map inventory,
not the remaining browser coordinators or frozen tooling. The package coordinator
was subsequently covered above.

### Refresh verifier failure and coverage follow-up

`npm run verify:refresh:coverage` now covers both authored refresh helpers and
replaces the old refresh CLI invocation inside the browser coverage command.
The canonical plain/instrumented browser workload is still invoked once; a
separate native test exercises standalone controls with their default HTTP peer
and without supplemental checks. Real HTTP tests retain malformed, oversized,
aborted and valid uploads, listener conflicts and upgraded-socket cleanup.
Explicit unit doubles cover error boundaries; they are not no-mock integration.

The new regressions reproduced three evidence-handling defects: falsy rejected
values could be swallowed, socket release could replace collection/page-close
errors, and a controls failure could hide an earlier upload error. Both helpers
reuse the shared error normalizer/combiner. Browser behavior and acceptance
deadlines are unchanged. Independent review also required a bounded close and
independent socket release in the new standalone test driver; this was corrected
before the final run.

Final Windows / Node 22.21.0 / Chrome 152.0.7977.64 browser gate passed:
27 collector tests, five runtime-helper tests (7.180 seconds), and 52 refresh
tests (53.535 seconds). The two-file authored scope is 395 statements,
104 branch outcomes, 60 functions and 297 lines, all 100%. An independent AST
inventory confirmed all 26 controls and 34 coverage-helper functions; there are
no coverage-ignore exclusions. This map covers construction, not internal
execution, of embedded browser expressions. Generated refresh coverage remains
82/44/12/71 and runtime coverage 426/262/64/351, all 100%; both refresh modes
observed actual back-forward-cache restoration.

Retained evidence directory:
`coverage/refresh-verifier-evidence/50eccf7b-e6a3-4de4-8bd8-6eea319bdb72/`.
SHA-256 identities:

- Authored `coverage-final.json`: `e1681a8656ab89951f29ac4f82fcff47e79c1f633d2de72f134a78b4ce2ae5c1`.
- `refresh.json`: `22b89f04c38478c3e0464774d8f8ebe1077a021b1753a06a254d962717b34e66`.
- `runtime.json`: `0574735a7144d2b6b46fdcaf1956495ad6e874c21c43bcf304a95d3596742b69`.
- Controls source, LF-normalized: `4602557d0a287e3155d7681edb6c5514ba31bef44425f683cb10974a37aed006`.
- Coverage helper source, LF-normalized: `cfb8297b7167354f48320dee6518eb2930f3ff1bf1e2a1814e4a926d6413b4e4`.

CI retains the authored map with the existing browser artifact. This removes only
these two helpers from the missing-map inventory, not the coordinators or frozen
tooling below. Performance, original Linux cleanup and publication remain
separate open evidence requirements.

### Dashboard verifier follow-up

`npm run verify:dashboard:coverage` measures the authored dashboard verifier
separately. Twenty-four explicitly isolated boundary units cover setup, readiness,
late/unsettled page acquisition and cleanup. The `unref` case failed on the old
source: secondary handle-release failure escaped before `cleanupFailure` was set,
replacing the primary error. A nested guard now retains both cleanup failures
while preserving the primary error. This double fault was reproduced at an API
boundary, not claimed as an observed native Node failure.

Three no-mock integrations cover the actual generated dashboard's Chromium,
SQLite, authentication, private card updates and draft-preserving logout/re-login;
adverse DevTools HTTP setup with natural subprocess exit; and Windows file-lock
retention. The browser test independently shuts down Chromium and confirms
temporary-directory removal. Native dashboard checks respect the starter's Node
requirements; the file-lock case is Windows-only. The new CI gate preserves its
coverage artifact on success or failure.

Windows / Node 22.21.0: 27 tests / 2 suites passed in 60.683 seconds. Direct
coverage is 101 statements, 14 branch outcomes, 14 functions and 82 lines, all
100%. Preserved map:
`coverage/dashboard-verifier-evidence/72e59434-6d51-491d-89f3-89534a184b09/coverage-final.json`,
SHA-256 `d486205c7c8549e2fe5487b29c4d8f4405ba074406a0da730d8401b06ab2eeb3`.
Verifier source SHA-256 (LF-normalized):
`007d5ca646f3eb182b75b1bc9c84db19f1977b0b70780b694aaaacad95eb6aed`.
This measures host-side authored code, including construction of browser strings,
not an execution coverage map for those strings. It does not replace the separate
frontend map, complete library regression, package or performance acceptance.

### Refresh history observation follow-up

The refresh verifier now persists the actual `bfcacheRestored` boolean separately
for plain and instrumented modes. Browser cache admission is not part of required
case parity: navigation and resumed polling remain mandatory. These observations
are recorded after successful mode completion, including cleanup and collection;
a failure earlier in the mode may leave its observation only in the console.
Two explicit report-boundary units retain asymmetric false/true outcomes and
reject a failed mode. A no-mock integration runs the canonical HTTP/Chromium
workload and reads the resulting report from disk.

Local verification: 3 tests / 2 suites passed in 37.541 seconds. Preserved report
`coverage/refresh-observation-evidence/d1704e74-90a0-48e3-aae6-f4bc73c6948c/report.json`
has SHA-256 `28a4edc0e32ddb0c10e7b4dc2b78c35a8ec313e0ca8a03ecdffea81c211072ab`.
Both modes actually observed cache restoration in Chrome 152.0.7977.64 on
Windows. The unchanged generated refresh source retains 82 statements,
44 branch outcomes, 12 functions and 71 lines at 100%; source SHA-256
`d8a14c1b44dab03f1fd6a62ef4b6721bb5e4baa9348b5f2e93a7fa2316bf8cd0`.
This does not establish complete direct coverage of the two private refresh
verification helpers, a fresh full regression, or performance acceptance.

### Previously established coverage

- Library: all 91 files in the configured root-entrypoint / `src/**/*.js` scope,
  5,449 statements, 4,046 branches, 978 functions and 4,468 lines, all 100%.
  Latest full local evidence: 1,486 tests/142 suites for the source set in `bf01c2a`,
  with two POSIX-only skips, including the
  benchmark, terminal-interruption, generator, memory, load and navigation corrections. Exact
  scoped/full-run results are below; the preceding runtime/resource/package checkpoint remains
  in `ADMISSION_TIMEOUT_VERIFICATION.md`.
  Exact current full-run and native linked-client evidence is in
  `FEEDBACK_COMMAND_VERIFICATION.md` and `BROWSER_OWNER_VERIFICATION.md`;
  this head's hosted checks remain separate.
  The preceding `377f029`, `1697f33` and `726b9a3` hosted checks passed. The preceding isolated package
  evidence is in `ACTION_INPUT_VERIFICATION.md`; its hosted checks and evidence follow-up passed.
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
| `browser-collector` | `lib/BrowserCoverage.js`, `lib/ApplicationCoverage.js`, `lib/assertCoverageFile.js` (current validation evidence in `COVERAGE_COUNTER_VALIDATION.md`) |
| `browser-commands` | `lib/browserCommands.js`, `lib/verify-action-feedback.js` (unit and actual Chromium/server cases; see `FEEDBACK_COMMAND_VERIFICATION.md`) |
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

The starter measurement/authored coordinators now retain available raw
reports before parsing or workspace cleanup. Their shared `reportCommand` helper
has a maintained 15-test scope at all-four 100% (16 statements, eight branches,
one function, 14 lines). See `STARTER_REPORT_RETENTION.md`.

Both coordinators and `lib/finishVerificationSummary.js` now also have a maintained
direct scope: 56 tests/three suites, 180 statements, 34 branches, 25 functions and
148 lines, all-four 100%. Actual copied applications reject source mutation after
passing tests; native filesystem failures and explicit unit faults verify terminal
report handling and retained cleanup evidence. These two coordinators are removed
from the remaining list below. See `STARTER_COORDINATOR_VERIFICATION.md` for exact
source/report identities and boundaries. The subsequent full regression includes
these cases and passes 1,388 tests/132 suites with the unchanged library scope.

The lifecycle coordinator now has a maintained direct scope: 26 tests/two suites,
42 statements, six branches, four functions and 39 lines, all-four 100%. A real
empty-map false-green was corrected; the source-free emitted-JavaScript gate now
requires a nonempty exact module and complete metrics. Only its temporary trailing
source-map comment changes, with original/measured bytes retained. The CLI passes
13 real tests and all-four 100% over 57 emitted statements/lines, 20 branches and
four functions. See `STARTER_LIFECYCLE_VERIFICATION.md`; these later tests are not
part of the preceding 1,388-test full inventory.

The packed-browser verifier and shared `BrowserPages` owner now have a maintained
exact scope: 42 tests/four suites, 131 statements, 26 branches, 20 functions and
103 lines, all-four 100%. Targeted browser-coordinator units and complete native
runtime/refresh gates also pass, but do not close that entire coordinator's direct
coverage gap. No frozen helper was changed. See `BROWSER_OWNER_VERIFICATION.md`
for unit/native boundaries, retained identities and isolated-package distinctions.

No direct coverage map was found for these remaining active verification/build files:

The client source coordinator is now measured separately by
`npm run verify:client:coordinator:coverage`: 35 explicit dependency-boundary
units plus three real preflight subprocess tests, covering 107 statements,
19 branches, 14 functions and 95 lines at 100%. Its CI job retains that map.
Two separate native Vitest fixtures reproduce worker-command/invalid-coverage
failures and verify raw files survive confirmed temporary-workspace cleanup.
They run in the full linked-client source command, not registry-only CI.
The recorder/configuration strings still require real execution; this map does
not claim coverage inside those generated programs or other browser drivers.
See `CLIENT_DEVELOPMENT.md` for the maintained commands and retention boundary.

Verification on Windows/Node 22.21.0: the 38-test coordinator/preflight command
passed in 4.006 seconds, map SHA-256
`ad6e0c653993e37a9ac06c793a3550b5e9ff5b1e93658f88ef896bbc6845c55f`.
The full source command also passed its 26 collector/preflight/report tests,
both native failure fixtures (4.487 seconds), and all 77 client tests in each
plain/instrumented mode plus actual HTTP/WebSocket/browser acceptance.
Run `cb17c8ec-6c2c-4948-9c32-771571d35a19` retains five raw worker files;
`coverage/client-source/<run-id>/summary.json` has SHA-256
`aa3d0b371ec6f6885f8b3fcce87973cb136f007e599aabb944a071d39088fba5`.
The authored-client scope remains 791 statements/521 branches/125 functions/659
lines at 100%, with source-built plain bundles matching the published 0.2.0
runtime identities. These results are not a new library regression/performance
measurement or publication approval. The original throughput failure remains open.

The runtime-frame and page-ownership helper scopes are now covered by
`npm run verify:browser:supplements`, which is part of the existing browser gate.
Four explicitly isolated boundary units reject failed browser calls/assertions
and missing sessions; one integration test invokes the unchanged canonical
plain/instrumented runtime cases with real Redweb HTTP/WebSockets and Chromium.
The two helper files are unchanged. Authored instrumentation measures all
90 statements, two branches, ten functions and 84 lines at 100%, including five
anonymous callbacks omitted by the initial native-converter function inventory.
The native report's five-function denominator is retained as diagnostic only;
it is not the acceptance map. Browser-expression strings are constructed here,
not internally instrumented by this Node report; actual browser execution and
the separate frontend map remain required.

On Windows/Node 22.21.0, the full browser coverage command passed 27 collector
tests, the five supplement tests (7.369 seconds), and the separate refresh gate.
Evidence is preserved under
`coverage/browser-supplements-evidence/3ff15611-18b6-44a9-af71-3de942420521/`,
including source identities and all three reports. Authored map SHA-256:
`cb9029313165322379f9a0eb3d4057e2fccff7a11cd9ff37889b5e7342da22b6`.
The canonical browser run `3ff15611-18b6-44a9-af71-3de942420521` passed seven
ownership and thirteen runtime assertions per mode, plus the existing feedback,
morph and native selection checks. Its separate frontend scope remains
426 statements/262 branches/64 functions/351 lines at 100%. The refresh run
`3b4be9fd-8406-4be6-81ca-742d89331341` retained all-four 100% and observed actual
back-forward-cache restoration. CI retains the
authored helper map with the existing browser evidence. Within that command,
this replaces the runtime invocation rather than adding a second one; the
full regression suite also discovers the new integration test. No new timing
claim or performance-policy change is introduced.

The development-refresh coordinator's earlier fifteen-unit partial measurement
is superseded only for its direct coverage claim by the complete authored map
above. Earlier failure records remain historical evidence.

```text
scripts/verify-live-html-browser.js
```

Frozen evaluation tooling also lacks a complete direct map in the reviewed set:

```text
scripts/evaluation/run-trial.js
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
