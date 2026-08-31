# Starter cleanup: unresolved CI observation

The [Node 20 push job for 08348fb](https://github.com/lakam99/redweb/actions/runs/33403291226/job/99524600675)
failed the immediate descendant-disappearance assertion in
`tests/integration/starter-verifier.integration.test.js`: signal zero did not
throw. Ubuntu 24.04.4 / Node 20.20.2 / npm 10.8.2 reported 1,530 passed,
one failed and six skipped tests. Its other three matrix jobs passed; the
separate PR workflow passed completely. Neither result waives this failure.

Independent inspection found that the frozen process-tree helper signals the
Linux group but awaits only the direct child's exit. The workspace owner also
waits for that child's close; the descendant has ignored stdio, so this does not
establish descendant disappearance. Signal zero checks PID existence, and a
terminated but unreaped process can still exist. That makes an exit/reaping race
plausible, not proven for this run. A surviving process or reused PID remains
possible. See the primary [kill semantics](https://man7.org/linux/man-pages/man2/kill.2.html)
and [wait/reaping semantics](https://man7.org/linux/man-pages/man2/wait.2.html).

The old log lacks process state and start identity. Its fallback sends another
signal before waiting, so successful fallback is not proof that original cleanup
alone succeeded. The test now also requires the captured command error to be
the actual timeout, not merely contain the fixture's output marker.

The next ordinary Node 20 CI execution retains the existing immediate assertion,
two-second command limit and five-second fallback limit. The fixture records
initial process identities. If an assertion fails, it samples descendant and
group-leader identity **before the fallback signal**, appends the command
error/cause and observations to the thrown error, and preserves them if fallback
also fails. No additional acceptance wait or successful-run retry is added.

A separate Linux-only negative control deliberately puts its owned descendant
in a different process group. It requires the unchanged immediate assertion to
fail, verifies that the diagnostic identifies the live escaped process and its
unchanged start identity, then confirms that the existing fallback terminated it.
This is not a reproduction of the original failure or permission to accept escape.
It must fail specifically at the immediate disappearance assertion and must not
return an aggregate fallback failure. Independent review caught that accepting
any error would have allowed a failed fallback to masquerade as a passed control.
Observation-read errors are recorded separately from the original command error;
a real malformed-file test verifies that they cannot replace the timeout evidence.

The helper retains only PID, state, parent/group/session IDs, process start ticks,
platform and observation time. It excludes command names, arguments and
environment. Start ticks remain text, avoiding integer precision loss. Field
positions follow [proc_pid_stat](https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html).
Unsupported platforms and failed reads are explicit. A post-assertion snapshot
is not the process state at the exact failing instant; a later `ENOENT` or a
passing run is inconclusive. Direct-root exit/signal timestamps are still absent.

Local Windows tests exercise parsing and the real npm descendant workflow, but
cannot reproduce Linux reaping or validate the native `/proc` branch. The local
Docker Linux engine was unavailable; it was not started or reconfigured.
The final Windows run passed 21 tests with the one Linux-only negative control
skipped (7.439 seconds). Its native Linux execution remains pending in CI.
Frozen helpers/evaluation evidence, runtime code and acceptance thresholds remain
unchanged. No cause or fix for the original CI failure is claimed yet.
