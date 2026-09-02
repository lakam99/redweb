# Bounded Ubuntu recovery comparison

Status: the declared pair is complete; acceptance decision pending. No retries,
new tracing, threshold changes or replacement of the original gate followed.

## Exact execution

[Run 33346305798](https://github.com/lakam99/redweb/actions/runs/33346305798)
executed revision `41915b0c0ef5906eca851aaef64d80b9c198cd08` once on Ubuntu
24.04.4, image `20260823.283.1`, kernel `6.17.0-1022-azure`, Node 22.23.2,
V8 `12.4.254.21-node.56`, systemd `255.4-1ubuntu8.17`. The OS/image match the
historical failing runner; its kernel was not independently recorded. Hardware
identity or exclusive underlying hardware is not asserted.

The temporary workflow's real service probes returned exactly 0 and 7 with
confirmed cleanup before either measured command. It then ran, sequentially:

1. `node --expose-gc scripts/verify-recovery.js` — exit 0, 8.002-second service lifetime.
2. `node scripts/diagnostics/recovery-split.cjs baseline` — exit 0, 8.068-second service lifetime.

Both services became inactive with zero main/control PIDs and removed cgroups.
Source fingerprints before and after match, including the diagnostic report's
own fingerprint. All four installed client bundles match published client 0.2.0.
No diagnostic/workload/coverage overrides entered the measured environments.
The comparison used systemd descendant containment and a minimal environment,
unlike the historical direct-shell runner. Those differences are not concealed.

The temporary trigger was removed after collection. Its implementation remains
auditable in commit `41915b0`; do not restore it merely to obtain another pass.

## Heap results

Bytes measured after each phase's unchanged settling/collection protocol:

| Phase | Original combined process | Split server | Split load generator |
| --- | ---: | ---: | ---: |
| Preconditioning | 10,388,616 | 9,991,120 | 6,410,728 |
| Warm | 10,379,216 | 10,023,960 | 6,360,512 |
| Storm 1 | 10,823,136 | 10,303,776 | 6,611,032 |
| Storm 2 | 11,207,736 | 10,627,552 | 7,000,048 |
| Storm 3 | 11,390,320 | 10,801,856 | 7,119,072 |
| Storm 4 | 11,330,136 | 10,875,592 | 7,156,480 |
| Storm 5 | 10,118,552 | 9,654,040 | 7,194,432 |

The original peaked at **109.741622%** of its fixed warm baseline and finished
at 97.488596%, satisfying its existing 110% bound in this one run. The isolated
server peaked at **108.495964%** and finished at 96.309642%. The split load
generator reached **113.110894%**; this is not a claim that every process satisfied
110%. Systemd's service-accounting numbers are not substituted for Node's heap
samples or treated as equivalent process-memory measurements.

Both original and split retained empty server client/room/session registries.
The original waits for a reply per connection but does not assert each reply's
payload identity. The split verifier additionally checked **7,400 exact replies**:
client sent, client received and server received agree at every phase, client
registries are empty, and all recorded worker output is complete and hash-verified.
Its successful exit proves its stated delivery/cleanup conditions; the heap
percentages above were independently calculated from the actual samples.

## Contrary CI evidence remains a failure

The ordinary Node 22 job at prior source head `69ea1fb` also ran during this
collection, on a separate hosted VM. Its 83 suites passed (854 tests, five
platform-specific skips), but [job 99349863069](https://github.com/lakam99/redweb/actions/runs/33345905870/job/99349863069)
failed the original recovery gate: warm 10,395,344 bytes, fourth storm 11,540,472
bytes (**111.015778%**), final 10,069,496 bytes (96.865443%). Final recovery does
not erase the failed intermediate limit. The measured production runtime and
original recovery script did not change between those heads.

The same run's Node 20 core job separately failed the trace-mode diagnostic
integration test with `write EPIPE` during worker startup. Its cause is not yet
established; it is neither a demonstrated production socket defect nor a passing
test. Node 24 and lifecycle/browser/package jobs passed. These results must not
be condensed into a green cross-runtime release claim.

## Decision and preserved evidence

The bounded comparison supports reviewing a server-focused acceptance protocol,
not automatically adopting one. The proposed next step is a separately reviewed
server gate with explicit delivery, cleanup, shutdown and fixed memory budgets,
while retaining the original combined-process result as visible diagnostic
evidence. Maintainer approval is required before replacing any existing CI gate.
Until then the current gate and release blockers remain unchanged, and no merge
or publication is authorized by this report.

The hosted artifact `bounded-recovery-33346305798` is retained for 30 days. A local
copy remains under `coverage/bounded-recovery-33346305798`; no snapshots were
collected or uploaded. Key SHA-256 receipts:

- `recovery-comparison/inputs-before.json` (identical to `inputs-after.json`):
  `26354cecf712c22a66a91e759b45c939a3a27f456ec9f3e72349eb11b3aeecb4`.
- `recovery-comparison/original.log`:
  `af8b438e00ef0e901b4dcb598f942e50ce49c9a3fab021b5f82353ee517fc16f`.
- `recovery-split-8bVO1w/report.json`:
  `106dee62dbc0dc8667e57bc07dd653034516ba7dd8927c499fedff5cabc6411b`.

The senior critic independently reproduced the ratios, delivery reconciliation,
sample/log hashes, input identity and recorded cleanup checks without rerunning
either workload. That is scoped evidence approval, not merge approval.

The original historical failure and deferred research remain described in
[the follow-up spike](RECOVERY_FOLLOWUP_SPIKE.md). One successful comparison is
not repeatability evidence and does not explain the underlying V8 cause.
