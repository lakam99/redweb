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
Final runtime-fix regression and hosted checks are separate pending evidence.
