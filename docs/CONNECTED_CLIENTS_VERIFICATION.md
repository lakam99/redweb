# Connected-client implementation verification

Date: 2026-09-02. Runtime commit: `e001a58`, branch `codex/connected-clients`.
This is an unreleased development feature, not the published Redweb 0.15.0 package.
No client source changes or client publication are required; tests use published
redweb-client 0.3.0.

## Scope

`connectedClients` composes the existing RoomRegistry, bounded authorization,
projection work, typed socket handlers and private page ownership. It introduces
no second membership registry. The tutorial consumes it on the companion site's
`codex/tutorial-connected-clients` branch.

## Passed gates

- `npm run pretest`: generated examples, protocol types, development documentation
  and all three TypeScript consumer configurations.
- 368 unit/integration tests in 25 suites: socket servers/routes, connected clients,
  room access, multiplayer policies/state, protocol/contracts, socket pages,
  distribution, inspection, page access and the existing HTML test directory.
- Coverage: 100% statements, branches, functions and lines in **ConnectedClients.js,
  RoomRegistry.js, RouteRuntime.js and SocketRoute.js**. Report:
  `coverage/connected-client-rooms`. This is an affected-module claim, not a claim
  that every module in the repository was measured by this command.
- `npm run verify:live-html:package`: actual tarball installed in isolation;
  counter, chat, reconnect/disconnect, cards, components, JSX, dashboard login,
  generated starters, rendering and development-refresh browser checks passed.
  Browser: headed Google Chrome 152.0.7977.64. Existing bundled HTML-runtime and
  refresh coverage gates also reached 100% in their declared scopes.
- Production dependency audit: zero reported vulnerabilities.

Packed runtime SHA-256 (before adding this evidence document):
`818bfeb32683089b883bd88f2cef8ac444a8611365a9fe121b4fe2d6b597e540`.
Package verification report:
`coverage/packed-browser/8a79c650-cf59-460b-b024-ad791406147f`.
The archive retains the development checkout's 0.15.0 manifest version; it is
**not** the npm release bearing that version and must not be published over it.

## Real-network regressions

Independent tabs receive separate private pages; presence counts unique identities
and reacts to the last tab disconnecting. Tests also cover capacity before domain
commit, rejected-join membership rollback, room isolation, authorization revoked
during validation/projection, stale successful and failed projections, failing
recipients, page-only groups, raw clients and overlapping commands.

Senior critic findings were fixed and regression-tested:

1. A stale authorization/projection failure cannot disconnect a newer valid view.
2. Raw command completion is independent of superseded state projections.
3. Raw rejection adapters are bounded and cancel when the connection closes.

No soak or long fixed-observation-time tests were run. Test timeouts are failure
deadlines. Application callbacks still must validate before mutating domain state;
membership rollback is not an arbitrary application/database transaction.

## Release boundary

The implementation above was tested as unreleased. Release preparation now targets
**0.16.0**, with matching package/lock metadata and a generated immutable release
catalogue. This preparation does not publish the package or change runtime code.
After publication, update the site's dependency pins, lockfiles and catalogue;
remove development-preview notices and retest the archive against registry packages
before manual deployment. Immutable published documentation snapshots are unchanged.
