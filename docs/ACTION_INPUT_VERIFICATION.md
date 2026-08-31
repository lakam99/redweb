# Action-input verifier ownership and coverage

The verifier still compiles the same typed action consumer in standard and legacy
decorator modes, removes its TypeScript source, and runs all twelve original
validation/authorization/context requests. Forged identity, numeric overflow/range
errors, permission denial, valid accumulation, trusted context and revoked upgrades
retain their existing assertions. No production runtime or client API changed.

Listening and connection setup now have explicit five-second deadlines, including
the native WebSocket handshake. The existing five-second request limit is unchanged.
Reconnect is disabled for this single-connection probe, whose factory immediately
records the one native socket. Client parse/transport errors remain failures even
if later requests succeed. Revocation also has an outer five-second verification
deadline; the supported runtime already bounded its own revocation cleanup.

Teardown independently disposes the client, confirms native socket closure using
the existing shared helper, and bounds application shutdown to ten seconds.
The primary failure and cleanup errors remain in an aggregate. A cleanup failure
marks the existing workspace owner uncertain, retaining its directory instead of
removing the evidence or proceeding to the second compiler mode. This is failure
reporting, not a claim that arbitrary broken application shutdown can be repaired.

`verifyActionApplication` is a private shared acceptance function; the compiler
wrapper and native failure fixtures use the same implementation, not copied
validation logic. Existing networking/error/workspace helpers are reused unchanged.

## Tests and scope

`npm run verify:action:coverage` passed 42 tests across three suites in 20.189 seconds
on Windows / Node 22.21.0. It requires all-four 100% of the single verifier file:
63 statements, eight branches, nine functions and 53 lines.

Twenty-two explicitly mocked unit boundaries cover compile/start/listen/HTTP/
connection/request/client-event/revocation/upgrade failures and independent client,
socket and application cleanup. Eight actual HTTP/WebSocket peer cases cover bad
status, absent/malformed bootstrap data, rejected/silent upgrades, malformed action
responses, premature close and a silent action. The existing twelve integration
tests use real Redweb HTTP/WebSockets, compilation and filesystem operations.
Those native and compiled integration cases replace no transport APIs.

The integration teardown now independently disposes each client, confirms all
native sockets closed and shuts down every server. A 20 ms authorization test
still requires `ACCESS_TIMEOUT`, but no longer assumes a busy host necessarily
entered application policy before expiry. Every observed policy signal must be
aborted; the separate synchronized-entry disconnect test remains an unconditional
abort proof. There is no authorization-timeout increase or accepted wrong result.

The critic caught insufficient outer Jest budgets: sibling tests and teardown
previously retained the default five seconds. The corrected budgets are 90 seconds
for ordinary network cases, 30 seconds for teardown and 360 seconds for both compiled
flows. Inner acquisition/request/shutdown limits are unchanged. CI allows 45 minutes
for the combined outer failure budgets (about 38 minutes 20 seconds including hooks)
and retains the scope report for 30 days; ordinary execution takes about 20 seconds.

Source `scripts/lib/verify-action-input.js` SHA-256:
`f9b974177d0f771eef23ffbd5321e6a3db3c9d0633cc499076d6edaa9a8bbb17`.
Report `coverage/action-verifier/coverage-final.json` SHA-256:
`d280f933db624870e625ec616205a48220eb85878168613d5b2e92e0a4d41cd0`.
This maintained run includes the corrected outer test/hook budgets. The senior
critic approved the source, tests, ownership and CI supervision after that fix.

The complete isolated package gate also passed, including actual browser
counter/chat/disconnect/reconnect, runtime and refresh coverage, source-free
starters, documentation consumers and both compiled action modes. It installed
the published `redweb-client@0.2.0` and verified its bundle identities rather than
resolving the local client link. Package archive SHA-256:
`9db8d0320c5613c144ad91e7607385f54fa9dbdb7c51ae111e4935a730af3698`.
Retained browser evidence:
`coverage/packed-browser/0877c282-b38a-4473-8b12-8348f7503c11`.
This identifies the tested archive before subsequent evidence-only documentation
edits, not a published package. The full regression run remains in progress.

No whole-repository coverage, runtime performance improvement, publication or
release approval is claimed. The historical throughput benchmark remains open.
