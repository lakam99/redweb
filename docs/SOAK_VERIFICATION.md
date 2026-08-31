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
lossless. Full regression/hosted checks for this increment remain pending.
No npm publication, deployment, merge or new 60-minute soak occurred.
