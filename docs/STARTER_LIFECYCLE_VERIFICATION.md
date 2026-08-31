# Lifecycle coverage must measure actual code

The lifecycle gate previously trusted c8's exit code. A real command with all four
100% thresholds and an empty source match exits successfully with `{}` coverage:
c8 compares a nonnumeric empty-map percentage against the thresholds.

The current generated lifecycle application exposed a concrete false-green too:
all 13 source-free tests passed, c8 exited zero, but its report was empty. The
generated JavaScript has an external map pointing to TypeScript removed by the
deployment check. The converter cannot read that original source; c8 catches the
conversion error and omits the module. This is a verification defect, not a
demonstrated runtime lifecycle failure. The failed evidence remains under
`coverage/starter-lifecycle/abb4623b-ed07-47cd-8f02-8a463bd7b788/`.

## Correction and scope

`verify-starter-lifecycle.js` now requires exactly the expected deployed
`dist/run-app.js` module, nonempty statement/branch/function/line inventories and
100% in each metric. Empty, wrong-module, extra-module and incomplete maps fail.
The existing source-free application checks run first, unchanged.

This gate deliberately measures emitted JavaScript, not authored TypeScript.
Inside its disposable application only, it removes the asserted trailing
`sourceMappingURL` comment. Every preceding executable byte remains unchanged;
the original JavaScript, original map and measured JavaScript are retained.
The measured file must remain byte-identical after testing. Merely moving the map
was tested and was insufficient: the converter also follows the unchanged comment
and fails when the map is missing. That failed attempt remains under
`coverage/starter-lifecycle/15a3915d-8803-46b2-8714-ec07bde0782a/`.

Each run retains raw JSON and successful test output in a unique directory before
temporary cleanup. It reuses the shared report/workspace owners; no new process
manager was added. Success output follows confirmed cleanup. Invalid reports or
recording/cleanup failures remain failures. The separate original-TypeScript
starter gate is unchanged and is not replaced by this emitted-code measurement.

## Verification

On Windows / Node 22.21.0, `npm run verify:starters:lifecycle:coverage` passes
26 tests across two suites in 16.827 seconds. Twenty-four explicitly labelled
unit faults cover orchestration, malformed/empty/incomplete inventories, import
and CLI entry, LF/CRLF metadata removal, changed executable bytes and cleanup.
Two no-API-mock integration tests reproduce the actual c8 empty-map success and
run the complete generated, compiled, source-free lifecycle workflow.

The exact coordinator scope is all-four 100%: 42 statements, six branches,
four functions and 39 lines. VM maps are merged only into this explicitly selected
scope, not the normal library denominator. Source SHA-256:
`0fd8c761f536b818eafcc07a521639216770dc4b8d87a8670cc79cfdbeba3e32`.
Report `coverage/starter-lifecycle-coordinator/coverage-final.json` SHA-256:
`adcfe7be6387d8d980262f78a551c07858449b93f8ef62e45b30adfbc6fa12c2`.

The ordinary `npm run verify:starters:lifecycle` CLI also passes after those tests.
Its 13 real lifecycle cases pass with no skips or failures; the report contains
exactly one emitted module, 57 statements/lines, 20 branches and four functions,
all covered. Existing tests use real child processes, HTTP/TCP/WebSockets and
timers. On Windows, signal events are explicitly emitted by the fixture; Linux
uses actual OS signals. This local result is not a new Linux execution claim.

Final CLI artifacts: `coverage/starter-lifecycle/d23cbdd7-93d3-4639-bb11-d79721fa4fb0/`.

| Artifact | SHA-256 |
| --- | --- |
| `coverage-final.json` | `e87cb491536901d88530db1ee9140c813b6e416ec60d5b26c8170e7ac1fa63d8` |
| `deployed-run-app.js` | `680c7c29aee7628f578c95df0d58ce7fa34252d9e13660194c5d1ed055bf9c3c` |
| `deployed-run-app.js.map` | `f42265ab86fcacf880083e9ada2b414fcac70c3bba05753f575a154b359d88ca` |
| `measured-run-app.js` | `3b06e16afa137a5b55b0d6a2ce95abc4f638e5dead30b1ae0260825ea2ca8f45` |
| `test-output.txt` | `df897133496bad53d81c4f1e44e09876321584b9eac3749dc70feda1da94ca2e` |

CI allows eight minutes for the scoped tests and five for the ordinary CLI,
covering existing inner command/cleanup budgets, and retains evidence for 30 days.
The critic approved the source and verified the metadata-only transformation.
The previous 1,388-test/132-suite regression does not include these 26 later cases.
No runtime/compiler changes, threshold relaxation, benchmark waiver, npm
publication, deployment or new hour-soak result is claimed.
