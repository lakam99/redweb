# Counter/chat agent case study — 2026-08-30

## Outcome

One fresh-context agent produced an implementation of the specified counter/chat task using the nominated **unreleased** Redweb archive and its public documentation, recipes, examples and declarations. Its frozen first submission passed every independent acceptance check with **zero independent repair rounds**. This is one task and one implementation, not a success rate, production certification, framework comparison or guarantee of agent preference.

A separate unnominated agent chose **Socket.IO + Express with a native-DOM TypeScript client** from its own shortlist of Socket.IO, ws and LiveViewJS. Its searches were package-directed and its environment revealed the Redweb host-directory name. That is a recorded selection result, **not a blinded or broad category-search discoverability test**. No application was built for that choice, so its estimated code sizes cannot be compared with measured Redweb source size or correctness.

## Evidence and timing

| Evidence | Recorded result |
| --- | --- |
| Behavioral protocol | `protocol.md`, originally committed at `2624d8b0d03cef8f4b5b902198bbb51257998ea7` before agent dispatch. |
| Candidate | `redweb-candidate.tgz`, SHA-256 `c753ae17463f7d8e17eade6d631534180cc1f632b34e44af04fed562abe9f914`. Version string 0.12.0 does **not** identify the published 0.12.0 artifact. |
| Exact prompts/settings | `assigned-prompt.txt`, `discovery-prompt.txt`, `seal.json`. Fresh context (`fork_turns=none`); exact inherited model/reasoning settings were not captured. |
| First submission | All source/configuration/own test/log bytes in `submission-1/`, copied before independent builds. |
| Checker revision | `04c0ac9e665729066d5cffb5127219729d3b95fc`; exact checker/dependency bytes copied under `checker-snapshot/` and hashed in `seal.json`. Checker implementation was finalized **after** submission, reviewed and control-tested before independent execution. |
| Assigned implementation time | Agent-reported 02:40:46–02:44:18 America/Toronto, approximately 3m33s. This includes implementation/local verification, not evaluator development, waiting or independent execution. |
| Local attempts | Agent reports one successful initial build and one successful own test invocation, with no local build/test repairs. Those are self-reported logs, not independently captured full tool telemetry. |
| Independent run | `independent-submission-1.json`: 2026-08-30 07:03:03.611–07:03:07.277 UTC; 3,666ms for build/application/checks/cleanup, excluding preparation/copy/hash checks. |
| Independent environment | Windows x64, Node 22.21.0, Chrome 152.0.7977.64; actual browser revision and JS version are in the result. Submitted lockfile records TypeScript 7.0.2 and Playwright 1.62.1. |
| Artifact verification | Nominated archive SHA-256, lockfile SHA-512 integrity and all 154 installed package files checked before execution and after the build. Frozen and execution source/configuration bytes matched. |
| Repairs | No feedback or repair request was sent to the implementation agent after first submission. |

## Independent behavior

The evaluator rebuilt a separate temporary execution copy, never the sealed submission, and inspected the actual listener interface (`127.0.0.1`). Three real Chromium instances used separate profiles, ruling out shared browser storage as the counter/chat mechanism. Real input/pointer events exercised two-way counter increments, named presence, message delivery, an unsent draft surviving an unrelated update, literal HTML-shaped text, tab-close presence removal and a fresh visitor's current counter/history.

All ten result checks passed; none were skipped. Three WebSocket handshakes, seven outbound frames and 25 inbound frames were observed. HTTP data requests were blocked after finite startup requests completed, while static assets remained allowed. No persistent bootstrap HTTP data stream remained. This is stronger than merely observing unrelated socket traffic, but is not a hostile-program proof system. Subsequent source review independently confirmed `Room.increment()` owns the counter, `Room.send()` owns history, and decorated actions/state use Redweb without custom browser synchronization code.

The disconnect check completed in 34ms in this local run. That is the whole check's recorded duration, **not** a guarantee for abrupt network loss or production heartbeat latency. Graceful application shutdown hooks were not independently certified by the process-tree cleanup.

## Checker validation and review

`checker-controls-sealed.json` is the final validation of the sealed checker: four actual-browser positive controls (ordinary forms, input-event forms, change-event forms, late-loaded script) pass. Seven negative controls are rejected at the expected checks: local-only counter updates, lost drafts, unsafe HTML rendering, stale presence, HTTP-driven updates despite real sockets, wildcard binding despite a loopback URL, and a bootstrap-opened SSE stream.

Earlier `checker-controls*.json` files are retained as development history, not interchangeable final-checker evidence. The senior critic reviewed the behavioral methodology and checker before source inspection, and approved after input/pointer semantics, HTTP transport isolation, listener inspection, process cleanup and failed-result retention were corrected. Fourteen unit tests use actual subprocesses/files/archives; they include detached-child cleanup on Windows and an exclusive file lock that prevents cleanup while preserving the primary result. The controls use actual HTTP, WebSockets and Chromium, not mocks.

## What the selection result supports

The frozen `DISCOVERY.md` records the agent's exact queries, alternatives, sources, versions and tradeoffs. The evaluator separately inspected Socket.IO's official [TypeScript guide](https://socket.io/docs/v4/typescript/), [client options](https://socket.io/docs/v4/client-options/) and [delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/). Those support the proposed typed event protocol, explicit WebSocket transport choice and need for application-owned validation/retry/state recovery. They establish that the proposed stack is plausible, not that an unbuilt application passes this task or that all reported dependency versions interoperate.

No selection repair or package-specific prompting followed. A future product/category-search trial must be independently preregistered and keep this result intact. A useful next investigation is whether agents encounter Redweb when searching for the problem rather than naming frameworks they already know.

## Product observations, not acceptance failures

The assigned app is a compact server-side room service plus one decorated TSX page. It nevertheless hand-parses the join/send payloads instead of using Redweb's validated action schemas. That suggests an opportunity to make the canonical chat recipe demonstrate the simpler schema workflow more prominently; it does not establish why the agent made that choice. The room recalculates membership for each visitor and may publish on both disconnected and disposed callbacks. This small acceptance case is not scale evidence.

The application is deliberately single-process/in-memory, retains 100 recent messages, accepts duplicate display names and has no account authentication. Those match the brief's limits; they must not be promoted as production guarantees. Broader repository/browser/generated-code coverage, compatibility, publishing provenance, release agreement and remaining developer-experience work stay open in `docs/AGENT_READY_ACCEPTANCE.md`.

## Repository regression checks

The increment passes all pretest/type gates and **580 tests across 48 suites**, retaining **100% instrumented-library statements, branches, functions and lines**. The extracted-package/source-free consumer gate and standalone real-browser gate also pass, including authenticated dashboard forms, private cards, draft preservation, sign-out/re-login, action feedback, CSS, JSX, collections, components, counter/chat and documentation composition. No runtime implementation changed in this checker increment.

Do not confuse that library coverage scope with all repository code. An additional c8 measurement over the six `scripts/evaluation/*.js` files, accumulating the fourteen unit tests and eleven browser controls, reports **69.69% statements/lines, 85.34% branches and 72% functions** (`checker-unit-control-coverage.json`). The separately executed candidate preparation, sealing and independent trial were not part of that instrumented command; uncovered failure/CLI/platform paths also remain. This is an explicit measurement gap and the broader coverage requirement remains open, not waived or relabeled 100%.

Reproduce that scoped measurement with c8's `--all --include=scripts/evaluation/*.js`, first running the two `tests/unit/evaluation-*.unit.test.js` suites through Jest with `--coverage=false`, then running `scripts/evaluation/validate.js` with `--clean=false` and the same c8 temporary/report directories. The ordinary full-suite command remains `npm test -- --runInBand`; control validation is `npm run verify:agents:controls`.

## Preservation and replay

Git attributes preserve every byte under `evaluations/`. Exact checker snapshots retain the original line endings too: a fresh checkout may otherwise normalize helper files and fail the deliberately strict hashes. For replay, use a disposable checkout at the checker revision, restore `checker-snapshot/` to that checkout's root, reconstruct an application workspace from `submission-1/`, place the nominated archive at the lockfile's relative `../artifacts/redweb-0.12.0.tgz`, and install its locked dependencies. The agent's optional own browser test additionally requires its documented Playwright browser installation.

Run the checker against a **new copy** of the evidence directory, without the existing independent result file, so the immutable original result is never overwritten. Strict checker/source/archive verification must pass before building. Browser tests require a real installed Chromium binary and Windows listener inspection. Source preparation is not an adversarial security sandbox. The trial's execution/browser/package-verification temporary directories were cleaned; original agent submissions and downloaded browser binaries remain preserved for follow-up, outside this repository.
