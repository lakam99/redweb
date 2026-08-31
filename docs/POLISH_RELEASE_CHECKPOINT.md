# Release-polish checkpoint

These are verified checkpoints, not release approval. Redweb's runtime at
`3166468` was tested with published `redweb-client@0.2.0` on Windows,
Node 22.21.0 and Chrome 152.0.7977.64. Later candidate-verifier development changes
private tooling only; it is not claimed covered by these earlier checks.

## Current package and resources

The full clean registry package gate passed: actual counter/chat/dashboard browser
acceptance, reconnect/disconnect, six starters, executable recipes and source-free
consumers. It used no client override or consumer link. All 192 original package
files, 23 harness files and four explicitly external development tools passed
identity checks.

- Redweb archive SHA-256:
  `f9bb0230becb7d1ab29e36a24ab9c35362d70e790bff3a9f3b064f9cb9b49439`.
- Report: `coverage/packed-browser/a03b7840-905c-4718-8f52-701d5fbd955c/report.json`.
- Report SHA-256:
  `8c4c051b034998a9ad537c1240600e9b434402a296fd7cdabc69244071a9b0e4`.
- Frontend run `b71d6f8a-fc4a-4b7f-b61d-207274883b12`: all-four 100% over
  426 statements, 262 branches, 64 functions and 351 lines.
- Refresh run `ac9073e4-c2a2-4baa-b6f1-4552a38c526f`: all-four 100% over
  82 statements, 44 branches, 12 functions and 71 lines; actual bfcache restoration.

After package and site tests terminated, the unchanged resource gates ran
sequentially without inherited workload or instrumentation overrides:

| Gate | Observed result |
| --- | --- |
| Socket load | 32 clients, 3,200 messages; 6,686.50 messages/s, p99 7.233 ms; slow consumer contained |
| Metadata overhead | Three 500-client trials; 1,880.752 bytes/connection against 2,048 limit |
| Live HTML load | 200 expired renders, 110 clients; 8,080,280-byte heap delta |
| JSX rendering | 10,000 component rows in 49.2 ms; 1.3 MiB retained |
| Production audit | Zero reported vulnerabilities; TLS verification retained |

## Full 60-minute soak

One default run began at 2026-08-31T01:41:14Z. Its original owned terminal session
completed with exit 0; the resulting file was independently checked against all
delivery, registry, trend, heap and handle predicates. No competing local
load/browser/test run was started during the measurement. Runtime source and the
soak script were unchanged; candidate tooling edits do not enter the soak process.

- 3,600 seconds, 64 clients, 720 samples.
- 2,104,941 messages sent; 2,104,808 received: **99.9936815% delivery** against
  the existing 99% requirement. This is not lossless delivery: 133 replies were
  not received during rotating-connection traffic.
- Warm heap 11,378,888 bytes; peak 11,918,736; final 11,296,552:
  **99.276414%** of warm, below 110%.
- All final client/room/session/in-flight registries empty. All eight resource
  trend predicates passed. Handles moved from one to two, within the allowed one.
- Result: `coverage/polish-soak-3166468-20260831.json`, SHA-256
  `f402a73e26f207fb5e55b53365912169350bba2fad0bb33d4856719db6df49c3`.
- Script SHA-256:
  `ce30f8abcda0e018b8c586bd53dba775aebdaaaaf5275aa8bdf2b2f8d9b1d22b`.

## CI remains a release blocker

At the same `3166468` revision, the
[push run](https://github.com/lakam99/redweb/actions/runs/33347952379) passed
all jobs. The [PR run](https://github.com/lakam99/redweb/actions/runs/33347954450)
passed Node 18/20/24 and lifecycle checks but failed Node 22 recovery. Its unit and
integration suites passed first: 83 suites, 858 passing tests and five existing
platform skips, with all-four 100% instrumented-library coverage.

PR storm 3 peaked at **110.111615%**, above the unchanged 110% limit; final heap
was 98.786034% with empty registries. The push Node 22 peak was 109.607980%.
Neither final cleanup, the green push run nor the long-soak pass waives this
failure. No selective rerun occurred. The senior critic independently verified
the CI and package evidence.

The local documentation site imports the same canonical source at commit
`6b528f1`: 98 pages, 154 assets, real HTTP/link/download and filesystem-rollback
checks, six documentation tests with 100% line/branch/function coverage across
its seven declared modules. Catalogue SHA-256:
`8b4d805a7f845af30175423eebc4da610e579b9a51a74ccd8e6f56a5e0d4fa73`.
This is not whole-site coverage or a hosting deployment.

The maintainer has now authorized development/review of a server-focused
candidate, not its adoption. Its protocol and results must be assessed separately.
Redweb publication, released-site alignment, final requirement audit and merge
remain pending. The original gate and failed results remain intact.
