# Retaining failed starter coverage evidence

The starter coverage measurement and authored-source gate previously copied raw
reports only after child commands and parsing/collection succeeded. If a child
wrote coverage and then failed, or its output was malformed, workspace cleanup
could remove the only raw report. Successful authored runs also discarded the
individual process maps after combining them. This was an evidence-loss defect,
not a demonstrated false-green coverage result.

Both runners now create retained application directories before execution and
reuse `reportCommand` to preserve available raw bytes before parsing or collection.
The authored gate retains individual maps in `process-reports/`; both runners
save successful command logs immediately. Missing reports still fail validation,
and failed commands remain failures even when a report was written.

The shared helper handles a file or directory. A directory destination is first
reserved with an exclusive creation, preventing `cpSync` from silently merging
new files into an older report. Primary and copy failures remain visible together.
Copying is not atomic: partial bytes can survive a failed copy, are not certified
complete, and cannot be reused as a fresh destination.

## Tests and scope

`npm run verify:reports:coverage` passes 15 tests across two suites in 1.064 seconds
on Windows / Node 22.21.0. Five explicit fault units complement ten actual managed
child-process/filesystem cases. They check successful/failed exits, absent reports,
nested raw directories, malformed bytes retained after parsing failure, exclusive
destinations and combined failures. The mid-copy unit writes one actual file before
injecting a copy failure, then proves a second attempt cannot merge into it.

The exact `scripts/lib/reportCommand.js` scope is all-four 100%: 16 statements,
eight branches, one function and 14 lines. CI allows seven minutes for the summed
350-second outer failure budgets and retains the coverage report for 30 days.
This does not claim direct 100% coverage of either entire starter coordinator.

Source SHA-256:
`65ef5c11a4855b16b3d3277d5a541e88a0edeba96fd12e24efebae30c6ff029c`.
Report `coverage/command-report/coverage-final.json` SHA-256:
`1bcc4a8daa5da4f51e2567bfe007f4a1533150067292b315f261d31500dc787a`.

The new directory-retention regression failed in both real child exit modes before
the helper gained directory support. Both pass after the correction.

## Actual starter runs

The measurement runner completed all six applications, retaining its diagnostic
status `measured`, not a passing all-code gate. Compiler-generated function gaps
remain visible: realtime 58.33%, chat 59.09%, dashboard 88.70%; the other three
applications have all-four 100% in that separate V8 map.
`coverage/starters/e7da2be3-5366-4a21-8641-2420e7fca1ca/summary.json` SHA-256:
`ad7b088829ce1e88bfd68194d13900f548d6c42b08a082de9bdd28a9e806ac51`.

The authored-source gate then passed all six applications, 104 real tests in each
plain/instrumented mode, no failures or skips. Its unchanged authored denominator
is all-four 100%: 600 statements, 299 branches, 160 functions and 472 lines.
All 96 individual process maps are retained, matching the per-application reported
counts (14/15/14/14/24/15 for realtime/chat/site/socket/dashboard/http-ws).
`coverage/starter-source/ad9c5821-7437-4988-9c62-520d8ccb1a79/summary.json` SHA-256:
`971d8cd416080019a48bc901a24a19096ee86162aecd93fb61189b1e4043a702`.
These runs use actual generated applications, HTTP/WebSockets, files and SQLite,
including the dashboard's real one-minute rate window in each mode.

The unchanged application collector's five tests also pass at all-four 100%.
Compatibility with the existing client-report path passes 31 selected checks
across four suites in 4.546 seconds, with all-four 100% for `ClientSourceCoverage`
and the retention helper. This is not a rerun or resolution of the separate
standalone client V8 diagnostic.

The critic approved the implementation and partial-copy/exclusive-root tests.
The preceding 1,322-test full checkpoint in `ACTION_INPUT_VERIFICATION.md` does not
include the ten added cases in this follow-up. No coverage thresholds,
compiler/runtime behavior, frozen evaluation files, publication status or
performance acceptance were changed.
