# API example refresh verification

Verified locally on Windows, 2026-09-02, for the 0.16.1 documentation patch.

## Scope

- Reviewed the current 31 API sections and 11 showcase examples. Prefer concise `defineApp`, plain decorated classes and TSX for application examples; retain explicitly labeled lower-level APIs.
- Source reuse keeps the counter, component and multi-page/CSS examples identical between generated documentation and acceptance fixtures.
- No runtime API change. Documentation generation and the executable room example were changed.
- Prior release snapshots, including 0.16.0, remain untouched. The website remains pinned to published 0.16.0 until manual npm publication and subsequent site synchronization.

## Passed checks

- `tests/unit/documentation.unit.test.js` and `tests/unit/api-examples.unit.test.js`: 13 tests; 100% statements, branches, functions and lines for `src/docs/Documentation.js`. All current API/showcase examples parse as TSX; partial API patterns are not claimed to be independently runnable or fully type-checked applications.
- `tests/integration/api-examples.integration.test.js`: six real headed-Chromium scenarios, counter/components/two-page site under both standard and legacy decorators. Exact source is compiled; only a fixture ownership export is appended. Verifies server updates, a second counter tab, component isolation, CSS and navigation without mocks.
- Focused `tests/integration/documentation.integration.test.js` and `tests/unit/room-verifier.unit.test.js` gate (`shared page/room|actual generator|room`): 10 tests passed, two unrelated tests not selected. Includes actual HTTP/WebSocket room authorization and cleanup under both decorator modes.
- `npm run pretest`: generated examples, protocol declarations, documentation freshness and all three consumer type configurations pass.
- `npm run prepublishOnly`: release channel and immutable 0.16.1 snapshot match the package version.
- `npm pack --dry-run --json`: packaging/prepack checks pass.
- Senior critic reviewed modular source reuse, tests and API semantics. Corrected all findings, including both lifecycle prose and option-table distinctions between application and lower-level shutdown budgets.

No soak, fixed-duration observation gate, full runtime suite or deployment was run for this documentation-only patch. Coverage above is scoped to the changed documentation generator, not a new whole-project coverage claim.
