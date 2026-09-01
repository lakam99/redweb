# Application coverage-recorder verification

The recorder source is unchanged. This increment adds direct measurement of the
small exit hook that writes authored application coverage from actual child
processes. It closes a private-tool measurement gap, not a production-runtime bug.

`npm run verify:recorder:coverage` passes six selected tests across two suites:
five isolated recorder units and the existing actual instrumented-script pipeline
integration test. Eight unrelated integration cases are intentionally filtered,
not counted as passing. The source-level Istanbul map covers six statements, two
branches, **one function** and six lines, all 100%.

One unit observes the hook registered with the real process, invokes it with absent
and present coverage data, checks real files, then restores its listener/global/
environment changes. Four native subprocess cases verify no invented report,
exact payload and unique child filenames, visible missing-directory failure and
visible serialization failure. The existing pipeline integration compiles and
executes original-source-instrumented scripts and validates their actual report
inventory. These checks do not replace HTTP, filesystem or process APIs.

## Why the native percentage alone was insufficient

The first c8 run passed five tests but reported zero measured functions. Inspection
of its nine relevant raw V8 reports found the authored anonymous callback at offsets
232–496 with execution count one. Installed `v8-to-istanbul@9.2.0` only creates
function entries for truthy function names; both the wrapper and arrow callback
have empty names. This is a conversion limitation, not evidence that the callback
did not execute. The critic independently verified the raw ranges and converter.

The older native map remains diagnostic evidence under
`coverage/application-recorder/coverage-final.json`, SHA-256
`0ae6fdd8f6cab04610a688f7e395695f8489d4a7eac377ef35789c802af11ac4`.
Its 13 line-based statements, three branches and zero-function denominator are
not presented as complete authored function coverage. Do not rerun a native-only
collector with the Jest-transformed callback test mixed into the same source map.

The maintained gate instead uses the nonvacuous original-source Istanbul map
alongside native behavioral evidence. CI allows five minutes and retains its
authored report for 30 days on success or failure. The critic approved this scope,
restoration behavior and supervision; no source rename or converter patch was
needed merely to change a percentage.

Source `scripts/lib/record-application-coverage.cjs` SHA-256:
`265b87f95d71b44bb59a9b50b1eda0d831188283a5c2f9b85bb3dfa0a8cc4df3`.
Authored report `coverage/application-recorder-authored/coverage-final.json` SHA-256:
`d487e66d02da76915f452b451d972aed9cb44bcbf06bd6658a74af30b98642e5`.
The first authored run passed in 1.517 seconds; the maintained command then passed
in 1.325 seconds with the same report hash. Its five new unit tests were added
after the preceding full regression selected its inventory; they are not
retroactively included in that full-run count. Broader release gates remain open.
