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
and four documentation units pass. The complete root regression is still running
at this implementation checkpoint; its outcome is not presumed.
The previous 1,388-test inventory does not include these 42 cases or the 26 later
lifecycle cases. Both hosted workflows for the preceding `377f029` and `1697f33`
checkpoints passed; that does not establish a hosted result for this new increment.

No npm publication, deployment, benchmark waiver, new long soak or whole-repository
100% claim is made. Remaining direct coordinator/browser-helper coverage and the
separate performance acceptance remain open.
