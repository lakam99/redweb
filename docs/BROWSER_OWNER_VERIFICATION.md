# Browser verification ownership and failure handling

Browser verification must fail honestly without skipping cleanup. Explicit fault
tests found that an exception from a debugging socket's `terminate()` could skip
browser and server shutdown. Exceptions from fallback `stderr.destroy()` or
`unref()` could do the same. A late tab's release error was not accounted for.
Five packed-verifier regressions failed before the correction. Separately, the
browser coverage coordinator used a raw, truthiness-based failure accumulator,
which could lose a falsy rejection.

These are demonstrated unit fault/control-flow defects, not evidence that a
native Chrome process leaked during a successful historical run.

## Shared ownership, unchanged browser protocol

`BrowserPages` is a small shared owner used by the packed-browser verifier and
browser-coverage coordinator. It observes original page-opening promises before
the caller's timeout race, records returned tabs, closes tabs arriving during
cleanup, and boundedly accounts for outstanding openings. A still-unsettled
opening marks cleanup uncertain and retains the workspace, even if later browser
shutdown succeeds. Late release failures remain recorded on that owner. Closing
is idempotent; a closing owner refuses new pages.

Each tab release and subsequent browser/fallback/server/peer cleanup is attempted
independently. Errors use the existing `verificationError` normalizer, preserving
primary failures and secondary cleanup failures. No new browser protocol client,
runtime dependency or generic process manager was introduced. The frozen browser
and network helpers remain unchanged. Terminating a debugging socket is a release
request, not independent proof of every browser descendant's termination; the
existing browser exit checks and conservative workspace retention remain in force.

The isolated package harness copies the same owner alongside its other unchanged
verification inputs (24 files rather than 23). It still verifies copied bytes,
package immutability and isolated runtime dependency resolution.

## Maintained tests and exact scope

`npm run verify:package:browser:coverage` passes 42 tests across four suites in
6.063 seconds on Windows / Node 22.21.0 / Chrome 152.0.7977.64:

- 24 explicit packed-verifier boundary units cover success, acquisition,
  assertions, late tabs, cleanup and fallback failures.
- Six explicit page-owner units cover idempotence, rejected/late/unsettled
  openings, promise ownership and multiple release failures.
- Eleven targeted browser-coordinator units cover falsy failures and independent
  tab/peer/browser/fallback cleanup. They do not claim whole-coordinator coverage.
- One native integration test runs the existing counter, chat delivery/escaping,
  draft preservation, reconnect and disconnect checks through actual Chromium,
  HTTP and WebSockets, with no API replacements.

That native test uses the checkout. It does not alone certify an independently
installed archive; the existing isolated-package gate supplies that separate
evidence. Eleven package-harness compatibility tests also pass. The native test's
ten-minute outer allowance covers the unchanged sequential 12-second operations,
bounded launch attempts and cleanup. CI allows 15 minutes for the scoped command
and retains its report for 30 days. These are failure supervision budgets, not
increased runtime or inner operation limits.

All-four 100% covers exactly two private files: 131 statements, 26 branches,
20 functions and 103 lines. The VM maps are explicitly opt-in and do not enlarge
the normal library scope.

| Source | SHA-256 |
| --- | --- |
| `scripts/lib/BrowserPages.js` | `34a11cd3bebe213a082b2bb3d250f5f6e66b62533750c008e086a11d132b6c7c` |
| `scripts/lib/verify-packed-browser.js` | `6fb59772d165d32d08ab8670f3e4724f9ae8f02be9bda241f855e10dc03f8b93` |
| `scripts/verify-browser-coverage.js` (targeted units and native behavior, not full direct coverage) | `43a37063d17eb4f1f5211cd3c32456a269eb7560a929c5301ce1b81de70bba1a` |
| `scripts/lib/PackedBrowserHarness.js` | `e6ce226fafbb96bb1dcd16979008563f13872f7ca606dea73b73b3dddf867d80` |

`coverage/packed-browser-verifier/coverage-final.json` SHA-256:
`1d64027c49374a353a49f56272c39c6efda656979f075c2be1f81aac14d9a29b`.

## Actual emitted-browser gates

The complete native runtime and development-refresh gates pass in ordinary and
instrumented modes with matched case inventories. Runtime remains all-four 100%
over 426 statements, 262 branches, 64 functions and 351 lines. Refresh remains
all-four 100% over 82 statements, 44 branches, 12 functions and 71 lines. Actual
history restoration, draft guards, malformed responses, outage/recovery, server
selection updates and feedback/morph/ownership cases are preserved.

| Report | Run | SHA-256 |
| --- | --- | --- |
| `coverage/browser-runtime/report.json` | `857b6627-5cc6-45ce-ae86-c7744089ec41` | `ca76701673c19cc4594f54ce98888847eca54337d46cc51bc9fcefe2abed061f` |
| `coverage/browser-refresh/report.json` | `fac8557c-a2b5-4d84-924a-3e9c69d1a208` | `efd8e608dc2fd9a188ee87f856337675e03860c38a531a75d5ffde659ea7af0d` |

## Isolated package and regression boundary

The complete isolated-package gate passed with published `redweb-client@0.2.0`,
matching its committed registry identity and all four tested runtime bundle hashes.
It passed installed counter/chat/draft/reconnect/disconnect acceptance, all source-free
starters and executable documentation, compiled action/room consumers, static export,
and the copied acceptance/runtime/refresh harness. No runtime modules were replaced.

Tested Redweb archive SHA-256:
`0fb329edbf09e74a47a1ff8da565a3e155bc118bed5826b09560fd227f1097d8`.
That archive was packed before subsequent evidence-only README/documentation edits.
The retained browser phase report is
`coverage/packed-browser/45f01d8a-e1b5-42a5-a8b3-1521b195c775/report.json`, SHA-256:
`2ee3802bbb556a2811630c859b07e112a017ac294dc6a82570a4b38f9579878e`.
It records all three phases passing, 207 package files and 24 harness files, with
harness SHA-256 `f7066e63ead88c38d34d773df6e86114b223bec3ad9db39f3b02c9e0f0e54818`.

The senior critic approved the ownership/aggregation design, shared use, budgets,
documentation and exact source/report identities. Pretest/generated/type checks
and four documentation units pass. The completed root regression for `f96ba79`
passes 1,456 tests across 138 suites in 754.054 seconds, with two POSIX-only skips.
It includes the 42 browser-owner and 26 lifecycle cases absent from the preceding
1,388-test inventory. Exactly 91 library files remain all-four 100%: 5,449
statements, 4,046 branches, 978 functions and 4,468 lines.

| Full regression evidence | SHA-256 |
| --- | --- |
| `coverage/browser-owner-full-results.json` | `6b446101550f58a23eef75af9cea6b8df2318c9812eba1e4f7595906a51d941b` |
| `coverage/coverage-final.json` | `b7ddd801caa759a33ebe5a5fb7a5175792eb97defb7c65ff33b6184b6425e6cd` |

The linked-client authored-source gate also passes: 77 tests in each ordinary and
instrumented mode, five worker reports, and matching native Chromium inventories
including 58 protocol and 43 client-network assertions per mode. Its exact scope
remains 791 statements, 521 branches, 125 functions and 659 lines, all 100%.
The source-built ordinary bundles match the linked production build. The separate
26-test collector/preflight/report suite passes at its two-file 100% scope.

Run `efd9784b-b6d9-4f9e-affe-18080e6cb2cf` under `coverage/client-source/` retains:

| Client evidence | SHA-256 |
| --- | --- |
| `summary.json` | `b59f08ab081699532d5d17e2643113c2ebe9122167028d4d52bdbacc9eddbaa4` |
| `coverage.json` | `8673e236f675d741cb0f55d4f4bf630f2e2a50c2f2f76f856622558491ac8009` |

These runs use Windows / Node 22.21.0 / Chrome 152.0.7977.64. They do not relabel
the separate Node-only V8 diagnostic as passing. The existing npm links and the
user's client version edit are unchanged. Both hosted workflows for preceding
`377f029`, `1697f33` and `726b9a3` passed; `f96ba79` hosted results were still
running when this evidence was recorded and are not presumed passed.

No npm publication, deployment, benchmark waiver, new long soak or whole-repository
100% claim is made. Remaining direct coordinator/browser-helper coverage and the
separate performance acceptance remain open.

## Development-refresh launch cleanup follow-up

Independent audit found that the generated-app refresh coordinator acquired
Chromium before entering its cleanup block. If acquisition rejected, it did not
mark cleanup uncertain, so the workspace owner could remove the browser profile
without independently verified process termination. Its fallback pipe/reference
releases could also replace the original error or skip the next release.

Seven of thirteen initial explicit boundary units failed before correction.
These were injected launch/process/filesystem faults, not a claim that a native
Chromium leak or falsy shutdown rejection had been observed in a normal run.

The coordinator now acquires inside its existing guarded lifecycle. A launch
without a returned browser marks the workspace for retention; confirmed ordinary
or signal exit remains clean. Shutdown has a 15-second deadline. The existing
coercion-free error normalizer preserves falsy failures, and pipe/reference
releases are attempted independently while retaining every error. No new owner
class or public API was added; frozen helpers remain unchanged.

The expanded unit suite has 15 cases, including a pending shutdown using the real
15-second deadline, an absent stderr pipe, both fallback failures, signal exit,
pre-acquisition failures and falsy errors. It passes in 15.828 seconds. Its
45-second per-case allowance includes the shutdown deadline. The critic approved
the scope, ownership and test boundaries. These units do not establish complete
direct coverage of the coordinator; that file remains in the coverage audit.

The actual `npm run verify:development:browser` workflow separately exercises
generated realtime/site applications, real watchers and Chromium: TSX/CSS rebuilds,
failed-build recovery, draft/focus retention, explicit discard, state reset,
outage/reconnect, malformed/redirect/partial responses and delayed-script draft
guards under self-only CSP. The final-source run passed all of these checks on
Windows / Node 22.21.0 / Chrome 152.0.7977.64, including observed actual
back-forward-cache restoration. Pretest, generated docs, three type configurations
and four documentation units pass. It already runs in CI with a ten-minute outer limit.
The existing raw page/command acquisition and inner template/helper cleanup paths
remain a separate audit boundary; this correction does not claim they are all
bounded. Pipe/reference release is not proof of process termination.

Corrected coordinator SHA-256:
`7309fde16234bcdea8ae3cbe2870d181b1e5ad7a359f5c37dc0818b9c7cf5402`.
The complete regression at `bf01c2a` passed 1,486 tests/142 suites in 773.401
seconds, with two POSIX-only skips and all-four 100% of the 91-file library scope
(5,449 statements, 4,046 branches, 978 functions, 4,468 lines). This includes
the two native feedback-driver cases and all fifteen development-cleanup units.
Full result `coverage/development-refresh-full-results.json` SHA-256:
`f0a52e663b7f54d72a06e51890421b85e1fa89f8d5c7e0d587bf2452b3aff8a4`.
Corresponding `coverage/coverage-final.json` SHA-256:
`d9669b60e15270da98bce1a04f9e515fbe93fe9cbefa278326ef525af32c403a`.
Both `69dcbf8` and `9897924` hosted workflows passed completely; latest hosted
results remain separate. The critic approved all seven actual remote `bf01c2a`
blobs and their source/documentation identities.
