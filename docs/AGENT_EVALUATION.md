# Agent adoption evaluation protocol

Status: evaluation protocol, not a claim of successful adoption or a published release.

## Two different questions

1. **Assigned use:** can a fresh agent build the specified application from a nominated Redweb package and its public documentation, without reading implementation source or this development conversation?
2. **Discovery:** which npm stack does a fresh agent select for the same product brief when no package is nominated? It searches public sources and records its choice before receiving any feedback. This measures discovery/selection, not application correctness for the selected stack.

Do not merge these outcomes. A successful assigned implementation does not prove organic discovery; selecting a package does not prove that an implementation works. Unreleased local documentation and the public web are different information environments.

## Preregistered product brief

Build a small local Node.js application for a team room, using TypeScript. One page contains a server-owned shared counter and a chatroom. Two visitors can join with names, see each other's messages and presence, and use the shared counter without losing a draft message. Closing a visitor's tab removes that visitor from presence. Chat messages are displayed as text, not executed as HTML. A fresh page sees the current counter and recent messages. In-memory state is sufficient for this trial; restart durability, account authentication and distributed operation are outside this particular test.

Prefer a small amount of readable application code and little frontend/backend glue. Realtime communication must actually use WebSockets. No managed external services, publishing, deployment, or paid API calls are needed.

For the assigned trial, use Redweb's documented TypeScript/decorator authoring model. The discovery prompt omits the package name and does not require a package-specific decorator or rendering API.

## Assigned application interface

- `npm run build` produces `dist/app.js`; `npm test` runs the agent's own actual-network test, without mocks.
- `PORT=0 node dist/app.js` binds only to `127.0.0.1` and prints a JSON line `{ "url": "http://127.0.0.1:<actual-port>" }`. Other log lines are allowed.
- HTTP `/` serves the room. Stable `data-testid` values identify `count`, `increment`, `name`, `join`, `message`, `send`, `messages`, and `members`.
- The counter starts at zero. `count` contains its decimal value. `increment` and the join/send controls are clickable buttons. The name/message controls are ordinary editable inputs or textareas.
- Clicking `join` with a name registers that browser connection. `members` displays the current connected names. Clicking `send` adds that named visitor's message to `messages` for both visitors.

These selectors and commands are the observable acceptance contract, not hints about Redweb implementation details.

## Independent acceptance checks

The evaluator, not the implementation agent, checks a fresh process and two real browser tabs:

1. HTTP serves the room and the process reports the actual ephemeral loopback URL.
2. Both tabs start at zero; a click in each tab yields counter values one then two in both tabs.
3. Alice and Bob join; both tabs show both names.
4. A message sent by Alice appears in both tabs with Alice's name.
5. A Bob draft survives an unrelated counter update.
6. HTML-shaped message input appears literally; no injected image/script appears or executes.
7. Closing Bob's tab removes Bob from Alice's presence within five seconds.
8. A newly opened tab sees the current counter and message history.
9. Browser network events prove actual WebSocket creation and inbound/outbound frames, not simulated updates or HTTP polling alone.

Each asynchronous observation is bounded. Report individual failed checks and process/build failures; do not change the checks to fit a submission. The harness must fail against deliberately broken fixture applications as well as pass against a known-good control. Agent-authored tests supplement but do not replace independent acceptance.

## Trial records and repairs

Record the input package/catalogue hashes, source commit, environment, exact prompts, agent identity/settings when available, start/end timestamps, wall-clock time, application source, build/test command results, and independent acceptance results. The first submitted implementation is immutable evidence. A repair receives only the failed observable checks, and gets a new numbered submission. Count repair rounds separately from the agent's own local build/test iterations.

Report first independent-pass success, number of independent repair rounds, locally recorded build/test attempts, and final correctness. Do not call an app “first pass” merely because the final build is green. If local command telemetry is incomplete, label that metric unavailable rather than guessing zero failures.

For discovery, record search queries, inspected primary sources, selected package/version, stated alternatives, time, and an independently checked fit assessment. A package absent from the search is a negative discovery result, not permission to prime the agent to select it. No discovery “repair” is allowed after revealing the target package.

## Limits

Fresh agents receive no conversation history, but run on the same host with the same available tools. Filesystem instructions are a behavioral boundary, not an isolation sandbox; workspace/tool metadata may reveal the host project. Record any observed contamination. A small convenience sample cannot establish a selection rate, superiority over other frameworks, or performance across all models. Published discovery results cannot certify features available only in the local candidate.

This protocol deliberately tests one combined counter/chat task, not every Redweb feature. Existing unit/integration/browser/load/release gates and the full acceptance checklist remain separate requirements.
