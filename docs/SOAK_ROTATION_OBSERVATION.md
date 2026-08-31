# Soak rotation: retained failure and controlled observation

## Actual CI failure, still unresolved

At `df58f94`, PR run 33432429300, Node 24 job 99620736610, failed the native
ten-second mechanics test's delivery assertion: **98.47715736040608%**, below
the unchanged 99% limit. The job recorded 1,939 passes, one failure, eight skips,
175 suites and 1,212.024 seconds, despite all-four 100% library coverage.
The matching push and later Windows run passed; they do not erase this failure.

The previous test saved its measurement only after all assertions. Its temporary
workspace was then deleted on failure, so the original raw JSON and exact
sent/received counts are unavailable. Do not infer those counts from the ratio.
The complete failed-job log was retained with ANSI removed and LF newlines at
`coverage/ci-df58f94-node24-99620736610.log`, SHA-256
`170eec5766098b6d9b27cfbebaf56ace15984d964fe5e2327ddb7b6daea4df8a`.

## Evidence preservation correction

The mechanics fixture now saves raw report text, command output, observed normal
exit status and available errors before parsing or policy assertions. Invalid
JSON and a sub-limit outcome remain inspectable. Unknown launch/timeout/cleanup
failures remain failures, not fabricated exit statuses. If reading or writing
evidence fails, the original workspace is retained and primary errors survive.
The critic caught the outer-workspace deletion case; real-filesystem regressions
now verify the original raw file survives after `VerificationWorkspace.run()`
rejects. Test cleanup explicitly removes its own retained fixtures afterwards.

The GitHub Node matrix now uploads available `coverage/soak-tools/smoke-reports/`
artifacts on success or failure, independently of the lifecycle job's coverage
artifact. Missing evidence warns because a pretest/launch failure can occur
before the measurement exists; that warning does not turn failed tests green.
Retention is 30 days. Each observation gets a new exclusive filename.

## Controlled real-socket comparison

Two native WebSocket cases hold one actual reply after the peer receives its
tick. They use no mocked transport, timers or process APIs:

- Reply before rotation: the original reply arrives, rotation closes the old
  socket and opens its replacement, and both later replies arrive: **4 sent,
  4 received**.
- Rotation before releasing the held reply: the old socket is closed before
  replacement; releasing that reply fails on the closed peer. Both later
  replies arrive: **4 sent, 3 received**, with exactly one still missing.

Assertions verify the pending tick before rotation, closed original socket,
event order, distinct replacement, generation increment and exact counters.
The targeted comparison passed both cases in 0.582 seconds.

This proves a possible loss mechanism during intentional rotation, **not the
cause of the historical CI run**. The existing 100 ms send and 1,000 ms rotation
timers can overlap with pending work. No drain, timing, workload or delivery
limit has been changed, and missing replies remain in the denominator. The
next ordinary CI observation must be retained before making a stronger claim.
A future drain policy would change rotation semantics and needs its own tested,
explicitly documented methodology; it is not a silent fix for this result.

See [the original soak-verifier correction](SOAK_VERIFICATION.md) for policy
details and the distinction between short mechanics tests and hour acceptance.

## Final verification of this correction

The maintained `npm run verify:soak:coverage` passed 91 tests across five suites
in 16.992 seconds after the retention review fix. All 280 statements / 116 branch
outcomes / 68 functions / 200 lines are covered across the three unchanged
soak modules and the new test-only retention helper. The latter contributes
39 statements / 16 branches / three functions / 27 lines; it is not shipped
runtime coverage. Map: `coverage/soak-tools/coverage-final.json`, SHA-256
`19d9f505a2d2156e09177a86e5a922fd848b5e1fcdb14c0033f6fab889a98377`.

The reviewed nine-test retention selection also passed independently in 2.266
seconds with all-four 100% helper coverage. It includes actual child exits and
filesystem failures, plus explicit application callback faults.

A follow-up bounds each of the three real child-command cases at ten seconds,
with a 40-second outer test budget allowing independent process/pipe/workspace
cleanup to finish first. The unchanged nine cases passed again in 0.745 seconds
at all-four 100% helper coverage; no soak workload was rerun for this test-budget
correction.

Two ordinary mechanics observations were retained during implementation:

- Before the outer-retention fix: 163 sent / 162 received, 99.38650306748467%,
  command exit 1 for the known room-phase trend (early 1, late 2), not delivery.
  Observation `2bed814f-ca66-438e-b3a4-1ab338848976.json`, SHA-256
  `6b2ff5305c42c103a878a304aaadd353d9225710539674a749d8fa636a4c2af8`.
- Final wiring verification: 173 sent / 172 received, 99.42196531791907%,
  command exit 0. Observation `8aacb5b0-9512-48ac-a201-7b64255af574.json`, SHA-256
  `bee152a47e3047ce9d9bd20570d1b3e253359a315e7cc259847c0acd76421760`.

Both are under `coverage/soak-tools/smoke-reports/`. The prior fixture's explicit
room-phase allowance is unchanged: a mechanics-test pass can retain command
exit 1 and is not soak acceptance. Neither observation is lossless, neither
supersedes the hosted sub-99% failure, and neither is a new hour soak.

## Current-head long-run failure and heartbeat correction

At `1bb61c3`, a fresh default hour began at 21:07:04Z under a one-shot Windows
Scheduled Task with independently reviewed child ownership. The workload exited1
after about nine minutes with `Soak client disconnected unexpectedly.` No report
was created, so it provides no partial delivery, resource-trend or acceptance
measurement. The owner exited normally, did not force termination, retained its
1,520-byte stderr and terminal outcome, and did not retry. The exact task was
removed only after terminal validation. Outcome SHA-256:
`53083685f019d82d5f62421faaa80dd15f16d06a3d85ff6b3b08e3546982e258`;
stderr SHA-256:
`951a06f05779be74031fb2f7736645557593b1cc6f1b750736b77a8348241131`.

The old soak client discarded the native close code and reason. Unexpected close
events now preserve both, with reasons escaped for unambiguous line-oriented logs;
unit and real-WebSocket checks cover framework policy and transport closes,
including absent codes, without changing delivery accounting. An earlier error
remains the primary failure if its event arrives before close. The maintained
soak gate passes94 tests at all-four100% across its existing four-file scope.

A separate no-mock regression deterministically reproduced one possible false
disconnect: a responsive same-process client automatically pongs, while one
server-side ping callback stalls the event loop beyond the heartbeat deadline.
Previously the next timer terminated that healthy client before its already
dispatched pong handling could win. Heartbeat expiry now owns one deduplicated,
unreferenced `Immediate` per expired socket. The deferred check terminates a peer
that is still silent; pong handling, detach/reattach, or monitor shutdown makes
the stale check harmless. No deferred-check allocation occurs on healthy ticks and no timeout is
reset. Connection/queue limits remain the resource bounds.

The focused heartbeat scope passes71 unit and real-socket tests at100% statements,
branches, functions and lines. The senior critic required and approved silent-peer,
deduplication, detach/reattach and shutdown ownership cases. This establishes a
real possible mechanism and its correction, **not the cause of the failed hour**:
that run's missing close code cannot be recovered. Node-matrix and corrected-hour
outcomes remain required before stronger compatibility or acceptance claims.
