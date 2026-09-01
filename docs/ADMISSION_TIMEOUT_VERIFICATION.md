# Terminal admission interruption

PR CI at `2360507` failed the Node 24 real-network test that requires timed-out
authentication to stop before placement: `laterCalls` was one instead of zero.
[Failed run](https://github.com/lakam99/redweb/actions/runs/33355801447).
The corresponding push run passed. This is not treated as a waived flaky test.

Inspection found that the timer rejected the operation and aborted its internal
signal, while checkpoints consulted only the external signal and elapsed time.
A delivered timeout was not recorded as a terminal checkpoint decision. A unit
test controlling timer delivery independently of the real monotonic clock failed
on the old implementation: after timeout, its checkpoint did not throw.
This proves the defect class; the hosted failure did not record clock samples,
so its exact timing sequence remains an inference rather than measured evidence.

The first interruption is now retained before notifying abort listeners.
Checkpoints, timer delivery and cancellation preserve that same error. Later
cancellation cannot replace a timeout, and reentrant abort listeners cannot
observe an active operation. Real admission capacity remains charged until the
underlying callback settles; existing network assertions and limits are unchanged.

Focused verification: 76 tests in four suites pass, including existing real
HTTP/WebSocket diagnostics and explicit unit scheduler/listener injection.
The changed `BoundedOperation.js` scope is 100% across 41 statements, 16 branches,
nine functions and 34 lines. Report `coverage/bounded-operation/coverage-final.json`
SHA-256: `ca3cfe507fea273f0917f25fc5ac15c0c2ddec19f5b26e73279c60ec7733d4a2`.

The preceding complete local regression passed 929 tests/90 suites in 490.093s,
with pretest/types and 100% library coverage. It included the new example matrix,
but not the subsequently added room failure units or this timeout regression.
Its report SHA-256 is
`59614b33aa16c61b75578898335c7f5a7a5e4bb1776e63362955b972442670b4`.

## Verified runtime-fix checkpoint: 6018807

- Full local regression: 940 tests/92 suites pass in 490.079s, including normal
  pretest/generated/type checks. All 5,449 library statements, 4,046 branches,
  978 functions and 4,468 lines are covered (100% in every metric).
  `coverage/coverage-final.json` SHA-256:
  `8bbdb32f1ab30d182cd74d407ffc6e914b6ae149be7586ba1efef0c4cde8e558`.
- Clean package and published-client verification passed, including counter/chat,
  reconnect/disconnect, all six starters, source-free consumers, executable docs,
  native browser acceptance and all-four100% rendering/refresh coverage.
  Archive SHA-256:
  `84d22ba5322ace9953aeb386943557c4cbb5c1ef3eaafe6329686690a341b20e`.
  Browser report `coverage/packed-browser/5422a8a0-df36-495c-ac19-2db06d5ce8ef/report.json`
  SHA-256: `830a03536e8c0f38d98eeab64339c438240d3c629452605997cf0e54cceb99d0`.
- Sequential local resource gates passed after functional tests ended: 3,200
  messages/32 clients at 6,276.42 messages/s, p99 7.573ms; metadata overhead
  1,873.472 bytes/connection below 2,048; 200 expired HTML renders/110 live clients
  with 7,982,512-byte heap delta; 10,000 JSX component rows in 54.2ms, 1.3MiB retained.
- Server recovery passed all 7,400 exact replies and unchanged cleanup/provenance
  gates: peak 108.533915%, final 97.381355% of the same warmed server baseline.
  Client peak 112.931771% remains separately reported, not judged by the server
  budget. `coverage/server-recovery-candidate-1fPRwY/report.json` SHA-256:
  `085764109255f99cf37e9cb74f9ad13979487f264c600e518a9c256e03ade962`.
- Production dependency audit reported zero vulnerabilities using Windows system
  certificate trust. The preceding default-trust request failed certificate
  validation; TLS verification was never disabled.
- The independent senior critic approved the actual latch and cleanup changes
  and checked their separate all-100% coverage reports. No npm publication or
  website deployment occurred, and the client checkout/link was preserved.
- Both [PR CI](https://github.com/lakam99/redweb/actions/runs/33356637883) and
  [push CI](https://github.com/lakam99/redweb/actions/runs/33356635036) completed
  successfully at `6018807`: Node18/20/22/24 and lifecycle jobs all passed.

The original failed CI run remains linked above. These results do not establish
whole-repository private-tool coverage or replace the historical 60-minute soak
with a claim of a new long-duration run.
