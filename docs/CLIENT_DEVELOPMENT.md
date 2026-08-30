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

Published `redweb-client@0.1.0` does **not** export `./live-html`. Its local manifest
still has that version, so version text alone does not identify this candidate.
This Redweb development branch therefore requires the link above. It is not ready
for ordinary registry installation, merging or publication as a compatible pair.

Before release, publish an appropriately versioned client, update Redweb's
dependency and lockfile, remove the local link with a clean install, and rerun the
independently installed package and full release gates. A linked working tree is
not evidence that the published pair works. No publishing or deployment is part
of this local workflow.
