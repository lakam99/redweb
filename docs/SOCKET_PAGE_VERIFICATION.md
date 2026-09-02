# Socket-bound TSX verification

Development verification on 2026-09-02, Windows, Node 22.21.0, headed Chrome 152.
This records feature acceptance, not an npm release or full-repository certification.

## Implementation and review

Core/client branch: `codex/socket-page-actions`. Site branch:
`codex/server-tsx-tutorial` in the sibling landing-page checkout.

- Typed handler references and `.with(payload)` reuse contract validation, page
  ownership, reactive rendering and the existing redweb-client runtime.
- The tutorial has no application browser module or bundling step. Its private
  page, game rules, commands, room fan-out and seat recovery live on the server.
- Independent critic reviews covered core/client and the actual tutorial. Fixed
  findings included attachment ordering, post-validation disconnect authorization,
  duplicate-connection policy, intermediate reply correlation, obsolete render
  cancellation and rejected forms incorrectly reporting success. Final review
  reported no remaining blocking findings within that scope.

## Passing gates

- 294 tests / 27 suites passed in the rendering regression selection below.
  Every module in `src/htmx/*.js`, plus `BaseHandler`, `SocketContract`,
  `SocketAction` and `HandlerGuard`, reached 100% statements, branches, functions
  and lines. The changed explicit-false dispatch in `SocketRoute` is exercised by
  real-network tests; this measurement does not claim all of `SocketRoute` or the
  whole repository is covered by this selection.
- Client `npm test` passed linkage, build, declarations and the combined original
  source gate: 800 statements, 543 branches, 125 functions and 667 lines, all 100%.
  Report: `coverage/client-source/c819157b-6aaa-4020-99f4-152b8df473ed/summary.json`.
  It runs plain and instrumented Node tests and headed Chrome on real HTTP/WS.
  The existing instrumentation does not count every optional-chain/V8 branch.
- Core pretest checked canonical example output, protocol declarations, all
  TypeScript configurations and 69 generated unreleased documentation pages.
  The standalone contract entry also bundled for browsers without Node builtins.
- Site build and real HTTP verification passed: 438 pages, 11 examples, 30 API
  articles, downloads and internal links. The seven-module documentation coverage
  scope remains 100% lines, branches and functions.
- The actual tutorial archive was extracted to a fresh temporary directory,
  installed with both explicitly packed development candidates (no links),
  compiled, typechecked and tested with real HTTP, WebSockets and SQLite. Its
  game-rule and message-schema modules remain all-four 100%; this is not a
  whole-tutorial/authentication coverage claim.
- Headed Chrome passed both linked and extracted-package tutorial acceptance:
  hello world, two-tab server counter, wrong/right login, two-player game,
  third-player full-room rejection with retained input and reusable connection,
  reconnect without move replay, disconnect presence, win and logout. Actual
  outgoing game connections use `/match`; game commands are `join` and `move`.
- Headed static-site navigation passed both minimal homepage examples, six
  highlighted chapters, next links and the project download.

New integration tests use actual transports, not mocks. Pure failure-boundary
units supplement them. No soak or long fixed-window workload was run.

### Reproduce the scoped core coverage gate

```sh
node node_modules/jest/bin/jest.js tests/htmx tests/ws tests/unit/socket-action.unit.test.js tests/unit/page-access.unit.test.js tests/unit/socket-contract.unit.test.js tests/unit/utilities.unit.test.js tests/unit/action-input.unit.test.js tests/unit/inspection.unit.test.js tests/unit/development-refresh.unit.test.js tests/unit/development-refresh-boundaries.unit.test.js tests/unit/development-refresh-cleanup.unit.test.js tests/unit/define-app.unit.test.js tests/integration/define-app.integration.test.js tests/integration/socket-page.integration.test.js tests/integration/socket-contract.integration.test.js tests/integration/live-html.integration.test.js tests/integration/page-access.integration.test.js tests/integration/action-input.integration.test.js tests/integration/inspection.integration.test.js --runInBand --silent --coverage --collectCoverageFrom=src/htmx/*.js --collectCoverageFrom=src/ws/BaseHandler.js --collectCoverageFrom=src/ws/SocketContract.js --collectCoverageFrom=src/ws/SocketAction.js --collectCoverageFrom=src/ws/HandlerGuard.js --coverageDirectory=coverage/socket-page-regression
```

The site README documents the two candidate-tarball environment variables for
`npm test`. That gate includes headed browser acceptance inside the extracted
archive; Chrome and the tutorial's Node version are required.

## Release boundaries and outstanding dependency audit

The follow-up [release preparation](SOCKET_PAGE_RELEASE_PREPARATION.md) prepares
client 0.3.0 and records the tested application-root qs mitigation. The initial
observations below remain historical; they do not override that later status.

The old published versions (Redweb 0.14.0/client 0.2.0) do not contain these APIs.
Local tarballs retaining those development metadata versions were verification
inputs, not artifacts to publish over existing releases. Release a new client,
align and release Redweb, then update the site's tutorial pins/lockfile and
catalogue before manual deployment. Existing immutable release snapshots were
not rewritten. Nothing was published or deployed during this task.

An additional `npm audit --omit=dev` check reports four moderate dependency-tree
entries in the existing site/tutorial locks, rooted in two `qs` advisories:
[bracket-key parsing](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) and
[attacker-controlled isBuffer](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g).
The installed Express 4 dependency range does not select the published qs 6.16.0
fix. This feature work does not waive that audit or silently force an Express 5
migration. Resolve and verify the dependency policy before production release.
