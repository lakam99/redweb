# Client lifecycle and installed-pair verification

This release-polish increment fixes a demonstrated lifecycle bug and closes the
remaining combined original-client-source branch gap. It does not resume the
[deferred runtime investigation](RECOVERY_FOLLOWUP_SPIKE.md) or waive any release gate.

## Published client integration: current checkpoint

The maintainer published `redweb-client@0.2.0`. Its actual registry archive now
contains both root and `./live-html` exports with ESM, CommonJS and declarations.
Redweb commit `f3c91e9` selects `^0.2.0` and locks the published archive. This
supersedes the historical client-publication blockers recorded below; Redweb's
new implementation itself is still unreleased.

- Registry archive: `https://registry.npmjs.org/redweb-client/-/redweb-client-0.2.0.tgz`.
- Archive SHA-256: `89cc32946cb787aa921b5f383c91201890208d9099da741f0d2571b927b9fa95`.
- Integrity: `sha512-0bC8j/wJ2WXGuYom5ewijM+sgzRdD5bccnQaQVWqNQBWOkeHH4oXBQTW+3YY2LpnBPT0Hlcxj/OHLCXzD/cZ9Q==`.
- All four published runtime bundles exactly match the locally tested client build.

The complete default package gate passed without a client override or local link
in its isolated consumer. Registry and candidate modes now share installed-client
containment/export/hash verification and the full existing browser harness. The
registry mode additionally checks the version, URL and integrity against Redweb's
lockfile. Developer links and the client's user-edited version manifest were preserved.

- Packed Redweb SHA-256: `e773a5270bf66719cb0c83f499301d5a6a19fda2b9a8e24b673519dc7ac8af8a`.
- Report: `coverage/packed-browser/3b890ae9-2b40-4bfd-8df1-f58c0fb9eb65/report.json`,
  SHA-256 `cb8055893ed906b4d6739a54913bc25e45063040924d5136099c2265eba4ff19`.
- `candidateOnly` is false; 190 original package files, 23 harness files and four
  explicitly external development tools passed identity checks.
- Actual counter/chat, reconnect/disconnect, full browser acceptance, all six
  starters, executable recipes and source-free consumer execution passed.
- Runtime run `46c7aa29-bd08-4aac-aee1-13e1acc01843`: all-four 100% over
  426 statements, 262 branches, 64 functions and 351 lines.
- Refresh run `6a1a3e5c-707f-428e-a454-f4fd15141cd9`: all-four 100% over
  82 statements, 44 branches, 12 functions and 71 lines, including real bfcache restoration.
- Eleven filesystem unit tests cover both client verification helpers at all-four
  100%; `coverage/registry-client-helper/coverage-final.json` SHA-256
  `c40ccac1581f7fef467b9b0af6ae9792743baccc243505b4abc9a3be510ce363`.

After that archive was verified, the unreleased quickstart was simplified to
install the matching Redweb tarball and obtain its published client automatically.
The printed commands passed a separate clean-install integration test, with no
client checkout, override or symlink. The optional contributor workflow also passed
actual isolated `npm ci`, build and `npm link`, preserving developer inputs. Both
generated realtime applications passed their 14 HTTP/WebSocket/process tests;
the two workflow tests passed in 47.631 seconds. The interactive development
watcher is intentionally covered by its separate lifecycle gate, not these tests.
Four documentation unit tests passed with all-four 100% coverage of
`Documentation.js`; report `coverage/registry-setup-docs/coverage-final.json`
SHA-256 `6172507dae191592c5b9002f0d69848150e3be6317ad2a9d3d8b98a57c884345`.
Generation freshness and all three TypeScript configurations passed. These later
quickstart/prose changes are not claimed to be inside the earlier full-gate archive.

The final scoped package-tool regression passed 76 tests in nine suites (201.158
seconds), with all-four 100% coverage across its nine helpers, including the new
shared installed-client verifier. Report: `coverage/package-tools/coverage-final.json`,
SHA-256 `6dd5988e3f00ada240a7ba590c41dfa2159845e198ec00f043616688650cab5f`.
The senior critic approved the implementation and evidence after stale coverage
and blanket mock-free claims were corrected. Integration remains mock-free;
the dashboard cleanup fault injection is explicitly identified as a unit test.

The environment remains Windows, Node 22.21.0 and Chromium 152.0.7977.64.
Latest-head CI, website alignment, Redweb publication and the bounded Ubuntu
recovery decision remain open. No failed recovery threshold was waived.

## Runtime change

A disposed `RedwebClient` with outbound queue capacity previously accepted new
`sendRaw`, `send` and `request` work, despite never being able to connect again.
Unit and real-WebSocket regression tests failed before the fix. One guard in the
shared transmit path now rejects all three paths, including cleanup of a rejected
request's pending state. The tests pass after the fix.

The private outbound queue is dense and synchronously length-checked before
`shift()`. Removing an impossible undefined-entry branch simplifies that invariant;
it does not alter supported transport behavior. Real-network tests verify queued
FIFO delivery, aborted requests being removed before connection, and no replay
of sent messages after reconnect. No browser or transport API is replaced in
these integration tests.

The senior critic approved the implementation and regression coverage after an
unobserved pending-request rejection in a test's failure path was corrected.
Client implementation commit: `859487b` on `codex/client-lifecycle`.

## Combined original-source verification

Build and type checks pass. All 77 client tests in five files pass in both plain
and instrumented execution. Sixteen collector/reporting unit and real-process
tests pass with all-four 100% coverage over the two collection helpers.

The combined gate instruments the same original client TS/JS maps across Node
and native Chromium. It covers 791/791 statements, 521/521 branches, 125/125
functions and 659/659 lines. No threshold, source exclusion or coverage-ignore
directive was added. Static export linkage and erased declarations remain
structurally verified outside executable coverage, as before.

Browser tests run plain and instrumented feedback/runtime/ownership/morph cases
(18/13/7/46 assertions), plus client protocol/network cases (58/43 assertions).
Actual Redweb HTTP/WebSocket actions and native keyboard/pointer selection pass.
Both plain built bundles match the linked production build; input hashes are
checked before and after execution.

- Environment: Windows, Node 22.21.0, Chromium 152.0.7977.64, TypeScript 5.9.3,
  Istanbul instrumenter 6.0.2, esbuild 0.28.2.
- Final run: `cc9aead6-cfbb-44af-aba6-94124ab03419`,
  `2026-08-30T22:24:53.089Z`–`2026-08-30T22:25:05.008Z`.
- Summary: `coverage/client-source/cc9aead6-cfbb-44af-aba6-94124ab03419/summary.json`,
  SHA-256 `395eb78997106e81d5d1370b0d977add9ae0f23c3ff687d07998df93f9db94c8`.
- Coverage: same directory's `coverage.json`,
  SHA-256 `8673e236f675d741cb0f55d4f4bf630f2e2a50c2f2f76f856622558491ac8009`.

This is tracked original-source coverage, not exhaustive optional-chain or
compiler-generated V8 branch coverage. At the start of this increment, the client's
`npm run check` failed because it used only the Node-only V8 command, which does
not exercise browser modules. That underlying command is now `npm run test:v8` with
unchanged thresholds and an unresolved result; the comprehensive command update
below does not reclassify the earlier failure as a pass.

## Matching installed artifacts

The full candidate package verifier exited normally with a passed result. It
installed the fixed client tarball alongside the Redweb tarball in a temporary
consumer, without changing the developer link or repository lockfiles. It passed
counter/chat rendering, reconnect and disconnect presence, the unchanged full
browser acceptance, rendering/refresh coverage, all six starters, executable
documentation and source-free production execution, additions and consumer checks.

- Redweb at `3b247bc` before these evidence-prose updates: archive SHA-256
  `6dfc9984245567248adbf8e1538f55d3725039cd3a0a6df6bf93726d5e589965`.
- Fixed client archive: `coverage/client-polish-20260830T2225/redweb-client-0.1.0.tgz`,
  SHA-256 `464e70bcb326c8d108d81d13d979e00700ae1ad093d2825fc35acf2e6e661875`.
- Packed browser evidence: `coverage/packed-browser/64d840c3-fd42-41ad-8e38-87b4e4bb7d19/report.json`,
  SHA-256 `4384b90fc7d8a509e33db3ce2694f7c1f3b53b3ed662b7c97761d2a765b4de64`.
- All 189 original package files and 23 copied harness files passed identity/ownership
  checks. The four external development tools remain explicitly disclosed.
- Packed runtime run `b73299ce-521b-4a46-baa7-9da0ea6d87f3` and refresh run
  `28d1d1ff-942e-4929-a92e-546a9f6c8d35` passed all-four 100% coverage for their
  respective scopes. Runtime measured 426 statements, 262 branches, 64 functions
  and 351 lines; refresh measured 82/44/12/71 respectively, including observed
  back-forward-cache restoration.

The source, linked build and installed candidate agree on the Live HTML bundle
SHA-256 `26cae5402947d27d405cecaf2cafc0638cb0030663a7068bb487d99106aa64f5`.
The critic independently checked source reports, installed browser evidence and
all four bundle hashes. Production dependency audit reported zero vulnerabilities
using the system trust store without disabling certificate verification.

This is a local candidate pair, not the published registry pair. The local client
still identifies itself as 0.1.0 while that published version lacks the new export;
it needs an appropriate version and publication before Redweb's saved dependency
can select it. No npm publication, deployment, merge, CI/recovery-policy change or
claim that remaining release requirements are complete is made here.

## Full Redweb regression

With the fixed client linked, 853 tests in 82 suites passed in 424.323 seconds,
with a normal exit and all pretest/generated-documentation/type checks. The owned
HTTP/WebSocket shutdown cases passed; their historical timeout remains unexplained.
Instrumented-library coverage is 100% over 5,445 statements, 4,044 branches,
978 functions and 4,464 lines. No runtime or test inputs changed during this run.

Report: `coverage/client-polish-full-suite.json`; SHA-256
`bb3c58eadef1aece8c7e761713e6e3da44ad536981e181b4c1d9ddc04d70b004`.

## Canonical client check

Client `ee74017` and Redweb `45a34d5` make `npm run check` use the complete
original-source Node/browser gate rather than only running Node tests over browser
code. At that increment, the separate `npm test` V8 command and thresholds remained
unchanged; the later default-command increment below names it `npm run test:v8`.
Its failure is still recorded, not presented as fixed.

Before building, `check:link` compares the expected client's canonical path with
the package installed into Redweb. It resolves the package/junction independently
of `dist`, allowing an unbuilt linked checkout to pass preflight. Full verification
still requires normal built-export resolution to match that checkout. Missing or
wrong linkage fails without fallback. `test:source` rechecks the expected path and
delegates directly to the existing runner; no browser harness is duplicated.

Twenty-one focused unit and actual-process tests pass, including a linked fixture
whose normal export cannot yet resolve but whose preflight succeeds without
building or creating reports. The two collector/reporting helpers remain all-four
100% covered. The critic approved after catching and correcting that first-build
problem. Native `npm run check` then passed build/types, all 77 client tests in
both modes, native Chromium checks and the same 791/521/125/659 covered counters.

- Final canonical-check source run: `6ae0027f-b078-43ee-8069-be386a984007`,
  `2026-08-30T22:42:44.784Z`–`2026-08-30T22:42:56.970Z`.
- Summary: `coverage/client-source/6ae0027f-b078-43ee-8069-be386a984007/summary.json`,
  SHA-256 `694dadb8082a1430b08c4829e4560d3dc131d324d58bc41ddd9c6ceae27bd4df`.
- Coverage JSON SHA-256 remains
  `8673e236f675d741cb0f55d4f4bf630f2e2a50c2f2f76f856622558491ac8009`.
- Helper coverage: `coverage/client-check-preflight/coverage-final.json`,
  SHA-256 `7305ad80c8bb09e5dc1d6715889fcfb6fca2836620329da9bf75854bb056b4a2`.

The earlier full regression and packed archives precede these command/preflight
and README changes; their production source and all four client bundles remain
unchanged. These later changes are verified by the focused real-process checks
and the actual canonical command, not claimed as another full package run.

After the final evidence update, generated-documentation and all type/pretest
checks passed, along with 25 focused documentation/preflight/report tests and two
real generator/release-immutability cases. The critic independently rechecked the
final source report hashes and unchanged client bundles. Both development links
and dependency lockfiles remain unchanged.

## Default test command

The client now delegates `npm test` to that same complete `npm run check` path.
The original `vitest run --coverage` command is preserved as `npm run test:v8`;
its thresholds and known Node-only missing-browser failure are unchanged. This
chooses the documented combined original-source denominator for the default
command; it does not retroactively fix the V8 diagnostic. No runtime, tests or
coverage instrumentation changed. The client README now reflects the current
77-test inventory and passing original-source metrics instead of stale failures.

Actual `npm test` passed linkage preflight, build, types, 77 tests in each mode,
native Chromium acceptance and all 791/521/125/659 authored counters. The run
completed normally at `2026-08-30T22:56:53.072Z`, on Windows/Node 22.21.0 and
Chrome 152.0.7977.64. Evidence:

- `coverage/client-source/a7c2bcd8-bc07-4496-b8a1-571e40d68288/summary.json`,
  SHA-256 `f5770e60d8c011da0874ba2094dbe07904a3f6fdaed7a772f6dbd053b60f3e8b`.
- Coverage JSON SHA-256 remains
  `8673e236f675d741cb0f55d4f4bf630f2e2a50c2f2f76f856622558491ac8009`.

The senior critic approved the nonrecursive delegation and explicit denominator
boundary. Final README wording was corrected after this run; production source,
test/configuration inputs and built bundles did not change. Matching registry
publication, latest-head CI and remaining release gates are still outstanding.

The subsequent full linked Redweb regression passed 858 tests across 83 suites
in 421.094 seconds, with all 5,445 statements, 4,044 branches, 978 functions and
4,464 library lines covered. No runtime/test inputs changed during that run.
Report: `coverage/polish-final-core-suite.json`, SHA-256
`73e41db9f26285b13aa293e168be8b8a012d0824403d31b750ae8020772721aa`.
The README and guide's stale current coverage/command claims were corrected
afterward; the type/generated-documentation preflight was rerun for that prose
increment. Production dependency audit reported zero vulnerabilities with system
certificate trust enabled, without disabling TLS verification.

## Current package and performance checkpoint

Redweb `28f9c62` and client `a8b6a9f` passed the complete isolated candidate
package gate on Windows/Node 22.21.0/Chrome 152.0.7977.64. This includes the
server-driven counter, two-user chat, disconnect/reconnect presence, dashboard,
full browser acceptance, runtime/refresh coverage, generated applications,
executable documentation and source-free consumers. The process exited normally
and completed owned-workspace cleanup. Nothing was published or deployed.

- Redweb archive SHA-256:
  `f2a8649dfcf83f6fba6351a4bfdf39bb50d85ffde59e09d2b2e62c9b4fd10511`.
- Client archive: `coverage/client-default-20260830-2259/redweb-client-0.1.0.tgz`,
  SHA-256 `86ad220edad8a00010659c1c89028de937ea84dfe35b13ac747cac39bf10a440`.
- Packed browser report:
  `coverage/packed-browser/9caf08f4-7cc6-4d7b-9ca5-e15b4a229edc/report.json`,
  SHA-256 `9de780f16203fcde0d1cb3f22fab540978a0a7af64cf6a6b383bc18c842e0857`.
  It verifies 190 original package files, 23 unchanged harness files and four
  explicit external development tools. All four client bundles match the built
  source-verification inputs. Runtime and refresh coverage each remain all-four
  100%; the refresh check observed actual back/forward-cache restoration.

After the package process terminated, the following gates ran sequentially with
their default workloads and limits, without diagnostic or coverage overrides.
Every command exited successfully on its first run in this checkpoint:

| Gate | Observed result |
| --- | --- |
| `verify:load` | 32 clients, 3,200 messages, 5,789 messages/second, 6.97 ms p99; slow consumer contained |
| `verify:memory` | 500 connections, three trials; 1,880.704 bytes/connection incremental metadata against 2,048 maximum |
| `verify:live-html:load` | 200 expired renders, 110 live clients; 8,052,960-byte heap delta |
| `verify:jsx:performance` | 10,000 component rows in 49.7 ms; 1.3 MiB retained |

These are bounded Windows checkpoint results, not a recovery, extended-soak,
cross-runtime or registry-release certificate. The existing Ubuntu/Node 22.23.2
recovery failure remains unresolved, and the predeclared comparison has not run.
The local Docker Linux engine is unavailable and WSL lists no Ubuntu environment;
no alternative platform was substituted. Publication of a newly versioned client,
Redweb dependency/lockfile integration, final-head CI, website alignment and the
explicit recovery decision remain open. This evidence-only section was added
after packing and does not claim its own text was in the tested archive.
