# Redweb command-line tools

Use the version installed in your project (`npx --no-install redweb`) when troubleshooting an existing app. The tool reports a warning if its version differs from the project's installed Redweb version.

## Add pages, components, and socket routes

These commands are available in `redweb@0.13.2`.

```sh
npx --no-install redweb add page dashboard
npx --no-install redweb add component notifications
npx --no-install redweb add socket-route match
npx --no-install redweb add page account-settings --dry-run --json
```

Each addition writes a named-export TypeScript module and a `.test.cjs` file. Pages and owned components demonstrate server state plus an exposed increment action. The socket route demonstrates a validated `ping` handler returning `pong`, without an inner action dispatcher; extend its contract and register additional handlers as needed. For complete join/move/resume behavior, use the existing socket starter instead.

Run these commands in an existing project with Redweb declared as an installed runtime dependency and TypeScript installed. Declare/install `ws` explicitly (normally as a development dependency) for the generated network tests. Socket additions also require application-installed Zod as a runtime dependency. The generator reports missing prerequisites; it never installs dependencies or changes your manifest.

The default source location is the effective TypeScript `rootDir`, with `pages/`, `components/`, or `socket-routes/` beneath it. The default test directory is `test/`. An optional project directory follows the kind/name. Use `--config build.json`, `--source-dir features`, or `--test-dir checks` to select paths relative to that project. Names must be lowercase kebab-case, start with a letter, and contain at most 64 characters.

The command supports a single emitting TypeScript project using CommonJS, Node16 or NodeNext module settings and standard or legacy decorators. HTML additions require Redweb's automatic JSX runtime. Effective inherited configuration controls inclusion and emission; `--source-dir` chooses placement, **not** the compiler's `rootDir`. Ambiguous placement requires that option or an explicit `rootDir`. Project-reference roots, bundler-only pipelines, bundled output, disabled JavaScript emission, output outside the project, mismatched source/output package module types, and compiled test locations are rejected with guidance. Select the appropriate child project/configuration yourself rather than allowing the command to rewrite a monorepo.

The planner parses source and performs an in-memory TypeScript emit, without importing the application or writing build output. It checks the prospective module, its actual emitted path (including imported source dependencies), and whether an inferred root would relocate existing output. It rejects a test directory that TypeScript would compile when `allowJs` is enabled. This is not a replacement for a whole-project build or its existing tests. The virtual-file matcher uses a feature-checked TypeScript runtime API; unsupported compiler shapes fail explicitly rather than guessing glob behavior.

`--dry-run` writes nothing; `--json` returns a versioned report with planned/created paths, source/output/test paths, a named import, `registration.status: "pending"`, and explicit build/test argument arrays. Human commands are quoted for PowerShell on Windows and a POSIX shell elsewhere. Run the reported build and then its test from the project root. The test imports **only the generated artifact**, starts an isolated loopback server on a temporary port, and exercises a real HTTP/WebSocket action or message exchange. It never imports the existing application entry point.

Registration is intentionally your next step. Add a page to the existing `start([...])` list; add a socket route to the server's route list. For components, create an owned field (`widget = new NotificationsComponent()`) and render `{this.widget}`. Adjust the report's project-root-relative named import to the file where you use it; Node-compatible imports use the emitted `.js` extension. No imports, registration lists, package scripts, manifests, or configuration files are rewritten. Add the new test to your project's normal test command yourself; a generated test is not claimed to be automatically registered.

The shared writer rejects any destination conflict before writing and creates files exclusively. It rejects path escapes, unsafe portable names, case aliases and symbolic-link ancestors. Concurrent failures report which files were completed and which path was attempted; writing is not transactional and does not lock the filesystem tree. Existing application files are never overwritten.

## Initialize a project

Follow a [complete recipe's version-specific setup](GETTING_STARTED.md#start-with-a-complete-recipe). Its commands initialize a new directory, install the matching release or packed artifact, run tests, and start development. The unreleased channel requires the same tarball for initialization and installation; ordinary `npx redweb` does not select this checkout.

The initializer creates missing files only. It does not install dependencies, run package scripts, or validate existing source code. A message saying initialization completed means the file operation completed, not that a preserved existing project is valid.

`--template realtime|chat|site|socket|dashboard|http-ws` selects a complete runnable recipe. The default is `realtime`, a shared server-owned counter. `chat` includes the canonical reusable chat component, validated actions and its stylesheet; `site` has two non-live pages with a shared layout; `socket` exposes `/match` with separate `join`, `move`, and `resume` handlers, a shared Zod contract, and bounded in-memory sessions. The [dashboard](../recipes/dashboard/README.md) combines private live cards, SQLite persistence, explicit account provisioning, expiring sessions and account-wide sign-out. It requires Node 22.13+. The [http-ws starter](../recipes/http-ws/README.md) combines an HTTP health endpoint and a raw socket route on one explicitly owned listener. Each starter includes network tests, build/production instructions, and a development watcher. `--existing` and `--template` cannot be combined. The chat, socket and dashboard starters add Zod; Redweb itself does not require Zod or SQLite at runtime.

Doctor also checks the application's declared `engines.node` minimum (for example `>=22.13.0`). An incompatible runtime produces `PROJECT_NODE_UNSUPPORTED`. More complex ranges produce `PROJECT_NODE_UNCHECKED`, not a guessed success; npm remains responsible for its full engine-range interpretation. CI runs the dashboard acceptance tests on Node 22; older core compatibility jobs explicitly skip that recipe's runtime execution.

Run `npm test` for type checking, asset copying, and real HTTP/WebSocket tests on an ephemeral loopback port. `npm run dev` uses development-only Nodemon to rebuild and restart on changes to `src/` or `tsconfig.json`, enabling loopback-only browser refresh through its `REDWEB_DEV_REFRESH=1` environment. Clean HTML pages refresh automatically; detected edits keep the old document with a confirmation notice. This is not browser hot-module replacement or autosave. A type error prevents startup until corrected; outages alone do not trigger reload. See [development refresh](DEVELOPMENT.md#browser-refresh) for draft, connection, hostname and production boundaries. `npm run build` produces runtime code and assets in `dist/`; production needs that directory and installed runtime dependencies, not TypeScript or `src/`.

Templates come from `recipes/`, with common configuration/test helpers maintained once. The package gate extracts a tarball, generates every template, runs each generated `npm test`, then removes access to `src/` and runs the network tests again to validate production asset resolution.

For an existing application:

```sh
npx --no-install redweb init --existing --dry-run --json
npx --no-install redweb init --existing
npx --no-install redweb doctor --json
```

`--existing` creates only a missing `tsconfig.json`; it does not generate a new app, CSS, or package manifest. Adjust the generated source/output directories for your application. An existing `tsconfig.json` is never overwritten, even if it is incompatible.

`--dry-run` does not create files or directories. `--json` reports a versioned result with `operation`, `root`, `created`, `skipped`, and `planned`. The shared file-plan writer preflights all destinations, including planned directory/file conflicts, case aliases and nonportable segments such as Windows device names, alternate streams and trailing dots/spaces. It rejects symbolic links/junctions in the destination's ancestor chain, including above the chosen project root. Exclusive creation prevents overwriting a file created concurrently.

This is not a transactional installer or a lock on the filesystem tree. An operating-system error during writing can leave completed files, a partial attempted file, or new directories; the error reports completed writes and the attempted destination. Inspect those paths before retrying. Rerunning preserves existing files rather than repairing their contents. Another process must not rename or replace destination directories while generation runs.

## Diagnose without changing the project

```sh
npx --no-install redweb doctor --json
npx --no-install redweb doctor --port 8181
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
