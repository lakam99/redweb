# Unified application verification

Candidate branch: `codex/define-app`. These are scoped verification results, not
a claim that the final release or all repository gates are complete.

## Starter migration (2026-09-01, Windows / Node 22.21.0)

- `verify:starters:lifecycle:coverage`: 72 unit and real HTTP/WebSocket/process
  tests pass. `Application.js` and `StartupCleanup.js` are 100% covered in
  statements, branches, functions, and lines.
- The CLI templates, `SourceInspector`, and `Documentation` reach all-four 100%
  with 80 unit/source-repair integration tests. The narrower unit-only command
  does not cover external template inspection; include the action-reference and
  doctor-source suites when reproducing this scope.
- `verify:starters:source-coverage` passed for all six original TypeScript
  applications, separately from compiler-generated JavaScript coverage. The
  retained run is `coverage/starter-source/a011d72d-1450-409f-935a-d21623c582a6/`.
  Its summary records input/report hashes and the actual source inventories.
- `verify:starter:browser:coverage`: 30 tests pass, including headed counter,
  chatroom, and multi-page site interactions from compiled/source-removed apps.
- `verify:dashboard:coverage`: 27 tests pass, including headed rejected/accepted
  login, private cards, draft preservation, logout/relogin, and deletion.
- The six generated applications pass real-network tests. Their shared process
  test imports inert definitions, runs each application, closes it via signals
  or native listener closure, and checks occupied-port startup failure. Windows
  exercises Node signal events; Linux exercises delivered OS signals.

The independent reviewer found no runtime blocker in the migration. The stale
generated-helper report is now explicitly historical. The copied `run-app`
implementation was removed, not retained beside the library lifecycle owner.

An earlier interrupted full-suite run had a browser-control failure before its
intended negative assertion. A standalone rerun passed all four working controls
and seven intentional faults (63.9 seconds), without changing the control or
weakening its assertions. That does not establish the cause of the earlier
failure or replace a completed full-suite run. Final regression, package, CI,
release-catalogue, and exact-PR-head review remain outstanding.

No soak or long fixed-window acceptance test was run for this migration.

## Follow-up regression repair

The earlier Linux CI matrix exposed `StartupCleanup` replacing native errors
from another JavaScript context with a generic error. The existing owned-listener
integration reproduced both failures locally. Using Node's `isNativeError`
preserves the original error identity/message without treating arbitrary thrown
values as native errors. A real VM-context regression was added; lifecycle
coverage is now 73 passing tests at all-four 100%, and all eight owned-listener
integration tests pass. The VM/owned-listener suites also pass on Node 18.

CI also identified an obsolete test-count assertion in the starter coordinator's
input-mutation check. Its expected successful fixture now includes one realtime
test and four application-entrypoint tests; failure-on-input-mutation assertions
are unchanged.

The reviewer caught a Node 18 distinction: `DOMException` is an `Error` there
but is not recognized by `isNativeError`. Keeping both checks preserves native
abort-reason identity as well as foreign-context errors. A native-process abort
regression passes on Node 18 and 22; the lifecycle scope now has 74 passing tests
and all-four 100% coverage. The corrected starter coordinator gate passes all
56 tests with all-four 100% coverage of its three coordinator modules.

## Release catalogue checks

The prepared package and lockfile are `0.14.0`. The 68-page generated catalogue
matches `docs/releases/0.14.0.json`; older release snapshots were not edited.
The package dry run includes the unified runtime and shared entrypoint tests,
and the release-documentation guard passes. No package was published.

The optional docs MCP adapter previously hard-coded an unreleased-channel
expectation. Its tests now compare against the loaded canonical channel and
exercise both valid channel variants. All seven tests pass, including actual
MCP subprocesses and isolated production-only package installation; all three
adapter modules have 100% line, branch, and function coverage.
