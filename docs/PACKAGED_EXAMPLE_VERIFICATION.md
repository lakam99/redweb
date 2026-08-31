# Packaged-example verification

The installed-example probe now bounds listening, upgrade and action waits,
owns its socket immediately, and attempts socket closure and application shutdown
independently. Malformed responses, premature closes, send errors and timeouts
fail the action with their cause preserved. All action listeners and its timer
are removed on settlement. Success is printed only after confirmed cleanup.
The counter's development-route 404 body is consumed as well.

This changes verification tooling, not Redweb's public API or application runtime.
The original acceptance assertions remain: a production-only counter without
TypeScript or Zod; chat after explicit application Zod installation; actual chat
join, sanitized inspection, development revision/JS/CSS resources; exact emitted
client bytes; and generated page/component/socket-route compilation and tests.

## Isolation and ownership

The verifier copies the existing realtime harness, error normalizer and frozen
network helper unchanged, alongside the guarded action helper, into a child
support directory. Its WebSocket dependency is resolved from the installed
Redweb package and linked only after checking its real path stays inside this
consumer. The probe additionally checks transport identity. No repository
dependency is substituted into the package, and the support directory is not
an ancestor of the probe: it cannot satisfy the probe's absent-TypeScript/Zod
checks. Each install refreshes the owned transport link; a replaced regular
file is rejected, not deleted. Client identity is checked before and after
the complete consumer flow.

Commands reject truncated output. Each probe has a 90-second parent deadline;
other install/compiler/generated-test commands retain 120 seconds. The existing
workspace owner supervises processes and removes only its disposable consumer.

## Evidence

`npm run verify:package:examples:coverage` passed **40 tests / five suites** in
25.259 seconds on Windows / Node 22.21.0. The three-script original-source scope
is 100%: 178 statements, 44 branches, 20 functions and 150 lines.

Explicit unit fault boundaries cover action protocol/timing, coordinator cleanup,
preflight and installed dependency resolution/link tampering. The copied entrypoint
is evaluated unchanged with original-source Istanbul instrumentation. Its private
VM map joins the report only when that file is explicitly selected by the maintained
coverage command; it does not enlarge the ordinary library denominator.

No-mock integration uses actual WebSocket peers for success, unrelated frames,
malformed data, incorrect results, close and silent timeout. A separate installed
consumer packs the current source, runs real npm installs, HTTP/WebSockets and
development resources, then compiles and executes all three generated additions.
The first local installation timed out after certificate-chain verification failed;
it cleaned up and was not counted as passing. Using Node's supported
`--use-system-ca` option succeeded without disabling TLS verification.

The senior critic identified two test defects: cleanup could skip server closure,
and VM coverage could pollute the library denominator. Both were corrected before
the maintained successful run. CI retains the scoped report for 30 days and
allows 30 minutes for all bounded install/verification phases.

Source SHA-256 identities:

- `scripts/lib/example-dependency-probe.cjs`: `3a2b575129544e5497f44fd5e0f0ab574bc4da13ed560219b0f8f1d830b49547`
- `scripts/lib/performProbeAction.js`: `21dbbe345657b528b62464bb6e4ffef0f4ac8fe7be46a0fa3e7805c5ee67fd98`
- `scripts/lib/verify-example-dependencies.js`: `fd99d93475fcfbf228564b49bf8fd771e76f9f71bc0faa2f26d2b19d8c6fbbab`

Report `coverage/example-dependency-tools/coverage-final.json` SHA-256:
`51729c6f8604ad0a0b1f4e5c3d71688b75f833d3cb6b78155c7dc769cdc14c17`.

This is not whole-repository 100%, a new one-hour soak, a benchmark waiver or a
release approval. The full package/regression/hosted outcomes are recorded
separately as they complete. No publication, deployment or merge is implied.

The full `verify:live-html:package` gate also passed: isolated registry client
0.2.0, actual counter/chat/reconnect/disconnect browser acceptance, all-four 100%
emitted runtime and refresh browser coverage, every packaged starter, compiled
documentation/action/room examples, generated additions and static/JSX export.
The checked archive SHA-256 was
`739567465bb18a3bf3df9771c84b57f56f503769527ed9c90d96c59a76cd97c1`;
its retained browser report is
`coverage/packed-browser/f91d60fd-dffd-4c6e-806f-c8615ecc687c/`.
That archive preceded this explanatory document; it is runtime/tool behavior
evidence, not a byte identity claim about a later documentation-bearing tarball.
