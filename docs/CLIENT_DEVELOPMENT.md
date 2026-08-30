# Developing Redweb with redweb-client

The unreleased Live HTML implementation is maintained in `redweb-client/live-html`.
Redweb serves that module and emits only its import and `mountLivePage()` call.
DOM reconciliation, reactive updates, delegated actions, form feedback and page
disposal belong to the client. The root `redweb-client` entry remains socket-only.

## Link the sibling repositories

With `redweb` and `redweb-client` checked out beside each other:

```sh
cd ../redweb-client
npm ci
npm run build
npm link --ignore-scripts
cd ../redweb
npm ci
npm link redweb-client --no-save --ignore-scripts
```

Rebuild with `npm run build` in `redweb-client` after editing its source. Redweb's
link reads the resulting `dist` files directly; no repeated packing or dependency
installation is needed. The link is local development configuration, not a saved
dependency or a change to either lockfile. Running `npm ci` in Redweb replaces it
with the locked registry dependency; repeat the link command afterward.

Verify the resolved entry from Redweb:

```sh
node -p "require.resolve('redweb-client/live-html')"
npm run verify:live-html:browser
npm run verify:browser:coverage
npm run verify:client:source-coverage
```

The first browser gate checks real server-side counter/chat, dashboard, form and
rendering behavior. The coverage gate instruments every bundled Live HTML module
separately from the transport. Both use real HTTP/WebSockets and native browser
APIs. `npm run measure:browser:client` measures the transport separately; its
remaining native-browser coverage gaps are not waived by the rendering results.
Client unit tests include isolated transports and an explicitly simulated stale
timer callback; its integration tests use real connections and timers.

The source-coverage command instruments original client modules once and shares
their maps between Node and Chromium. It checks every test file reported exactly
once, compares plain/instrumented results, verifies unchanged inputs and saves
separate contributions. Plain browser candidates must equal the linked build.
It currently fails its unchanged 100% threshold at 520/521 branches; every tracked
statement, function and line is covered. The uncovered branch is a defensive
empty queue entry, not a demonstrated supported-operation path. This is distinct
from the whole-client V8 report; neither denominator is substituted for the other.

## Release boundary

For an isolated packed-pair check before publishing, explicitly select a client
tarball. This does not replace the development link or modify repository lockfiles.
For example, from Redweb in PowerShell (use a fresh output directory):

```powershell
npm --prefix ../redweb-client run build
New-Item -ItemType Directory -Path coverage/client-candidate
npm pack ../redweb-client --pack-destination coverage/client-candidate
$env:REDWEB_CLIENT_CANDIDATE = (Resolve-Path coverage/client-candidate/redweb-client-0.1.0.tgz).Path
npm run verify:live-html:package
Remove-Item Env:REDWEB_CLIENT_CANDIDATE
```

Use the actual filename printed by `npm pack` if the client version changes.
The verifier installs both tarballs in a temporary consumer with an explicit local
override, checks npm integrity and every browser/CommonJS bundle, and resolves
the client from the installed Redweb package. It compares fingerprints before and
after testing. The candidate-only browser phase exercises the server-driven
counter, two-user chat, escaping, draft preservation, reconnect and disconnect
presence. The broader package gate verifies generated consumers and source-free
production execution using the isolated runtime dependencies. Certificate checks
stay enabled; a machine needing its system trust store can use Node's
`--use-system-ca` option.

The candidate path also copies the unchanged browser acceptance/coverage drivers
and their required fixtures beside the extracted package. It never overwrites
packed application code. Four individually linked development tools support the
checks; client, WebSocket, Express and Zod resolution must stay inside the isolated
consumer. The full browser driver and plain/instrumented frontend and refresh
checks run through bounded child processes. Their temporary profiles stay inside
the owning workspace, and reports survive under `coverage/packed-browser/<id>`.
Original package files, copied test bytes and client fingerprints are checked even
on failure. The runtime coverage report must identify the selected client bundle.
This is installed-runtime testing with external test tools, not a production-only
installation or full original-client-source coverage. The frozen browser driver
does not itself prove that every individual shutdown error is propagated.

Without `REDWEB_CLIENT_CANDIDATE`, the command keeps the ordinary registry path;
it does not use or infer the local npm link. A candidate pass is not a registry
release pass. `npm run verify:package:tools` includes the fingerprint/containment
unit regressions; its scoped coverage is not coverage of every browser driver.

Published `redweb-client@0.1.0` does **not** export `./live-html`. Its local manifest
still has that version, so version text alone does not identify this candidate.
This Redweb development branch therefore requires the link above. It is not ready
for ordinary registry installation, merging or publication as a compatible pair.

Before release, publish an appropriately versioned client, update Redweb's
dependency and lockfile, remove the local link with a clean install, and rerun the
independently installed package and full release gates. A linked working tree is
not evidence that the published pair works. No publishing or deployment is part
of this local workflow.
