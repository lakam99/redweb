# Client lifecycle and installed-pair verification

This release-polish increment fixes a demonstrated lifecycle bug and closes the
remaining combined original-client-source branch gap. It does not resume the
[deferred runtime investigation](RECOVERY_FOLLOWUP_SPIKE.md) or waive any release gate.

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
compiler-generated V8 branch coverage. The separate standalone client `npm run
check` currently fails its Node-only V8 coverage thresholds because browser
modules are not exercised there. Its README now states that limitation accurately;
the failure is not reclassified as a pass by this combined report.

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
