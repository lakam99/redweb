# Socket-page release preparation

Updated 2026-09-02. The maintainer published client 0.3.0; no core publication or
hosting deployment was performed during this preparation.

## Client publication verified

`redweb-client@0.3.0` was published from the sibling client checkout on
`codex/socket-page-actions`, commit `3d2bcfec75db367b6e4924bcf430670f5569b1c7`.
Its package version and lockfile agree, release notes are included, and prepack
rebuilds the ESM/CommonJS bundles and declarations. Build logs use stderr so
`npm pack --json` remains machine-readable.

After npm's processing delay, the actual public registry returned version 0.3.0,
the same source commit, and the tested candidate integrity below. A fresh local
pack independently reproduced the publication's SHA-1
`def8dcc0bb205ccff68bf8fd1c7ea91b7d289547`, 14 files and 31,378 bytes.

```text
sha512-hUBa40wdsvWKY5bqeyreDzUhMcaB0e0x0OX+YRyZw6ccri6BBSHnM6eEKMV0wOkprIF2cxDkGNILwAA5ELYkWw==
```

Core's real dependency installation now resolves that registry artifact, not a
link. Its lockfile records the actual registry URL and integrity. This verifies
artifact identity, not a claim that client provenance was available.

## Finish the dependent releases afterward

1. Completed: verify client 0.3.0 registry metadata and install the actual artifact.
2. Redweb **0.15.0** now has `redweb-client@^0.3.0`, its real npm lockfile,
   versioned changelog and immutable 69-page 0.15.0 documentation snapshot.
   The final gates below passed; core is ready for manual publication.
3. After core publication, update site/tutorial exact dependency pins and locks,
   synchronize the released catalogue, run the downloadable-archive/browser gates,
   then hand off manual Firebase deployment.

No future registry URL, integrity value or already-published version was fabricated
in a lockfile. The site's development tutorial remains undeployable with its
previous published pins; its candidate-archive tests are not evidence that core
0.15.0 is already published. Do not deploy it before step 3.

## Verification completed

- Client `npm test`: build, declarations, unit tests, mock-free HTTP/WS integration,
  and headed Chrome passed. Original-source coverage remains 800 statements,
  543 branches, 125 functions and 667 lines, all 100%. Report:
  `coverage/client-source/af576edc-b382-424b-97a2-bd46ca163832/summary.json`.
- The actual client tarball installs in a fresh, unlinked application with released
  Redweb 0.14.0. Both module formats and the optional live-html entry load; native
  socket requests wait for terminal replies and preserve null payloads. Actual
  nested HTTP form parsing and the installed Express/body-parser qs versions pass.
  Run the opt-in regression with `REDWEB_VERIFY_CLIENT_RELEASE=1` and
  `tests/integration/client-release.integration.test.js`; it rebuilds/packs the
  sibling client and uses the existing owned-workspace/process helpers.
- After installing registry client 0.3.0, 308 core tests across 29 suites pass.
  Every `src/htmx/*.js` module, `src/cli/templates.js`, and the socket
  `BaseHandler`, `SocketContract`, `SocketAction` and `HandlerGuard` modules
  reach 100% statements, branches, functions and lines. This is scoped coverage,
  not whole-repository certification. Report: `coverage/socket-page-release`.
- Canonical examples, protocol declarations, all three TypeScript configurations,
  generated documentation and the prepublication release check pass.
- The actual downloadable tutorial archive passes independent installation,
  compilation, type tests, mock-free HTTP/WS/SQLite tests, all-four 100% coverage
  of its game/schema modules, and headed Chrome acceptance. The explicit pair was
  core 0.15.0 candidate plus a client 0.3.0 pack byte-identical to npm's artifact;
  no developer links were used inside the extracted application. Its unchanged
  old dependency pins still need replacement after core publication.
- Core's production audit reports zero vulnerabilities under its application-root
  qs policy. The installed dependency signature audit verifies 428 registry
  signatures and 31 attestations; this aggregate does not claim every package has
  provenance.
- Fresh site/tutorial locked installs audit with zero reported vulnerabilities.
  The site build, 438-page HTTP/link verification and its seven-module 100%
  documentation coverage scope pass. After restoring npm links, the headed
  three-player tutorial passes login, rejection/input retention, moves, reconnect,
  disconnect presence, win and logout.
- The complete isolated core package gate passes against registry client 0.3.0
  without a candidate-client override: headed counter/chat/cards/components/JSX,
  private dashboard login and actions, reconnect/disconnect, all six generated
  starters and source-free execution, executable documentation and static export.
  Bundled Live HTML and browser-refresh coverage each remain all-four 100%.
  Report: `coverage/packed-browser/2cc05d98-d6b7-4c54-b5ce-fef4cbb83053`.
  The tested core archive SHA-256 was
  `1fd3fe3b35fd8ec0f9e805df9c3ad6655af40f373e38b44ab0418db71660eb1a`;
  the subsequent evidence-only update to this file changes the final archive hash,
  not its runtime, recipes, declarations or versioned catalogue.
- The independent senior critic approved the release metadata, actual installed
  client identity and catalogue consistency with no blocking findings. Core
  publication dry run passes. No soak or long fixed-window tests were run.

## Manual next step

Publish from the clean `codex/socket-page-actions` core checkout:

```powershell
Set-Location C:\Users\arkam\Documents\redweb
$env:NODE_OPTIONS = '--use-system-ca'
npm publish
```

The system-trust-store option preserves TLS verification. Do not disable TLS
checks. Do not publish the client again or deploy the site yet. After core is
available in npm, replace the site's/tutorial's old pins with verified registry
dependencies and synchronize the 0.15.0 catalogue before rebuilding and deploying.

## Dependency mitigation, not a library-level promise

Core development, generated applications, the site and the tutorial now use an
application-root override scoped to the Express dependency subtree:
`{ "express": { "qs": "6.16.0" } }`. Their checked locks and the fresh packed-client
consumer audit report zero known vulnerabilities. Actual Express and body-parser
both resolve the patched qs version. The generator reuses the root policy rather
than maintaining a separate starter copy.

The override does not upgrade Express or affect unrelated dependency subtrees.
It also does **not** propagate from Redweb when another application installs it:
existing consumers must apply the documented root policy and verify their own
locks/tests. See [release trust](RELEASE_TRUST.md#temporary-express-4-dependency-mitigation)
for the maintainer advisories and npm's override rules. Ordinary installs without
the policy can remain affected until upstream dependency ranges are patched.
