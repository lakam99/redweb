# Developer and agent experience release: acceptance checklist

This is the full implementation checklist for the requested improvements. Unchecked items are not release-complete; green coverage alone is not evidence for them.

## Discovery and honest positioning

- [x] Package repository, homepage, issue tracker, and meaningful search keywords.
- [ ] README leads with the current integrated site/socket workflow, a runnable example, fit/non-fit guidance, and no stale release-specific introduction.
- [ ] Website presents the same supported capabilities and release version.

## Complete starters and repair loop

- [x] `redweb init` offers realtime, chat, site, and socket templates with no undefined application placeholders.
- [x] Existing-project initialization does not generate a second application or overwrite user files; conflicts are reported honestly.
- [x] Explicit noninteractive options, dry-run, machine-readable output, actionable errors, and safe filesystem handling.
- [x] One development command rebuilds/restarts on changes, one test command verifies behavior, and production startup is documented.
- [ ] `redweb doctor --json` inspects effective JSX configuration, package/tool versions, assets, duplicate routes/handlers, and an optional port without executing user application code or silently repairing it.

## Automatic reactive rendering

- [ ] Ordinary TSX expressions over decorated state update automatically, including derived expressions and conditionals.
- [ ] Owner-scoped component/page boundaries; batched changes; unchanged HTML sends no patch.
- [ ] Stable keyed list updates preserve appropriate DOM identity, input state, and focus.
- [ ] Reconnection snapshots, connection/shared state isolation, nested components, cancellation, bounded work, and disposal remain correct.
- [ ] Existing explicit bindings remain usable without duplicate/conflicting updates.
- [ ] Counter and multi-client chat pass real browser + HTTP/WebSocket tests using the simpler public syntax.

## Shared socket contracts

- [ ] One contract defines payload validation and inferred client/server types.
- [ ] `/match` routing and join/move/resume handler dispatch stay separate, without socket decorators or a secondary action dispatcher.
- [ ] Invalid payloads never enter handlers; errors are stable; existing uncontracted routes still work.
- [ ] Type-negative tests and real-network positive/negative protocol tests cover the public contract API.

## Documentation and executable recipes

- [ ] Plain Markdown per topic, compact `llms.txt`, versioned release docs, task-oriented recipes, and clear prerequisites/filenames/commands/results.
- [ ] Human pages, agent docs, and code snippets derive from one maintained recipe/content source.
- [ ] Recipes compile against a packed npm release and pass real HTTP/WebSocket acceptance tests.
- [ ] Read-only documentation access can be exposed through an optional MCP adapter without enlarging the normal runtime or claiming automatic agent selection.

## Trust and release verification

- [ ] Reproducible reconnect, disconnect, slow-client, memory, isolation, authentication, and compatibility evidence, with limits and environment recorded.
- [ ] Fresh-agent tasks using only public documentation measure first-pass success and repair effort against objective application checks.
- [ ] Full 100% statement/branch/function/line coverage, type gates, real-network/browser tests, load/recovery/memory gates, package checks, and audit.
- [ ] README, changelog, examples, website, and evidence agree on shipped behavior; final requirement-by-requirement audit proves every checkbox.

## Work log

- Baseline: `6c95093` (0.12.0 initializer), 336 tests and 100% instrumented-source coverage from the preceding release. These are historical results, not evidence for this release.
- Current implementation branch: `codex/agent-ready`.
- First increment: discovery metadata; existing-project/dry-run/JSON initialization; preflight filesystem safety; read-only doctor checks for installed dependencies, effective JSX configuration, Node/CLI versions, and optional TCP ports. Source-level doctor checks and all remaining release items are still pending. `tests/unit/cli-tools.unit.test.js` and `tests/integration/init-cli.integration.test.js` exercise real files, compiler configuration, CLI subprocesses, and sockets.
- First-increment verification: 361 tests across 24 suites; 100% statements, branches, functions, and lines; full type/pretest gates. Packed CLI initialization, consumer compilation, doctor, and rendering are checked by `npm run verify:live-html:package`. This is increment evidence only: it does not satisfy the remaining reactive-rendering, recipe, contract, browser, or release-performance requirements.
- Starter increment (2026-08-29, Windows, Node 22.21.0): four selectable recipes, default shared counter, canonical chat component reuse, common scaffold/config/test helpers, development-only Nodemon watcher, and production CSS/HTML copying. The watcher integration test runs the actual generated `npm run dev`, edits TSX and CSS, observes rebuilt HTTP responses, introduces a type error, and verifies recovery after repair. No additional watcher implementation was added to the library runtime.
- Starter verification: `npm test -- --runInBand --silent` passed 372 tests in 26 suites with 100% instrumented-library statements/branches/functions/lines and all existing type/pretest gates. `npm run verify:live-html:package` extracted the tarball and ran every generated `npm test` (real HTTP/WebSockets), then reran the network tests with `src/` unavailable. These cover two-client counter updates, chat messages/escaping/disconnect presence, static pages/CSS/404s, and socket dispatch/invalid payloads. They are not a claim of 100% generated-example coverage or a substitute for the pending full browser/release gates.
- Audit: zero reported vulnerabilities with Node's `--use-system-ca` option. The initial audit failed certificate validation against this machine's trust setup; verification was retained using the Windows trust store, not disabled.
