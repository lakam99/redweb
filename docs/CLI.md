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

`--template realtime|chat|site|socket|dashboard` selects a complete runnable recipe. The default is `realtime`, a shared server-owned counter. `chat` includes the canonical reusable chat component, validated actions and its stylesheet; `site` has two non-live pages with a shared layout; `socket` exposes `/match` with separate `join`, `move`, and `resume` handlers, a shared Zod contract, and bounded in-memory sessions. The [dashboard](../recipes/dashboard/README.md) combines private live cards, SQLite persistence, explicit account provisioning, expiring sessions and account-wide sign-out. It requires Node 22.13+. Each starter includes network tests, build/production instructions, and a development watcher. `--existing` and `--template` cannot be combined. The chat, socket and dashboard starters add Zod; Redweb itself does not require Zod or SQLite at runtime.

Doctor also checks the application's declared `engines.node` minimum (for example `>=22.13.0`). An incompatible runtime produces `PROJECT_NODE_UNSUPPORTED`. More complex ranges produce `PROJECT_NODE_UNCHECKED`, not a guessed success; npm remains responsible for its full engine-range interpretation. CI runs the dashboard acceptance tests on Node 22; older core compatibility jobs explicitly skip that recipe's runtime execution.

Run `npm test` for type checking, asset copying, and real HTTP/WebSocket tests on an ephemeral loopback port. `npm run dev` uses development-only Nodemon to rebuild and restart on changes to `src/` or `tsconfig.json`; it does not provide browser hot-module replacement. A type error prevents startup until corrected. `npm run build` produces runtime code and assets in `dist/`; production needs that directory and installed runtime dependencies, not TypeScript or `src/`.

Templates come from `recipes/`, with common configuration/test helpers maintained once. The package gate extracts a tarball, generates every template, runs each generated `npm test`, then removes access to `src/` and runs the network tests again to validate production asset resolution.

For an existing application:

```sh
npx redweb init --existing --dry-run --json
npx redweb init --existing
npx redweb doctor --json
```

`--existing` creates only a missing `tsconfig.json`; it does not generate a new app, CSS, or package manifest. Adjust the generated source/output directories for your application. An existing `tsconfig.json` is never overwritten, even if it is incompatible.

`--dry-run` does not create files or directories. `--json` reports a versioned result with `operation`, `root`, `created`, `skipped`, and `planned`. The shared file-plan writer preflights all destinations, including planned directory/file conflicts, case aliases and nonportable segments such as Windows device names, alternate streams and trailing dots/spaces. It rejects symbolic links/junctions in the destination's ancestor chain, including above the chosen project root. Exclusive creation prevents overwriting a file created concurrently.

This is not a transactional installer or a lock on the filesystem tree. An operating-system error during writing can leave completed files, a partial attempted file, or new directories; the error reports completed writes and the attempted destination. Inspect those paths before retrying. Rerunning preserves existing files rather than repairing their contents. Another process must not rename or replace destination directories while generation runs.

## Diagnose without changing the project

```sh
npx redweb doctor --json
npx redweb doctor --port 8181
```

The current checks are explicit in the result's `checks` array:

- Node version against the package's current minimum.
- Redweb installation in the project or its ancestor workspace's `node_modules`.
- Difference between the invoked CLI and installed library versions.
- Installed TypeScript (5 or newer) and a root `tsconfig.json`.
- Effective inherited JSX runtime configuration, syntax/config errors, and legacy-decorator settings.
- Declared page CSS/templates and duplicate page/route/handler registrations in statically readable TypeScript source.
- Literal `rw-click`/`rw-submit` names against the owning page/component's public `@action()` methods.
- Optional temporary bind to `127.0.0.1` to check a TCP port, immediately released on success.

Each finding includes `code`, `severity`, `file`, `message`, and `suggestion`. Source findings also include one-based `line` and `column` when attached to a specific declaration. Error findings produce exit status 1; warnings do not. JSON diagnostic reports go to stdout. Invalid CLI arguments and filesystem failures go to stderr, with exit status 1. `--help` and `--version` require no project.

Doctor loads the installed TypeScript compiler to read configuration and parse source, but never imports or executes the application's modules. It does not perform a full type check, emit files, run application functions/plugins, or apply repairs. These checks do not prove full application correctness or validate every package's semver range. Port availability is a point-in-time loopback check, not a reservation or a test of an external proxy. Dependency discovery currently targets conventional npm-style `node_modules` installations.

## Source checks and their boundaries

The `source` JSON object reports inspected file count, registration-group count, `mode: "static-source"`, and the number of unresolved/limited warnings. It is `null` when configuration or compiler problems prevent source inspection. `checks` lists `source-assets`, `source-routes`, `source-handlers`, and `source-actions` only when the source reader ran.

Supported syntax includes named/namespace TypeScript imports from Redweb, imported local constants, literal strings, constant arrays/objects, known spreads, and simple handler/route constructors. The reader starts with the configuration's source files and follows relative source imports within the project. Declaration files and dependency implementation code are not inspected; an explicitly configured source outside the project can be read, but additional outside-project imports are not followed automatically.

Duplicate paths are checked **within one registration group**, not across independent servers. The reader recognizes `start`, `exportStatic`, `site.export`, `LiveHtmlServer`, `SocketServer`, and `SecureSocketServer`. Handler names are checked in a `SocketRoute` configuration, including classes based on `BaseHandler` and contract handler factories. It does not evaluate arbitrary factory calls, CommonJS destructuring imports, custom boot wrappers, dynamic route additions, or application control flow.

Page assets are checked for registered pages using their decorator's source directory, the owning site's shared-CSS directory, or a statically known explicit `templateRoot`. Shared stylesheet names are deduplicated with site-root precedence, like the runtime. `__dirname` is interpreted as the source directory for this source-only check. Missing assets, directory paths, path traversal, and links escaping the effective root are reported. This does **not** verify compiled/deployed asset copies: keep the starter's build/network tests and production checks.

| Code | Meaning |
| --- | --- |
| `TYPESCRIPT_UNSUPPORTED` | Upgrade the project's compiler to TypeScript 5 or newer. |
| `SOURCE_SYNTAX`, `SOURCE_UNREADABLE` | A configured source could not be parsed or read. |
| `DUPLICATE_ROUTE`, `DUPLICATE_HANDLER` | A readable registration repeats a path or message type. |
| `ASSET_UNAVAILABLE`, `ASSET_NOT_FILE`, `ASSET_OUTSIDE_ROOT` | A declared asset cannot be loaded from its effective source root. |
| `SOURCE_UNRESOLVED` | Dynamic, mutated, escaped, or unsupported source cannot be determined safely. |
| `SOURCE_LIMIT` | Source count/size or expression expansion exceeded the inspection budget. |
| `ACTION_NOT_EXPOSED` | A literal binding has no matching public decorated instance method on its statically known owner. |
| `ACTION_REFERENCE_INVALID` | The literal action name is empty, reserved, missing, or longer than 128 characters. |
| `ACTION_REFERENCE_UNRESOLVED` | Action names, render output, method exposure, or component ownership cannot be established by the supported source checks. |

### Repair an action binding

If a button says `<button rw-click="saev">Save</button>` but the class exposes `@action() save()`, doctor reports `ACTION_NOT_EXPOSED` at the binding. Correct the name, run doctor again, then run `npm test`. Doctor never calls the action or executes the renderer to discover it.

Action inspection recognizes decorator aliases, literal names (including imported string constants), inherited methods and overrides, method/function-field renderers, conditional literal returns, and returned JSX/`html` constants. Literal HTML templates use the runtime's lexical tag scanner, ignoring comments and raw-text bodies. External templates are inspected for registered pages at their source asset root and have a separate 1 MiB limit. Page and component owners are checked separately.

This is deliberately not a JavaScript evaluator or a full template type checker. JSX spreads (including constant objects), custom JSX wrappers, explicit component-scope attributes, HTML entities in action names, interpolated/dynamic HTML, unavailable inherited implementations, custom decorators, and potentially replaced instance methods produce warnings where encountered. Arbitrary function calls, dependency renderers and all runtime-produced nested markup cannot be proved by source inspection. A warning is a request for application/browser verification, not a hidden success. Keep real tests for reusable helpers, scoped components and dynamic output even when doctor exits successfully.

`const` is not treated as proof that an array/object is immutable. Mutated aggregates, aliases that escape into unknown calls, runtime option spreads, custom class decorators, and constructor initialization that can overwrite names/paths produce warnings rather than guessed facts. A normal starter exposes runtime option overrides, so its `templateRoot` may correctly produce an unresolved warning. Green exit status means **no errors among the selected checks**, not that warnings were resolved or the application was proved correct.

Source selection is limited to 256 files and 8 MiB; expression reading is limited to 50,000 operations and 4,096 entries per expanded array. Cycles and repeated spreads cannot expand without limit. The doctor is a read-only diagnostic, not a sandbox for untrusted installed compiler code or a substitute for tests.

The remaining release work is tracked in [the release acceptance checklist](AGENT_READY_ACCEPTANCE.md).
