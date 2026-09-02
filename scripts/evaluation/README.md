# Independent application evaluation

This is development verification tooling, not a runtime dependency or a claim of automatic agent adoption. The original behavioral protocol is in `docs/AGENT_EVALUATION.md`; individual evidence directories preserve its exact preregistered copy.

## Workflow

1. `node scripts/evaluation/prepare.js` packs the candidate into a unique temporary workspace. Give fresh agents the recorded, separate assigned-use and unnominated-selection prompts. Do not let them read implementation internals or one another's work.
2. Preserve the first submission's source, configuration, lockfile, own test, and self-reported log under an evidence directory's `submission-1/`. Preserve exact prompts, input manifest, candidate archive, protocol and discovery report beside it. Do this before running evaluator builds; do not include credentials, dependencies, browser binaries or generated output.
3. Run `npm run verify:agents:controls -- <new-result.json>`. Real Chromium visits actual HTTP/WebSocket fixture applications: working, input-event, change-event and late-script controls must pass; local-only counters, draft loss, unsafe HTML, stale presence, HTTP polling, wildcard listeners and bootstrap SSE must fail at their expected checks. No mocked network/browser is used.
4. Review and commit the checker, then run `node scripts/evaluation/seal.js <evidence-directory>`. The immutable seal records protocol/prompt/submission/candidate/checker/dependency hashes and available agent settings. Exact model/settings not captured must remain explicitly unavailable.
5. `node scripts/evaluation/run-trial.js <evidence-directory> <original-agent-application>` verifies hashes and installed candidate bytes, copies frozen source and dependencies into a new execution directory, rebuilds there, checks the actual listening interface, and exercises isolated real browsers. Original and sealed sources are not build workspaces. The immutable `independent-submission-1.json` preserves successes, failures, checks not run, actual browser versions, network counts and cleanup errors.

Use a new numbered evidence directory for another independent attempt; never overwrite a first-submission result. A repair prompt contains only failed observable requirements, not implementation advice. Passing agent-authored tests alone does not establish independent success.

## Checker scope and limitations

The implementation is finalized after the first trial agents submit; only the behavioral specification and prompts were preregistered. The checker is fixed and hashed before independent execution. Failed submissions stop at the first failed dependent check, and remaining checks are explicitly not run.

Browsers have independent profiles, so shared storage/BroadcastChannel cannot stand in for server state. The checker uses actual input and pointer events. It observes the WebSocket handshake, allows initial finite HTTP data requests to finish, and blocks later Fetch/XHR/EventSource requests while leaving static assets available. An already-open HTTP data stream prevents WebSocket-only verification and is reported as such. This is a transport-isolation check for the specified room, not a general-purpose browser compatibility certification or a hostile-code security sandbox. Source inspection after black-box acceptance should confirm the application really owns its counter on the server.

Loopback-interface inspection currently uses Windows `Get-NetTCPConnection`; other platforms fail closed rather than claiming that a printed URL proves binding. Browser binaries must already be installed (`REDWEB_BROWSER` can select one). Node/npm build subprocesses are bounded and cleaned as process trees on Windows; POSIX cleanup covers the managed process group, not deliberate detached/reparented descendants. Cleanup never scans or deletes unrelated temporary directories. These process controls do not safely contain adversarial applications.

The candidate may be unreleased even if its package version matches a published release. Hashes, not the version string alone, identify the evaluated artifact. Root library coverage excludes these development scripts; their unit/control tests do not justify claiming 100% coverage across all repository code.

Selection and correctness are separate results. A package-directed search records a choice among the agent's own shortlist, not a neutral category-search discoverability rate. Record host-project metadata exposure, self-reported versus independently observed timing, and the limits of a one-agent convenience sample.
