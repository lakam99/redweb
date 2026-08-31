# Exact coverage-counter validation

Independent review found that the browser collector checked source maps but not
the associated execution counters. A local reproduction supplied the unchanged
maps with every counter set to `0.5`: the old collector accepted the payload and
reported all-four 100%. Two regression tests failed before the correction.
This demonstrates a report-validation defect, not a runtime defect or evidence
that any saved native-browser report was corrupt.

## One shared validator

`assertCoverageFile` extracts the existing authored-coverage rules into a small,
pure private helper. Both `ApplicationCoverage` and `BrowserCoverage` now require
the exact file path, source maps, counter keys and branch arity, with nonnegative
safe-integer counts. Validation precedes merging; a malformed later application
module cannot partially commit an earlier valid module. The helper imports only
Node's assertion module, not TypeScript or browser/runtime dependencies.

The isolated browser harness copies this helper unchanged, increasing its input
inventory from 24 to 25 files. Existing generator/addition/example verification
fingerprints include the extracted dependency. No application/runtime API,
workload threshold, frozen helper or evaluation file changed.

## Maintained checks

The collector portion of `npm run verify:browser:coverage` passes 27 tests across
three suites in 4.370 seconds. Exactly three private files are all-four 100%:
70 statements, 10 branches, 10 functions and 68 lines. Cases include explicit
malformed-report units, real VM executions of instrumented JavaScript/TypeScript,
multi-module no-partial-merge checks, package-harness compatibility, real child
process reports, and a Windows exclusive-file-lock cleanup failure. They do not
replace native browser acceptance.

Five tiny preload-test commands now have explicit five-second limits instead of
inheriting 120 seconds each. The test's outer limit is 45 seconds to accommodate
the commands and managed cleanup. CI allows ten minutes for the expanded combined
collector/browser command (formerly five), with unchanged native operation limits,
and retains collector/runtime/refresh reports for 30 days on success or failure.
This is test supervision, not a relaxed product performance limit.

| Exact source | SHA-256 |
| --- | --- |
| `scripts/lib/assertCoverageFile.js` | `a3af85e92bfc3f6f83ea18301db1e31dab75f930b3c9045ff7a2dbc50f65b5ba` |
| `scripts/lib/ApplicationCoverage.js` | `cf83c4c35baefa74ba431e5b0198ebfeba78f19f49c5eeac746205d6b2b12ae5` |
| `scripts/lib/BrowserCoverage.js` | `73afb4961fbda1ac0f077dddef197b6d36d386304299d69f115ce61d131f6aa2` |
| `scripts/lib/PackedBrowserHarness.js` | `0eb57075c391dbd32fd931c6647cdc1dbeb014cfbaf6df0afe631c7b790b24ce` |

`coverage/browser-collector/coverage-final.json` SHA-256:
`49f1230bf03006d0e8e49083e46ac33ca126a43a76b407717e6f1f1aa32d7132`.

## Native acceptance and limits

The complete ordinary/instrumented runtime and refresh browser gates pass with
matching case inventories. Runtime remains all-four 100% over 426 statements,
262 branches, 64 functions and 351 lines; refresh remains all-four 100% over
82 statements, 44 branches, 12 functions and 71 lines. Real HTTP/WebSocket
actions, selection updates, history restoration, outage/recovery and draft guards
remain covered. Environment: Windows, Node 22.21.0, Chrome 152.0.7977.64.

| Native report | Run | SHA-256 |
| --- | --- | --- |
| `coverage/browser-runtime/report.json` | `01b23ee2-aeda-4594-a5a0-3e11f1005c97` | `2b20f3e87cb5c22f870d90a53879611247ff37582558a22cf7f55ca253d42b39` |
| `coverage/browser-refresh/report.json` | `d8f370d3-cf33-4b1a-b99d-3c45d3b8dae7` | `fdabcbf7de78568582f3bb2afd61aa8d443d8b4b05caaf8c71f43b527b4ce90f` |

The linked-client gate also passes 77 tests per mode, five worker reports and
native browser acceptance with 791 statements, 521 branches, 125 functions and
659 lines all 100%. Run `09c44903-39bb-4741-8e24-60b511dc7245` is retained under
`coverage/client-source/`. Its ordinary source-built bundles equal the linked
production build. This does not relabel the Node-only V8 diagnostic as passing.

The client `summary.json` SHA-256 is
`302c162b655540152c5a1d4c5c562f768065c40431bf87852d5ba439d35b2348`;
`coverage.json` SHA-256 is
`8673e236f675d741cb0f55d4f4bf630f2e2a50c2f2f76f856622558491ac8009`.

The complete isolated-package gate then exited successfully. It verified registry
`redweb-client@0.2.0` and all four matching bundle identities, installed counter/chat,
dependency isolation, generated additions, authenticated dashboard, browser runtime
and refresh, all source-free starters, executable docs, compiled actions/rooms and
static export. No runtime modules were replaced; TLS verification remained enabled.

Tested Redweb archive SHA-256:
`d66bf453c60bec4bef6a0ea728637131bd014fc8e4e57d6bcc02bafd680c1cf0`.
This archive predates subsequent evidence-only README/documentation edits.
The retained report is
`coverage/packed-browser/d6c4db4d-fc0b-415c-b989-2241255e5e88/report.json`, SHA-256
`465bdf7c5f6f63dd34ba603bb408b18bf63e3c2ffbb7c39a5379deb04546e0d4`.
It records the three browser phases passing, 208 package files and 25 unchanged
harness inputs, with harness SHA-256
`1a999d87da59cd90e4bbea37e1324c3ab1e7b94fc1932d945c2878ff127651c7`.

The senior critic approved all 17 actual remote blobs at `659f638`, including the
shared validator, test supervision, attribution wording and evidence identities.
Pretest/generated/type checks and four documentation units pass.

The full regression for `9c29a6e` then passed 1,459 tests/138 suites in 770.875
seconds, with two POSIX-only skips. It includes the three new validator cases.
The unchanged 91-file library scope remains all-four 100%: 5,449 statements,
4,046 branches, 978 functions and 4,468 lines.

| Full regression evidence | SHA-256 |
| --- | --- |
| `coverage/counter-validation-full-results.json` | `0ae3268e1b911fbfe4b766210172a404fbd77e146d7f0ab435ce6e8ce9b807a8` |
| `coverage/coverage-final.json` | `e3eff8cc021eb82fd323867a079c983c72abb5fe07f83255b302850684dda29e` |

Both preceding `f96ba79` and `367e104` hosted workflows passed completely.
Hosted checks for this validator increment remain separate, not presumed passed.
No npm publication, deployment, benchmark waiver, new long soak or whole-repository
100% claim is made.
