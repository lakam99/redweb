# Soak-verifier correction

This increment changes verification tooling, not Redweb's production runtime.
It closes a private-tool coverage gap without waiving the separate throughput
benchmark or claiming a new one-hour soak.

## Reproduced weakness and correction

The original command ran against real sockets for ten seconds with two clients
and a 20-second sample interval. It exited successfully with only two samples.
Its final heap became its own warm baseline (exactly 100% reported), and all
eight trends compared the initial sample with itself. The original script SHA-256
was `ce30f8abcda0e018b8c586bd53dba775aebdaaaaf5275aa8bdf2b2f8d9b1d22b`.
The retained report `coverage/soak-original-sparse.json` has SHA-256
`fc8cf5d93237e27f91f7c3ac8838682ac4b8ec629d1c0ed65ef3652ea8ad4eaa`.

The policy now requires safe native timer ranges, array/derived exchange-count
capacities and enough actual active-phase samples. The socket owner records every
transport immediately, settles parallel acquisition, and matches the existing
`{tick}` replies against each connection's pending ticks exactly once. Arbitrary
frames, duplicate/unsent ticks and unexpected disconnects fail instead of inflating
delivery or silently reducing the workload. Intentional rotation/cleanup remains
distinct, and lost replies remain counted as missing.

Traffic/sample failures and rotation errors signal the coordinator immediately.
Timers stop, pending rotation settles, drain/client closure/expiry sampling/server
shutdown are attempted independently, and primary plus cleanup failures survive.
Output follows cleanup; an existing output file cannot be overwritten, and a
failed file write cannot be preceded by misleading success output.

## Preserved measurement boundaries

- Defaults: 3,600 seconds, 64 clients, five-second samples; 100 ms traffic and
  one-second rotation cadence; original route limits and unchanged wire payloads.
- Original GC sampling sequence, upper medians, trend windows and eight growth
  budgets; at least two active-phase periodic samples are now required.
- Final heap is sampled after client closure/expiry but before server shutdown.
  The later two GC calls do not update the reported final heap.
- The existing 99% delivery, 110% final heap and baseline-plus-one handle limits
  remain. Integer count/byte comparisons avoid floating-point boundary errors;
  the displayed ratios are retained. A genuine 1,000→1,100-byte fixture previously
  calculated `110.00000000000001` and falsely failed the exact 110% boundary.

Explicit pending sets/listeners/ownership change the harness's allocations and
parsing work. These results are not byte-identical historical measurements or a
claimed runtime optimization. Short integration workloads establish mechanics,
not production capacity or long-run stability.

## Verification

Windows / Node 22.21.0: `npm run verify:soak:coverage` passes 80 tests/four suites
in 14.494 seconds, requiring all-four 100% across three files: 241 statements,
100 branches, 65 functions and 173 lines. Native WebSocket/process tests cover
valid traffic, rotation, malformed/duplicate/unsent replies, server-error frames,
unexpected closes, partial acquisition, failed replacement, missing GC, sparse
sampling and actual short-run reports. Explicit boundary units cover policy,
timers, cleanup faults, exact limit acceptance and output suppression. No API mocks
are used in the native integration tests.

The first client-unit draft used cross-realm `instanceof Error` against Node's
AssertionError. It was corrected to Node's native-error check; no production
change was made for that fixture issue. The critic's exact-boundary, derived
counter capacity and supervision findings were corrected. The native rotation
test allows 80 seconds for all operation/cleanup phases. CI allows 20 minutes for
the complete scoped suite and retains reports for 30 days on failure or success;
the separate 30-second/16-client CI soak has two-minute external supervision.

| Source | SHA-256 |
| --- | --- |
| `scripts/verify-soak.js` | `1a2b1a7bebc81b0b95e078774bc0c9b534d70b58f852caad1b564f508151c91c` |
| `scripts/lib/SoakClients.js` | `b00458a3dd1970124107e3c6990848af738f080e6ea3f2c7b56e9e952a4c22a5` |
| `scripts/lib/SoakMeasurement.js` | `0883d6d5ef6c92b8a2161274b1dbe86187795a629de0705f6e6928f812d7424a` |

Report `coverage/soak-tools/coverage-final.json` SHA-256:
`a32bc0a90a69aba60c727e060df20e5fe90181335b618e96a963cb69d028a4c8`.

An initial clean 30-second/16-client run before the review follow-ups passed:
4,365 sent, 4,364 received, one missing (99.97709049%), seven samples, all eight
trends stable, zero registries, final heap 100.09062623% and handles 1→2.
Report `coverage/soak-corrected-20260831-0346.json` SHA-256:
`860351a6038c9a43c5a0190ff98400c88cdf3de0201a20eaacfda721d8b8a73f`.

After final scoped tests exited, the corrected 30-second/16-client run passed:
4,368 sent, 4,365 received, **three missing** (99.93131868%), seven samples, all
eight trends stable, zero registries, final heap 99.78205308% and handles 1→2.
Raw evidence `coverage/soak-corrected-final-20260831.json` has SHA-256
`9816802b52c68a774b232e23871fed16609baa88cd9c9a7c7e4809ac357f0113`. Neither run is
lossless. Hosted checks for this increment remain pending.
No npm publication, deployment, merge or new 60-minute soak occurred.

The full regression selected at `31fa9b2` passed 1,246 tests/119 suites in
653.569 seconds, with two POSIX-only skips on Windows. All 91 library files retain
100% coverage: 5,449 statements, 4,046 branches, 978 functions and 4,468 lines.
Library and soak-verifier sources remained unchanged throughout. Five later
application-recorder units passed separately and are not included in 1,246.
Generated-content/type checks pass, and the critic approved all 15 actual remote
blobs on PR16. Hosted PR33370390186 and push33370386741 were still running when
this evidence was recorded; completed lifecycle/package jobs are not a complete
workflow pass.

Full map `coverage/coverage-final.json` SHA-256:
`78ffc666b8181154cf5a6c2b9673e82b6f65b50d6c5fbb29d02941c96d598d0e`.
Inventory `coverage/soak-full-results.json` SHA-256:
`2ac4d0bc14ec7fee441a38f710ac1234b68ceb7c94d1280523df3acaa9b2304e`.

## Subsequent hosted room-phase failure

Both workflows at `31fa9b2` eventually completed successfully. At `d29be8c`,
push run 33371370687 passed, but [PR run 33371374433](https://github.com/lakam99/redweb/actions/runs/33371374433)
failed its Node 20 ten-second/two-client mechanics fixture. That failed result
is not replaced by the passing sibling: 198 sent/198 received, no missing replies,
11 samples, zero final registries and final heap 103.71149824% of warm. The sole
failed trend was rooms: early 1, late 2, delta 1, peak 2, allowance 0, monotonically
increasing. The saved summary lacks phase samples, so the exact CI timing cannot
be reconstructed.

A new deterministic native test uses real Redweb room handling and `SoakClients`:
two clients join separate rooms; rotating one removes its sole-member room; the
replacement connects while the room count remains one; its next tick recreates
the room. All four replies are exact and final clients/rooms are zero. This proves
the observable 2→1→2 phase exists, not that the historical CI run followed that
precise sequence. Its first local fixture omitted room configuration and failed;
after supplying the actual soak's room settings, the deterministic test passed.

The ten-second test now checks measurement mechanics and the unchanged policy's
actual exit code. It permits only that exact 1→2 room-trend failure; all other
trends, delivery, final heap, handles and empty-registry assertions remain strict.
Launch, timeout, malformed output, stderr and cleanup failures still fail the test.
Its report and actual exit code are retained in
`coverage/soak-tools/smoke-reports/` as **mechanics-only**, including in CI artifacts.
A passing mechanics test does not relabel its nonzero measurement as acceptance.

No runtime, traffic, rotation, sampling, trend budget or policy source changed.
The separate blocking CI soak remains 30 seconds / 16 clients, and the default
one-hour workload and all acceptance thresholds are unchanged. Neither the
historical short failure nor the open throughput benchmark is waived.

The corrected mechanics fixture passed within the maintained 80-test/four-suite
soak coverage run (14.414 seconds), retaining all-four 100% of the unchanged three
soak modules. The separate deterministic room-phase test passed in 0.751 seconds.
The senior critic approved both the bounded reproduction and narrowly preserved
failure outcome. A complete regression and fresh clean blocking-soak check follow
this checkpoint; neither is claimed here before it finishes.

That follow-up completed at the `551a905` implementation checkpoint: full local
regression passed 1,292 tests/126 suites with unchanged library scope/100% coverage,
and both PR33373452034 and push33373448945 passed every matrix/lifecycle job.
The single clean 30-second / 16-client gate recorded 4,368 sent, 4,363 received,
five missing (99.88553114%), seven samples, all eight trends passing, empty final
registries, final heap 99.909556% and handles 1→2. Raw report
`coverage/soak-package-final-20260831.json` SHA-256:
`4bd8bd5e95054da8c27f1236ca42335663fde6e303c3a850db3e4a684079b371`.
This remains an unchanged-threshold short acceptance result, not lossless delivery,
a new hour soak or an explanation of the exact earlier CI scheduling sequence.
