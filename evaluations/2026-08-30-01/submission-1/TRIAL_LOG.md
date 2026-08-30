# Redweb adoption trial — self-reported telemetry

Start: 2026-08-30T02:40:46.0451220-04:00 (America/Toronto).
End (implementation and verification): 2026-08-30T02:44:18.6149229-04:00 (America/Toronto).
Elapsed implementation/verification: approximately 3 minutes 33 seconds. Log finalized immediately afterward.

## Scope

Independent implementation in the assigned directory only. Candidate archive: `../artifacts/redweb-0.12.0.tgz` (unreleased candidate despite 0.12.0 metadata). No host implementation/tests or candidate implementation JS/src inspected. No deployment, publishing, or agents created.

## Documentation consulted

- Candidate `README.md`: installation, decorator authoring, TSX, reactive state, start/listener options.
- Candidate `examples/live-html/chatroom.tsx`: room service, per-visitor state, lifecycle presence, stable composer, escaped message rendering.
- Candidate `recipes/chat/README.md`, `app.tsx`, `app.test.cjs`: chat model, launcher and public real-network example.
- Candidate `docs/LIVE_HTML.md`: TSX reconciliation, forms, lifecycle, heartbeat, startup and shutdown. Initial combined output was truncated; forms/lifecycle were read again in focused ranges.
- Candidate public `index.d.ts`: searched for listener, lifecycle and Live HTML option signatures.
- Only public candidate `.d.ts` filenames were enumerated; no implementation sources were read.

## Commands and outcomes

1. `Get-Date -Format o`, `Get-ChildItem -Force`, `Get-Content <candidate README>`: start timestamp captured; assigned directory initially empty; README read.
2. `Get-Content <chatroom.tsx>`, `<recipes/chat/README.md>`, `<docs/LIVE_HTML.md>`: documentation read; combined output truncated, subsequently focused on relevant sections.
3. `rg --files <recipes/chat>`, `rg --files -g '*.d.ts' <candidate>`, focused `Get-Content ... | Select-Object ...`, `node --version`, `npm --version`: public files located; Node v22.21.0, npm 11.6.2.
4. Read chat recipe app/test and lifecycle docs; searched public declarations. No application build/test failures yet.
5. Created package configuration, TypeScript configuration, app and this log with patch edits. Chose server room + connection-scoped decorated pages; broadcasts use assignment-driven state; message rendering uses escaped TSX text; heartbeat set to 1s interval/1s timeout.
6. `$env:NODE_OPTIONS='--use-system-ca'; npm install --save-exact 'C:\Users\arkam\AppData\Local\Temp\framework-adoption-4makom\artifacts\redweb-0.12.0.tgz'; npm install --save-dev --save-exact typescript @types/node playwright`: success. Candidate archive installed; both npm audits reported zero vulnerabilities. TLS verification was not disabled.
7. `$env:NODE_OPTIONS='--use-system-ca'; $env:PLAYWRIGHT_BROWSERS_PATH='C:\Users\arkam\AppData\Local\Temp\framework-adoption-4makom\assigned\.browsers'; npx playwright install chromium; npm run build`: success. Browser binaries installed under the assigned directory. First TypeScript build succeeded and emitted `dist/app.js`.
8. Added `test/app.test.cjs` and `README.md` with patch edits. Test uses Node's actual child process, HTTP fetch and real Chromium pages/WebSockets, without mocks. It launches compiled `dist/app.js` with PORT=0 and checks JSON URL, HTTP response, initial zero, two named visitors, message sender/text, literal hostile-looking markup, bidirectional counter updates, preservation of an unsent draft through join/message/counter updates, fresh-page history/count, and tab-close presence.
9. `npm test`: success on first attempt. One test passed, zero failed, 1,717ms test duration (1,985ms runner duration). Browser WebSocket observations: two sockets, six sent frames, 21 received frames. Bob's disappearance after tab close was observed in 21ms. No browser page errors observed. Browser and server were shut down in the test's finally block; child exit was awaited.
10. `Get-Date -Format o; npm ls --depth=0; Get-Item dist/app.js; Get-CimInstance Win32_Process | Where-Object ... | Select-Object ProcessId, Name, CommandLine`: captured end timestamp, confirmed output artifact (12,062 bytes), dependency versions, and no matching assigned-directory Node/Chromium/headless-shell processes. Dependencies: Redweb candidate 0.12.0, TypeScript 7.0.2, @types/node 26.4.0, Playwright 1.62.1.
11. Finalized this log using a patch edit. No application edits or additional trial attempts followed the passing test. No process intentionally remains running.

## Failures and repairs

No local install, build or test failures occurred. The sole tooling issue was truncation of a combined documentation read; the relevant form/lifecycle sections were reread with focused ranges. No implementation repair was needed before first submission.

## First submission

App directory: `C:\Users\arkam\AppData\Local\Temp\framework-adoption-4makom\assigned`.
Build: `npm run build`. Actual-network test: `npm test`.
Launch in PowerShell: `$env:PORT='0'; node dist/app.js`.
The app binds `127.0.0.1` explicitly. No custom browser code or separate client build is used; Redweb carries all actions and updates over its actual WebSocket runtime.
Self-reported checks are not independent evaluator evidence. Submission is frozen after reporting unless a numbered repair request is received.

## Limitations

In-memory, single-process room; most recent 100 messages, 2,000 characters per message, 40-character display names. Display names are not authentication and duplicate names are permitted. No account identity, durability, or distributed operation.
