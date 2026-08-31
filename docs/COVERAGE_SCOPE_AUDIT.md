# Coverage scope and remaining work

This inventory separates shipped authored code from verification machinery.
Passing behavior tests do not establish complete coverage; a coverage report's
instrumentation hash alone does not prove correspondence with current source.
No aggregate whole-repository 100% claim is made. This does not waive the open
coverage requirement in `AGENT_READY_ACCEPTANCE.md`.

## Established scopes

- Library: all 91 files in the configured root-entrypoint / `src/**/*.js` scope,
  5,445 statements, 4,044 branches, 978 functions and 4,464 lines, all 100%.
  Latest full local evidence: 918 tests/86 suites at `15c5a4e`.
- Shipped `bin/redweb.js`: separate real-subprocess CLI gate, all four 100%.
- Six starter applications and shared `run-app.ts`: original-TypeScript gate,
  104 tests per mode, 600 statements, 299 branches, 160 functions and 472 lines,
  all 100%. Includes the canonical chatroom component.
- Client authored source: 791 statements, 521 branches, 125 functions and 659
  lines at 100%, with 77 tests per mode plus native browser acceptance. Published
  client 0.2.0 runtime bundles match the tested build.
- Emitted frontend and development refresh: separate native-browser gates,
  all-four 100%; not inferred from coverage of strings that generate scripts.
- Site documentation: seven declared modules at 100% line/branch/function
  coverage, six tests and real HTTP/build checks; not whole-site coverage.
- Server recovery policy/coordinator/CLI: maintained CI coverage command,
  76 tests/five suites, 132 statements, 25 branches, 25 functions and 120 lines,
  all 100%. See `SERVER_RECOVERY_CANDIDATE.md` for exact report identity.
- Shipped `recipes/shared/copy-assets.cjs`: `npm run verify:assets:coverage`
  now measures the original source under c8 through actual subprocess/filesystem
  tests and requires all-four 100% in CI. Nested CSS/HTML copying, excluded source
  files, existing compiled-code preservation, stylesheet replacement and a missing
  source failure are checked without mocks. This closes one of the initial eight
  shipped-source gaps; seven remain below.

Asset-copier evidence (Windows/Node 22.21.0): two integration tests pass; all eight
statements/lines, three branches and one function are covered. Original source
SHA-256: `5e340377eec8a59b64e0dc0d5791de0826dec8b82d40c3502b67eda6f7aaefee`.
Report `coverage/recipe-assets/coverage-final.json` SHA-256:
`bc857afaed89d95aea1bfa448641f5ac2433467e8eed75afbeec99d2ad12c280`.

The subsequent complete local regression at `db9e469` passed 925 tests/88 suites
in 455.485 seconds with all-four 100% library coverage; report SHA-256:
`38aec4ec3b394f15fa96bfc11d87683a1da83ff9c0fd37f8b21a7a47815e0cab`.
Both [PR CI](https://github.com/lakam99/redweb/actions/runs/33354236822) and
[push CI](https://github.com/lakam99/redweb/actions/runs/33354234299) passed all
Node 18/20/22/24 and lifecycle jobs. The asset-copier tests above were added after
that full run and passed separately; they are not retroactively included in 925.

The exact historical package/client/browser/starter identities and mock boundaries
remain in `CLIENT_POLISH_VERIFICATION.md`, `POLISH_RELEASE_CHECKPOINT.md` and the
acceptance work log. Integration uses actual networking, processes, files and
browsers. Explicit unit fault injection is not called mock-free integration.

## First priority: remaining shipped authored sources

Behavioral tests exist, but the reviewed reports do not yet establish an explicit
complete authored-source denominator for these files:

```text
examples/live-html/cards.ts
examples/live-html/components.ts
examples/live-html/counter.ts
examples/live-html/jsx-page.tsx
docs/snippets/room-access.tsx
recipes/add/live.tsx
recipes/add/socket-route.ts
```

Generated example `.js` files are compiled derivatives of their maintained
TypeScript, not independent authored implementations. Their compilation and
runtime behavior still require verification. The next coverage increment should
reuse the existing original-source collector rather than inventing another one.

## Private tools with existing complete scoped reports

These report directories contain all-four 100% maps for the listed files.
They are separate measurements, not a merged coverage total. Report-to-source
correspondence must be retained from the relevant recorded input/checkpoint before
using an old report to certify new edits.

| Report under `coverage/` | Files (under `scripts/`) |
| --- | --- |
| `package-tools` | `lib/ClientCandidate.js`, `lib/InstalledClient.js`, `lib/PackedBrowserHarness.js`, `lib/preservePackedBrowserReport.js`, `lib/VerificationWorkspace.js`, `lib/verificationError.js`, `lib/compile-consumer.js`, `lib/verify-documentation.js`, `lib/verify-starter.js` |
| `server-recovery-acceptance` | `lib/ServerRecoveryCandidate.js`, `lib/ServerRecoveryPolicy.js`, `verify-server-recovery.js` |
| `browser-collector` | `lib/BrowserCoverage.js` |
| `application-collector` | `lib/ApplicationCoverage.js` |
| `client-check-preflight` | `lib/ClientSourceCoverage.js`, `lib/reportCommand.js` |
| `compatibility-capture-runtime` | `diagnostics/ClientHeapCapture.cjs` |
| `code-attribution-native` | `diagnostics/CodeAttribution.cjs`, `diagnostics/HeapCodeComparison.cjs`, `diagnostics/HeapSnapshotGraph.cjs`, `diagnostics/recovery-heap-graph.cjs`, `diagnostics/recovery-heap-summary.cjs` |
| `recovery-deopt-native-final` | `diagnostics/DeoptimizationCensus.cjs`, `diagnostics/recovery-code-summary.cjs` |

The independent critic confirmed the five attribution/graph files are unchanged
since reviewed checkpoint `8a15569`, the two deoptimization parsers since
`8b4694c`, and capture since `daacdac`. Do not substitute the older
`client-source-collector` report for expanded checkout validation or the older
`recovery-native-exact` map for the later shared-graph extraction.

## Remaining private-tool measurement gaps

Only partial historical maps were found for these files; they changed after some
reports, so historical percentages do not certify current coverage:

```text
scripts/diagnostics/recovery-split.cjs
scripts/diagnostics/recovery-split-worker.cjs
scripts/verify-recovery.js
```

No direct coverage map was found for these active verification/build files:

```text
scripts/benchmark-worker.js
scripts/build-live-html-examples.js
scripts/generate-docs.js
scripts/generate-protocol-types.js
scripts/measure-starter-coverage.js
scripts/memory-worker.js
scripts/realtime-harness.js
scripts/verify-browser-coverage.js
scripts/verify-client-source-coverage.js
scripts/verify-development-refresh-browser.js
scripts/verify-disabled-overhead.js
scripts/verify-jsx-performance.js
scripts/verify-live-html-browser.js
scripts/verify-live-html-load.js
scripts/verify-live-html-package.js
scripts/verify-load.js
scripts/verify-memory-overhead.js
scripts/verify-soak.js
scripts/verify-starter-lifecycle.js
scripts/verify-starter-source-coverage.js
scripts/lib/example-dependency-probe.cjs
scripts/lib/record-application-coverage.cjs
scripts/lib/verify-action-feedback.js
scripts/lib/verify-action-input.js
scripts/lib/verify-dashboard-browser.js
scripts/lib/verify-example-dependencies.js
scripts/lib/verify-live-page-ownership.js
scripts/lib/verify-packed-browser.js
scripts/lib/verify-refresh-controls.js
scripts/lib/verify-refresh-coverage.js
scripts/lib/verify-room-example.js
scripts/lib/verify-runtime-browser.js
```

Frozen evaluation tooling also lacks a complete direct map in the reviewed set:

```text
scripts/evaluation/prepare.js
scripts/evaluation/process.js
scripts/evaluation/run-trial.js
scripts/evaluation/seal.js
scripts/evaluation/validate.js
scripts/evaluation/verify.js
```

Keep frozen source/evidence unchanged. The evaluation fixture, recipe tests,
shared test networking, repository tests/helpers and fixtures are test
infrastructure, not silently part of the library denominator. The client’s
standalone Node-only V8 diagnostic remains a separate known failure; original
authored-source and browser coverage do not relabel it passing. Coverage work
does not require restarting the deferred scientific runtime investigation.
