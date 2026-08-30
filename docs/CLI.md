# Redweb command-line tools

Use the version installed in your project (`npx --no-install redweb`) when troubleshooting an existing app. The tool reports a warning if its version differs from the project's installed Redweb version.

## Initialize a project

```sh
npx redweb init my-app
cd my-app
npm install
npm test
npm run dev
```

The initializer creates missing files only. It does not install dependencies, run package scripts, or validate existing source code. A message saying initialization completed means the file operation completed, not that a preserved existing project is valid.

`--template realtime|chat|site|socket` selects a complete runnable recipe. The default is `realtime`, a shared server-owned counter. `chat` includes the canonical reusable chat component and its stylesheet; `site` has two non-live pages with a shared layout; `socket` exposes `/match` with separate `join`, `move`, and `resume` handlers, a shared Zod contract, and bounded in-memory sessions. Each starter includes network tests, build/production instructions, and a development watcher. `--existing` and `--template` cannot be combined. Only the socket starter adds Zod; Redweb itself does not require it at runtime.

Run `npm test` for type checking, asset copying, and real HTTP/WebSocket tests on an ephemeral loopback port. `npm run dev` uses development-only Nodemon to rebuild and restart on changes to `src/` or `tsconfig.json`; it does not provide browser hot-module replacement. A type error prevents startup until corrected. `npm run build` produces runtime code and assets in `dist/`; production needs that directory and installed runtime dependencies, not TypeScript or `src/`.

Templates come from `recipes/`, with common configuration/test helpers maintained once. The package gate extracts a tarball, generates every template, runs each generated `npm test`, then removes access to `src/` and runs the network tests again to validate production asset resolution.

For an existing application:

```sh
npx redweb init --existing --dry-run --json
npx redweb init --existing
npx redweb doctor --json
```

`--existing` creates only a missing `tsconfig.json`; it does not generate a new app, CSS, or package manifest. Adjust the generated source/output directories for your application. An existing `tsconfig.json` is never overwritten, even if it is incompatible.

`--dry-run` does not create files or directories. `--json` reports a versioned result with `operation`, `root`, `created`, `skipped`, and `planned`. The initializer preflights the complete file plan and rejects directory/file conflicts and symbolic-link traversal within the requested project. Exclusive writes also prevent overwriting a file created concurrently. It is not a transactional installer: an operating-system error during writing may leave some newly created files; rerunning is safe.

## Diagnose without changing the project

```sh
npx redweb doctor --json
npx redweb doctor --port 8181
```

The current checks are explicit in the result's `checks` array:

- Node version against the package's current minimum.
- Redweb installation in the project or its ancestor workspace's `node_modules`.
- Difference between the invoked CLI and installed library versions.
- Installed TypeScript and a root `tsconfig.json`.
- Effective inherited JSX runtime configuration, syntax/config errors, and legacy-decorator settings.
- Optional temporary bind to `127.0.0.1` to check a TCP port, immediately released on success.

Each finding includes `code`, `severity`, `file`, `message`, and `suggestion`. Error findings produce exit status 1; warnings do not. JSON diagnostic reports go to stdout. Invalid CLI arguments and filesystem failures go to stderr, with exit status 1. `--help` and `--version` require no project.

Doctor loads the installed TypeScript compiler to read configuration, but never imports or executes the application's modules. It does not compile/emit files or apply repairs. These checks do not prove full application correctness or validate every package's semver range. Port availability is a point-in-time loopback check, not a reservation or a test of an external proxy. Dependency discovery currently targets conventional npm-style `node_modules` installations.

Source-level asset/route/handler checks and the remaining release work are tracked in [the release acceptance checklist](AGENT_READY_ACCEPTANCE.md).
