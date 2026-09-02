# Original recovery verifier: exact boundary and maintained coverage

The shared-process command remains a visible, non-blocking diagnostic. The
separate server recovery contract remains blocking. Neither historical failed
measurements nor the unresolved performance/cleanup observations are relabelled
by this correction.

## Correctness

The previous comparison rejected `(1100 / 1000) * 100`, which JavaScript rounds
to `110.00000000000001`, although the byte counts are exactly at the 110% limit.
Expanded boundary tests reproduced two false rejections: 1,000/1,100 bytes and
1,000,000,000,000,030/1,100,000,000,000,033 bytes. The 28-case baseline had
26 passes and two failures despite 100% authored coverage; coverage alone did
not detect the missing equality oracle.

The verifier now compares `BigInt(heap) * 100n > BigInt(warmedHeap) * 110n`.
Equality passes, one byte over fails, and an intermediate over-budget cycle
still fails even if the final cycle returns to its warm value. This is exact
for the safe-integer byte observations tested; it cannot restore precision
already lost before a Number value is supplied. Displayed percentage fields,
workload, settling, snapshots and the strict any-cycle 110% limit are unchanged.
This narrow rounding bug does not explain the larger historical failures.

## Maintained scope

`npm run verify:recovery:original:coverage` runs 28 explicit boundary units and
the existing 17-test verifier suite, including actual HTTP/WebSocket traffic,
native CLI configuration refusal and private V8 snapshot checks. The units
provide the authored coverage map; the native child processes are not
instrumented by this gate. Synthetic unit transports, clocks and heaps are not
network delivery or memory evidence. Native fixtures use small connection
counts, not the default 7,400-connection acceptance workload.

On Windows / Node 22.21.0, the combined selection passed all 45 tests in
35.606 seconds: 112 statements, 71 branch outcomes, 20 functions and 93 lines,
all 100%. Source and statement/function/branch maps are checked before merging
the unit measurements. CI runs this separate bounded gate and retains available
coverage artifacts on success or failure; raw private heap snapshots are never
included in that artifact path.

Evidence (SHA-256):

- Corrected LF-normalized source: `fec32203599936362243fbd8fbf33d310852dccd727668f68da9ecfe9bee3de7`.
- Previous LF-normalized source: `95d56f52d5f9668b6dbfa8e8158f7ae86e128d65103e127abaed85fb3bab37c1`.
- Combined map, `coverage/original-recovery/coverage-final.json`: `bc0b50cb38278fb96dce51cacc1676ec9ffb58e5c27088145617a1f6bef54405`.
- Failed expanded baseline map remains separately at `coverage/original-recovery-boundary-baseline/coverage-final.json`.

## Full-suite failure and session observation correction

The preceding full Windows run at `0e3e257` failed: 1,893 passed, three failed,
five skipped across 172 suites in 1,386.598 seconds. Library coverage was 100%,
but that does not make the run successful. Two isolated-package tests timed out
during npm installation; actual npm logs show repeated
`UNABLE_TO_VERIFY_LEAF_SIGNATURE`. A read-only registry control succeeded with
Node's system certificate store and TLS verification retained. The retained
second log is `coverage/release-0e3e257/2026-08-31T19_08_04_026Z-debug-0.log`,
SHA-256 `6668414f7a4e4ee8eb456ff26879af4e950207d103ad3bdbc6a3515b51a8ee7f`.
The first log was inspected but rotated away before copying; no retained hash
is claimed for it. Focused retries must preserve certificate validation.

The focused package retests subsequently passed using scoped
`NODE_OPTIONS=--use-system-ca`, restored afterward, with no global npm config
change: 71 package-coordinator tests in 307.617s and 40 packaged-example tests
in 28.365s, both at all-four 100% in their existing scopes. The isolated consumer
installed published `redweb-client@0.2.0`; real Chromium acceptance, runtime and
refresh checks passed, alongside source-free generated applications. The
production dependency audit found zero vulnerabilities. This verified correction
of local certificate trust does not relabel the failed full-suite run.

- Package-coordinator map SHA-256: `199e25f0d8f67c35119dbcd86e227ba6dace836aea14fe29e8d4f20d99791faa`.
- Packaged-example map SHA-256: `51729c6f8604ad0a0b1f4e5c3d71688b75f833d3cb6b78155c7dc769cdc14c17`.
- Packed browser report: `coverage/packed-browser/1ffb552b-0168-4220-8555-4f74537cb6ec/report.json`, SHA-256 `41a229941b45105d107ad91e8cacb9527f8acaf0e17dba97fe0e1d6a2432d9c9`.
- Tested archive SHA-256: `6bf8f30b8cf2f719f202ff192b05bbd1865909cfeebd3a3d8974897e6d4cb2b9`. It predates this final verification-note update, not the tested runtime/recipe code.

The maintained recovery command was then run verbatim: all 45 tests passed in
32.615s and produced the identical authored map hash. Generated documentation,
all three type configurations, four recovery-CI and 15 documentation/CI unit
checks passed. The independent critic approved the increment's scope and claims;
this is not whole-release approval.

The third failure asserted that a disconnected session still existed after
waiting for room cleanup, despite its 20 ms TTL. Adding an actual 50 ms observer
delay reproduced that assertion failure while the zero-delay case passed.
This demonstrates a fragile test assumption, not the exact timing of the
original failure, which retained no session timestamps.

The corrected real-network test observes session release in the route's close
lifecycle callback, after detachment and before a later expiry timer turn.
Both immediate and delayed observers assert takeover/data preservation and
then await actual expiry. TTL (20 ms), sweep (5 ms) and production socket
behavior are unchanged; no timer or transport mocks are used. All 31 tests in
the socket integration file passed in 6.849 seconds. Those focused passes do
not supersede the failed full run.

Both hosted runs for the preceding `0e3e257` commit passed every Node
18/20/22/24 and lifecycle job: PR run 33427313619 and push run 33427307579.
They predate this correction and do not certify it. Remaining split-worker
authored coverage and final release gates are recorded in
[the scope audit](COVERAGE_SCOPE_AUDIT.md).
