# Socket-page release preparation

Prepared 2026-09-02. No npm publication or hosting deployment was performed.

## Publish the client first

`redweb-client@0.3.0` is prepared in the sibling client checkout on
`codex/socket-page-actions`, commit `3d2bcfec75db367b6e4924bcf430670f5569b1c7`.
Its package version and lockfile agree, release notes are included, and prepack
rebuilds the ESM/CommonJS bundles and declarations. Build logs use stderr so
`npm pack --json` remains machine-readable.

From that clean checkout, the maintainer can publish manually:

```powershell
Set-Location C:\Users\arkam\Documents\redweb-client
$env:NODE_OPTIONS = '--use-system-ca'
npm publish
```

The system-trust-store option preserves TLS verification. Do not disable TLS checks.
The completed publication dry run reported 14 files, 31,378 bytes, no bundled
dependencies, and candidate integrity:

```text
sha512-hUBa40wdsvWKY5bqeyreDzUhMcaB0e0x0OX+YRyZw6ccri6BBSHnM6eEKMV0wOkprIF2cxDkGNILwAA5ELYkWw==
```

This is a local candidate hash, not proof of registry publication or provenance.
Verify the real registry artifact after publishing.

## Finish the dependent releases afterward

1. Verify client 0.3.0 registry metadata and install the actual published artifact.
2. Finalize Redweb **0.15.0** with `redweb-client@^0.3.0`, its real npm lockfile,
   versioned changelog and immutable 0.15.0 documentation snapshot. Repeat the
   packaged pair and headed tutorial gates, then hand off manual core publication.
3. After core publication, update site/tutorial exact dependency pins and locks,
   synchronize the released catalogue, run the downloadable-archive/browser gates,
   then hand off manual Firebase deployment.

Core metadata deliberately remains at the prior version with an unreleased
catalogue until step 2. It is **not ready to publish** yet. No future registry URL,
integrity value or already-published version was fabricated in a lockfile. The
site's development tutorial remains undeployable with its previous published pins.

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
- 75 selected core initializer/documentation/HTTP/socket tests pass with 100%
  statements, branches, functions and lines in the changed template module.
- Fresh site/tutorial locked installs audit with zero reported vulnerabilities.
  The site build, 438-page HTTP/link verification and its seven-module 100%
  documentation coverage scope pass. After restoring npm links, the headed
  three-player tutorial passes login, rejection/input retention, moves, reconnect,
  disconnect presence, win and logout.
- Client publication dry run passes. No soak or long fixed-window tests were run.

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
