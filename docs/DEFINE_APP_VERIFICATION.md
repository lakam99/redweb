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
