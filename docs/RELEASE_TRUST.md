# Choose and verify a Redweb release

Redweb is a Node.js HTTP/WebSocket library with server-rendered TSX, not a hosted service. Evaluate the exact package, runtime, application and deployment you intend to use. A passing test suite, a registry signature and a provenance statement answer different questions; none certifies an application as secure.

## Runtime and compiler compatibility

| Area | Contract and verification boundary |
| --- | --- |
| Core runtime | The package declares Node `>=18`. This is an installation/compatibility floor, not a recommendation to deploy an end-of-life runtime. |
| Production Node | Use a currently maintained LTS release with current security patches. As checked on 2026-08-30, Node 22 and 24 are LTS; Node 18 and 20 are end-of-life. Recheck the official schedule when deploying. |
| CI coverage | The repository matrix targets Node 18, 20, 22 and 24 on Linux. The 18/20 jobs are legacy-compatibility checks, not security-support claims. A configured job is not a passing result; inspect checks for your exact commit. |
| TypeScript/TSX | The starter uses the package's tested TypeScript dependency and `redweb/tsconfig.json`. Standard decorators and legacy `experimentalDecorators` consumers have separate compile tests. Node's native TypeScript execution is not a replacement for compiling TSX/decorators with this configuration. |
| Persistent dashboard | This application recipe requires Node 22.13+ and native `node:sqlite`; it is not part of the core runtime requirement. Its database and account/session design are single-process. |
| Browser | The real-browser gates exercise Chromium. They are not a Firefox/Safari compatibility certification. Test the browsers you support, including reconnect and forms, before release. |
| Runtime platforms | This branch has local Windows evidence and Linux CI configuration. Neither proves every OS, architecture, proxy, container platform or serverless host works. Live pages require a long-lived Node listener with WebSocket upgrades. Static export is a separate deployment mode. |

Use the [official Node release schedule](https://nodejs.org/en/about/previous-releases) for maintained releases, the [TypeScript decorator documentation](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html#decorators) for the distinction between decorator modes, and [Node's TypeScript limitations](https://nodejs.org/api/typescript.html) for native execution constraints. Current per-commit test evidence and uncompleted checks are recorded in the [release checklist](AGENT_READY_ACCEPTANCE.md), not inferred from this table.

## Pin the package and the documentation together

For a published application, select an exact release, commit its lockfile, and use `npm ci` in CI/deployment. The following is an intentionally pinned example, not an instruction to treat `0.12.0` as permanently current:

```sh
npm view redweb@0.12.0 version engines dist.integrity dist.signatures dist.attestations gitHead --json
npm install --save-exact redweb@0.12.0
npm audit signatures
npm audit --omit=dev
```

The signature command must run in the installed application directory. Keep TLS verification enabled and use a current npm CLI; a certificate/trust-store failure is not a reason to disable verification. A lockfile's integrity value detects changed package bytes; registry signatures authenticate registry metadata; provenance, when present and verified, links an artifact to a build/source identity. Vulnerability audit is a separate check against known advisories, not an application penetration test.

For this branch's **unreleased** features, follow the matching tarball instructions in the [complete starter recipes](GETTING_STARTED.md#start-with-a-complete-recipe). The checkout has package metadata `0.13.0`, reserved for this unreleased candidate; the published `redweb@0.12.0` does not contain these changes. Installing `latest` does not install the unmerged branch. Do not mix a local-candidate guide with an older registry release and assume the APIs exist. Changing the package version does not publish it or satisfy outstanding release checks.

Redweb is pre-1.0. Consult the changelog and versioned guide before upgrading, run your own real HTTP/WebSocket/browser tests, and keep a rollback artifact. Patch/minor numbers and a compatible TypeScript build alone do not prove wire compatibility, preserved sessions, database compatibility or application authorization. HTTP-created live-page sessions are process-owned; a restart or rolling replacement does not migrate them automatically. Raw socket protocol versions are negotiated only when the route opts in, and application payload compatibility remains your contract.

## What was verified for the published package

Read-only registry inspection on **2026-08-30** reported `latest: 0.12.0`, with:

- `gitHead`: `6c95093c5e3b357772841f40c5371359dab0bf03`.
- SHA-512 integrity: `sha512-74AOoEmREkoPElYB9nalsN8nLfiPzw1Ap3WYEwxERJqoSGcfYAQhyfpAK2dOyLQtc+A+sAl9fFv0HMuIXWDjEg==`.
- Registry signatures present; **no `dist.attestations` field was returned**. Build provenance is therefore not claimed for this release.

An independently created temporary application installed that exact package with lifecycle scripts disabled and ran `npm audit signatures --json` using Node 22.21.0/npm 11.6.2 and the Windows system trust store. It exited successfully with `invalid: []` and `missing: []`. That checks the installed registry dependency tree's signatures/available attestations; an empty failure list does **not** mean every package has build provenance. This historical observation is not a verification of a future release or of the current unreleased source.

The commands above let you repeat the check. See npm's [signature and attestation verification](https://docs.npmjs.com/cli/v11/commands/npm-audit/) and [viewing provenance](https://docs.npmjs.com/viewing-package-provenance/) documentation for current verification behavior.

## Publishing provenance is a maintainer action

No publishing workflow or npm account setting is enabled by this guide. To add provenance to a future release, the maintainer must choose an authorized supported build/publish workflow, configure the correct repository identity and npm permissions, publish the exact tested artifact, and verify the resulting registry attestation afterward. A local `npm pack`, `gitHead`, checksum, badge or successful CI run is not a substitute for a verified attestation. Do not label older releases retroactively as provenance-verified.

npm describes the supported providers and identity requirements in [generating provenance](https://docs.npmjs.com/generating-provenance-statements/) and [trusted publishing](https://docs.npmjs.com/trusted-publishers/). Provenance provides origin/build evidence, not proof that source code is safe.

## Support and reporting boundaries

For ordinary bugs, provide a minimal reproducible project, exact Redweb/Node/npm/TypeScript versions, operating system, decorator mode, sanitized logs, and the failing HTTP/WebSocket sequence in the [issue tracker](https://github.com/lakam99/redweb/issues). Never include tokens, cookies, passwords, private database contents or customer traffic.

There is no paid support contract, response-time SLA or long-term backport policy established by these files. No private vulnerability contact is invented here. The repository inspection on 2026-08-30 reported no published security policy; the maintainer still needs to establish a private reporting channel and its handling policy before the project claims one. Do not disclose a suspected vulnerability or working exploit in a public bug report merely because that is the only linked tracker.
