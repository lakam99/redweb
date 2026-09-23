# Deferred runtime-recovery investigation

Status: deferred research, not a resolved defect or a recovery waiver.

The maintainer subsequently authorized development, review and adoption of the
server-focused check documented in `docs/SERVER_RECOVERY_CANDIDATE.md`. It now
blocks CI; the original command remains unchanged as a visible non-blocking
diagnostic. This changes the acceptance contract, not the historical results or
the unresolved runtime explanation. No historical bounded comparison is repeated.

The one-original/one-split Ubuntu comparison is now complete. See
[its results and contrary ordinary-CI evidence](RECOVERY_COMPARISON.md).
The stopping rule remains in effect: no repeat research measurement is needed.

The maintainer prioritized finishing Redweb's release work over further open-ended
runtime investigation. Exact V8 code-lifetime attribution is therefore a separate
follow-up spike. It is no longer a prerequisite to finish the implementation.
This does not by itself authorize shipping with a failed acceptance check.

## What is parked

- Explaining whether the attached Code objects in the private client snapshots
  remain executable or are marked for invalidation.
- Accounting for every hidden/runtime byte and the remaining unclassified parser.
- Matching invalidated versions from the separate code-log run to snapshot objects.
- Producing a minimal upstream V8/ws reproduction if the evidence warrants one.

No more heap captures, compiler tracing, GC experiments or new diagnostic tooling
are planned on the release path solely to answer these questions. Do not repeat
the existing research or treat its partial explanations as a production fix.

## Evidence already available

[Offline attribution](RECOVERY_CODE_ATTRIBUTION.md) found 261 final
deoptimization-bearing Code objects attached to preexisting functions/closures,
one unchanged double-version group, and three unchanged standard-stream/prototype
Socket objects. The [JIT control](RECOVERY_RUNTIME_CONTROLS.md) strongly supports
a compilation-dependent contribution in the separate load-generator process.

These findings do not establish the entire cause of the original shared-process
Ubuntu/Node 22.23.2 failure. Its fourth storm reached 110.218742% against the 110%
limit. One separately traced server also reached 110.080951%; server isolation is
not assumed to guarantee a pass. Original failures and private evidence remain
preserved. The snapshots must not be uploaded or embedded in a public issue.

## Bounded release decision

The next recovery-specific release step is a predeclared comparison using the
existing original and split-process tools on Ubuntu/Node 22.23.2, with the matching
client dependency identified. Record exact revisions, environments and every
phase; keep connection counts, fixed warm baseline, delivery/cleanup checks and
the 110% bound. No snapshots, tracing, JIT disabling, coverage instrumentation or
other tests may run inside or alongside the measured processes.

Use one original run and one baseline split run, sequentially, not retries until
green. A failed setup is not a workload result. This is a bounded decision input,
not enough by itself to establish repeatability or replace cross-runtime release
checks. Separate processes change scheduling/GC and are not equivalent to the
original shared-process measurement.

Before execution, pin Node 22.23.2, record the Ubuntu 24.04 image/patch/kernel and
any differences from the historical runner, and record source/lockfile/client
hashes. Clear inherited diagnostic, coverage and workload overrides. Commands,
in this order, with the second result collected even if the first fails, but only
after confirming that the first process and all its children have terminated.
If cleanup is uncertain, record the second run as blocked; do not launch it beside
potential residual load:

```text
node --expose-gc scripts/verify-recovery.js
node scripts/diagnostics/recovery-split.cjs baseline
```

After these two runs, stop, record both outcomes, and request the acceptance-contract
decision. Do not automatically launch follow-up tracing or repeat either run.

- If the isolated server satisfies its own budget and delivery/cleanup checks,
  review whether an explicitly versioned server-focused acceptance protocol is
  appropriate. Track client-generator health separately. Adoption is a separate
  reviewed decision, not automatic promotion of this diagnostic or erasure of
  historical failures.
- If the server fails its budget, delivery, registry cleanup or process shutdown,
  report the concrete failure and the required release decision. Do not start
  another unbounded runtime-research cycle automatically.
- A failed diagnostic, incomplete output or uncertain cleanup is not a pass.
  The diagnostic's successful exit proves its stated delivery/cleanup conditions,
  not that its reported heap ratios satisfy a release budget.

Existing CI remains unchanged until a replacement protocol is explicitly approved.
No threshold increase, selective rerun, code-byte subtraction or blanket
`continue-on-error` follows from this deferral.

### Temporary collection host

The local Windows machine has no running Docker Linux engine or Ubuntu WSL
distribution. A temporary, push-only `recovery-comparison.yml` workflow therefore
collects the declared pair on a separate Ubuntu 24.04 hosted VM, pinned to Node
22.23.2. It only triggers when that workflow file changes on `codex/agent-ready`,
rejects repeated run attempts, and is removed after collection. It does not replace
or modify `ci.yml`, and its completion does not adopt a new acceptance protocol.

The historical failed runner reported Ubuntu 24.04.4, image `20260823.283.1`
and runner agent 2.336.0 (run `33322376349`, job `99286494853`). The new run records
its actual OS/image/kernel and Node/V8, revision, source/lockfile and client hashes.
The historical log did not independently record its kernel. Matching the image
label is not a claim of identical hardware or kernel.

Each measured command runs in a transient systemd service with a minimal
environment and `ExitType=cgroup`, so detached diagnostic worker groups remain
owned. The 180-second outer cap and five-second termination bound do not change
the scripts' existing internal deadlines. No resource quota or memory subtraction
is added. Before either workload, two trivial real Node services exit 0 and 7
through the same wrapper to verify status propagation and cleanup; these are setup
probes, not recovery measurements. A failed command remains failed; an empty/removed cgroup must establish
descendant termination before the split run starts. Systemd containment and clean
environment differ from the historical direct-shell execution and are disclosed
in the evidence. Other CI jobs use separate VMs, not necessarily exclusive physical
hardware. Only explicit safe logs/reports/hashes are retained, never snapshots.

The orchestration follows [systemd's transient-service semantics](https://raw.githubusercontent.com/systemd/systemd/v255/man/systemd-run.xml)
and the kernel's [recursive cgroup population definition](https://docs.kernel.org/admin-guide/cgroup-v2.html#un-populated-notification).
Its syntax/review and actual hosted execution are verification evidence, not a
claim of unit coverage for shell orchestration. Both outcomes and the split server's
actual warm/storm ratios still require review before the acceptance decision.

## What remains release-critical

- Actual message delivery, reconnect behavior, bounded queues and empty owned
  registries after cleanup.
- Successful shutdown checks; a reproduced timeout must be resolved or explicitly
  dispositioned, not hidden by a longer deadline. The historical timeout remains
  unexplained even when current regression tests pass.
- Matching packed Redweb/client compatibility, required coverage and ordinary
  test/load/memory/package checks. Existing gaps are not waived by this spike.
- Honest documentation of the tested runtime, limits and remaining uncertainty.

The full acceptance checklist remains in [AGENT_READY_ACCEPTANCE.md](AGENT_READY_ACCEPTANCE.md).
This spike adds no new release feature, performance guarantee or certification.

## Reopening the spike

Resume only as deliberately scheduled work, or when a server-specific regression,
continued growth under an approved protocol, or a real deployment incident makes
these questions actionable. Start from the existing evidence and a single
falsifiable question. Set the experiment count and stopping rule before executing;
end with a reproducible cause/fix or a documented evidence boundary, not an
indefinite sequence of deeper snapshots.
