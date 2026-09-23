# Browser-command deadlines for feedback verification

Independent review identified unbounded command promises when the feedback driver
received a raw debugging connection. A local native probe acquired a genuine
Chromium tab, terminated its debugging socket, waited for its real close event,
and returned the unchanged tab to the driver. After 20 seconds the verifier was
still pending and its actual Redweb server was still listening. The probe then
explicitly rescued and closed its resources. No browser/server methods or timers
were replaced. This is a verifier hang, not an application WebSocket defect.

Pre-fix helper SHA-256:
`3174a331f8848c4efdff3a4aebdb7feddd4efd3dcb5f5caaedaf7b5cbaef4b76`.
The retained diagnostic transcription `coverage/feedback-disconnect-before.json`
has SHA-256 `8e5c442e9a00ad352d1b4c0c4b1175d2c6ae14a701dcb9d814f1c05546d5a0c4`.

## Shared command adapter, unchanged ownership

`browserCommands` bounds evaluation and protocol commands to 15 seconds. The raw
tab is registered with its caller before the adapter is created. The adapter keeps
the same socket and delegates through the original method receiver without mutating
the tab. The coverage caller's duplicate adapter was removed; its separately bounded
startup validation and final coverage collection remain. The installed-package
harness copies the same helper, increasing its input inventory from 25 to 26 files.

These command deadlines allow the feedback driver's existing `finally` to shut down
its server after a disconnected debugging transport. They do not cancel an underlying
command or establish page-acquisition ownership. In particular, raw `openPage`
acquisition from the frozen launcher remains unbounded. No unowned timeout race was
added there, and no complete-acquisition claim is made. The separate native tests
below now measure all authored feedback-driver paths; complete coverage is not a
claim that every underlying acquisition operation is bounded.

## Feedback coverage milestone (`9897924`)

At this checkpoint, `npm run verify:feedback:commands` combined nine explicit command-boundary units
(including labelled fake-clock checks) with six real integration cases. The closed
Chromium connection case uses actual sockets/timers and checks that the server is no longer
listening and has no shared pages **before** rescue cleanup runs. The other three
cases retain real page-disposal/setup failure coverage. Production shutdown wraps
disposal rejections in `AggregateError`; this work does not claim a native falsy
shutdown bug.

Two additional Chromium cases run the complete acceptance driver. The successful
case omits optional callbacks and verifies that its real HTTP listener refuses a
connection after return. The cleanup-only failure registers an actual decorated
page whose disposal throws, and verifies error identity, empty shared-page storage,
listener closure and resolution of an actual pending fixture waiter. No browser,
server or transport API is replaced. These cases reuse the existing workspace and
page owners, with a 180-second driver watchdog, independent browser cleanup and a
bounded drain of the original driver promise. Each has a 360-second outer budget.

That 15-test/four-suite scope passed in 20.765 seconds with all-four 100%
coverage: 176 statements, nine branches, 14 functions and 162 lines. The adapter
accounts for five statements/lines, three functions and zero branches; the complete
feedback driver accounts for 171 statements, nine branches, 11 functions and 157
lines. Browser coordinator coverage remains separate. The closed-connection test allows 180 seconds
for bounded launch, 60-second supervision and independent cleanup. Existing failure
tests now allow 45 seconds instead of inheriting five while server shutdown can
take 15. Uncertain browser shutdown retains its workspace and independently releases
local pipe/reference handles; those releases are not proof of process termination.
That checkpoint allowed 20 minutes in CI and retained coverage for 30 days.

| Exact source | SHA-256 |
| --- | --- |
| `scripts/lib/browserCommands.js` | `cc6d26f257a20c8549225772d379a2091288a55719c7aa2f63dc151ce5a1fc76` |
| `scripts/lib/verify-action-feedback.js` | `8f35661e324f8dd962f80165800cc15e491b9c9a0f0d3261470e9162df6dd028` |
| `scripts/verify-browser-coverage.js` | `96325de65161f7d68c6da3ea85700e6fccb85b45ddb34c7645cdf5eaeefe8e06` |
| `scripts/lib/PackedBrowserHarness.js` | `fd9cf313775b77fbebd73a0097efe0c8f5ec830b17f370451f2ed4f3cae39855` |

That checkpoint's report `coverage/browser-commands/coverage-final.json`
has SHA-256 `5c04776ecc36f5df1753c94afa388d3b509c54425f179a4454006261dec7f18b`,
matching the initial expanded-scope report under `coverage/feedback-driver/`.
The critic approved the corrected native tests after requiring exact error leaves,
an actual waiter promise and preservation of late driver failures. Pretest,
generated-documentation and all three type configurations also pass.

## Refresh command reuse follow-up

The same native disconnected-DevTools test now also runs the actual refresh
control driver against its real revision peer. Before correction, it remained
pending until the 60-second supervisory watchdog fired; the expected command
deadline was never reached. No browser/server/timer method was replaced.
Pre-fix refresh-control source SHA-256:
`0573ef0f8f589f49cc64849285ed61967869e8085dd344246bf8566fca2a8275`.

Generated-app refresh and its shared control driver now reuse `browserCommands`.
Raw tabs are registered before wrapping. A private WeakSet recognizes already
bounded facades, so the coverage caller can reuse the same adapter without
stacking timers or keeping tabs alive. Its duplicate inline adapter was removed;
coverage cleanup still receives bounded commands, and generated-app cleanup
continues to use bounded DevTools HTTP requests.

The maintained command now passes 17 tests/four suites in 36.407 seconds: ten
explicit command-boundary units and seven real integration cases. Both disconnected
native paths reach their 15-second command deadline and verify actual listener
cleanup before rescue. The refresh test also verifies empty pending/script sets.
All-four coverage of the adapter and complete feedback driver remains 100%:
181 statements, 11 branches, 14 functions and 166 lines. The adapter contributes
10 statements, two branches, three functions and nine lines. This is not complete
direct coverage of refresh helpers or either browser coordinator.

Current report `coverage/browser-commands/coverage-final.json` SHA-256:
`5a4be585d836f0510a4ec80c0fef0a32dbbff3e41330af19af1f158709b45e21`.
CI allows 25 minutes for the added native case and all declared failure budgets;
individual command deadlines are unchanged. The critic approved the shared
wrapper, raw ownership ordering, bounded cleanup and expanded budget.

| Corrected source | SHA-256 |
| --- | --- |
| `scripts/lib/browserCommands.js` | `bb2d1de242289f543680e97493cb04fe99ae2f35c89b4e276e1862a1e21336e3` |
| `scripts/lib/verify-refresh-controls.js` | `a05a1145e636a8e4f7750fff3dd8036aab54fa3ee22bbb6d8bdb068dbca104b2` |
| `scripts/lib/verify-refresh-coverage.js` | `7062f23e3fcac0273b2c9d41858ad7e95dd519daaa0d70a60e10695930f1d6e9` |
| `scripts/verify-development-refresh-browser.js` | `ccb01383ef684cb59bc07bcd87e576e7fb08d2c734abfabdb2c047d957449e0e` |

The unchanged native runtime/refresh scopes also pass: 426/262/64/351 and
82/44/12/71 statements/branches/functions/lines, respectively. Actual case
inventories match between plain/instrumented runs; back-forward-cache restoration
was observed. Runtime run: `f5943d26-64ae-4ea1-b754-c917996ccb8b`; refresh run:
`732f7c31-bfeb-402d-bf2c-4446fb5c26d6`. No public runtime, frozen helper or
acceptance threshold changed. Raw page acquisition remains a separate open
boundary; command deadlines do not cancel its underlying operations.

The corresponding runtime/refresh report SHA-256 values are
`f0067f98198760a5ed07b5536c6ae9a0b8253b65e75e1b998f80dc5c57a42b86`
and `7392a9a0d69d40bff5cfdf85ae1e21b6699ca60c2f485c38afc8948cdbbdb418`.
The complete generated-app development gate also passes real TypeScript/CSS
rebuilds, failed-build recovery, draft/focus retention, explicit discard and state
reset, plus the shared outage/recovery and input guards. Actual back-forward-cache
restoration was observed. Pretest, all three type configurations and the four
documentation units pass for this increment.

The refreshed linked-client authored gate passes its 26 collector/preflight/report
tests, five worker reports and matching ordinary/instrumented native browser cases.
All-four authored coverage remains 100% over 791 statements, 521 branches, 125
functions and 659 lines. Its ordinary browser/transport bundles retain their
production identities. Run `0248026f-dadf-42fe-bb9a-1bc287f4fbb5` under
`coverage/client-source/` retains `summary.json` SHA-256
`c876bc77f0261fff6e7b1f8761cbcd09e26053d802246a44eec431e4387fd876`
and `coverage.json` SHA-256
`8673e236f675d741cb0f55d4f4bf630f2e2a50c2f2f76f856622558491ac8009`.
Both npm links and the client's pre-existing version edit remain untouched.

The complete isolated-package gate subsequently passed with registry
`redweb-client@0.2.0` and matching identities for all four production bundles.
Installed counter/chat/reconnect/disconnect, dependency isolation, generated
additions, authenticated dashboard, all three copied browser phases, source-free
starters, executable docs, compiled consumers and static export passed. TLS
verification remained enabled. Tested archive SHA-256:
`97ab4789755132d66bcdd219b2390879ea4c4657fb273fafe2c8326edf975ee3`.
This archive predates the final evidence-only documentation additions.
Report `coverage/packed-browser/ed6f21ed-4300-4645-94e5-6a6842765e4f/report.json`
has SHA-256 `01d047163d0569b30c0769231486ab815b33b4fac6bc6519bb081f8a18296e39`.
It records 210 package files and 26 unchanged copied harness inputs, with harness
SHA-256 `0a0cdf39fa16c8e995de1474fae0d70773594eb96552423cd5215c96a43232b4`.
The critic approved all eleven actual remote files at implementation commit
`82156ee`, their evidence identities and all 66 generated pages. The critic also
approved the three actual remote package-evidence files at `7a0297e`.

The full regression at `7a0297e` then passed 1,488 tests across 142 suites in
794.914 seconds, with two POSIX-only skips. The unchanged 91-file library retained
all-four 100% coverage: 5,449 statements, 4,046 branches, 978 functions and 4,468
lines. Full result `coverage/refresh-commands-full-results.json` has SHA-256
`7cba49a5fed554ceafbcba91e888b2e00a3ed4d541bb1e2ef216b086fff98e65`;
its `coverage/coverage-final.json` has SHA-256
`275f82a20c7ed1389b65ef7d2b3752006926ae85c8dc4800d5dc9c07173cb1ac`.
The client type check also passed, and a fresh production dependency audit
reported zero vulnerabilities with TLS verification retained. Later documentation
corrections and their additional tests are not included in this full-run count.
Both PR and push workflows for `82156ee` and `7a0297e` subsequently passed.
Later-head hosted outcomes remain separate; no prior pass is relabelled current.

## Earlier native acceptance and remaining gates

The complete ordinary/instrumented browser-runtime and development-refresh gates
pass with matching case inventories and unchanged all-four 100% emitted-code scopes.
Runtime covers 426 statements, 262 branches, 64 functions and 351 lines; refresh
covers 82 statements, 44 branches, 12 functions and 71 lines. Actual server actions,
feedback, selection updates, history restoration and outage/draft guards pass on
Windows / Node 22.21.0 / Chrome 152.0.7977.64.

| Native report | Run | SHA-256 |
| --- | --- | --- |
| `coverage/browser-runtime/report.json` | `2813578e-7b5d-4af6-a331-403f2328b15c` | `5bc71d191bd66de750bdb08dd657772c4fb72b10dcd8743936b282e71c6643e3` |
| `coverage/browser-refresh/report.json` | `fa70d407-f57f-45c3-8793-8a1626db594a` | `fd3b9bcfd5cedb970cc15a3412f21ffcbd05ec10c4830b562c61811045d8ba05` |

The linked-client gate also passes 77 tests per ordinary/instrumented mode, five
worker reports and actual browser acceptance. Its authored scope remains all-four
100% over 791 statements, 521 branches, 125 functions and 659 lines. Source-built
ordinary bundles still match the linked production build. Run
`3ba3d058-886d-42e7-9e01-d07e64fe2dff` under `coverage/client-source/` retains
`summary.json` SHA-256 `877858b6ad0b98b0bce825dde8f39f6010682905dfd5acd5574ded9205284aa7`
and `coverage.json` SHA-256 `4f6c0ce9e07e613366360dbda6dffc0dff0cb16fa02e55cd4470a32a8bb9fb21`.
The separate collector/preflight/report suite passes 26 tests. The standalone
Node-only V8 diagnostic remains separate and is not relabelled passing.

Pretest/generated/type checks and four documentation units pass. The critic approved
the adapter, native test, independent fallback releases, budgets and scoped evidence.
The actual-PR review approved all 16 remote blobs at `e3b4902`.

The complete isolated-package gate then passed with registry `redweb-client@0.2.0`
and matching identities for all four bundles. It exercised installed counter/chat,
dependency isolation, generated additions, authenticated dashboard, copied browser
acceptance/runtime/refresh, all source-free starters, executable docs, compiled
action/room consumers and static export. No runtime modules were replaced, and
TLS verification remained enabled.

Tested archive SHA-256:
`c2589e8fff6c4247b98b5aa0de47c2244feaefb79351bc0abf4ff4f8c0cbbdcd`.
This archive predates subsequent evidence-only documentation edits. The retained
browser phase report is
`coverage/packed-browser/369c631b-7c8b-4986-9e23-8e8bba9b6a68/report.json`, SHA-256
`c43cdc79bc50645e8f07d715f29982ce99b15946e2b23714ee17d1c4df0dd237`.
It records all three browser phases passing, 210 package files, 26 unchanged
harness inputs, and harness SHA-256
`ce81b626e0d87bb50edf1856522a3916bdf983dd1629404b7e1ab1a2052608c3`.

The full regression for `69dcbf8` passed 1,469 tests/140 suites in 759.054 seconds,
with two POSIX-only skips and the unchanged 91-file library at all-four 100%
(5,449 statements, 4,046 branches, 978 functions, 4,468 lines). The two full-driver
cases were added after discovery and pass separately; they are not included in
1,469. Retained full result `coverage/feedback-commands-full-results.json` has
SHA-256 `b4a5bcb06d59d2759e7a6a7190c9100023916beeb70d062d25f6a02e0d749be9`;
the corresponding `coverage/coverage-final.json` has SHA-256
`04c2f534616e477c367126cb5009b7e0496fc832b3e1dfb57e9048b64330952f`.
Both `659f638`, `9c29a6e` and `e3b4902` hosted workflows passed completely. Latest hosted
results remain separate and are not presumed passed.
No npm publication, deployment, frozen-file edit, benchmark waiver or new long-soak
claim is made.
