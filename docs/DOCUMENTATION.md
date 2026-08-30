# Maintaining executable documentation

Edit the canonical Markdown guides listed in `docs/topics.json`, API/article/example metadata in `docs/reference.json`, or the maintained applications in `recipes/` and `examples/live-html/`. Do not edit `docs/generated.json` by hand. Reference entries can select a recipe file or a maintained snippet under `docs/snippets/` instead of duplicating source code.

`npm run generate:docs` builds a deterministic, version-labelled catalogue containing topic Markdown, full public TypeScript declarations, a compact `llms.txt`, and complete recipe files. Recipe files come from the exact same `projectFiles()` implementation used by `redweb init`. Chat continues to reuse the canonical component example. Markdown code fences expand when necessary so nested Markdown/readme examples remain intact.

The README's marked realtime and HTTP/WebSocket application blocks are generated from those same recipes. Its setup block uses the same channel-aware commands as recipe pages, including the version notice, directory change, and matching artifact for both initialization and installation. Other README prose is preserved. Package/test preflights reject stale, missing or duplicate blocks.

The generated catalogue is included in the npm tarball but is not loaded by the HTTP/WebSocket runtime. A site or a separate read-only documentation adapter can consume the same JSON. Each page has a stable ID, versioned Markdown URL, source path, summary, and SHA-256 content hash. Recipe pages also contain their complete file lists. Hashes identify content, not package authenticity or signatures.

API articles retain their ELI5 explanations, practical examples, walkthroughs, methods, and production cautions. Each API section and capability example also has an individual Markdown page. The shared HTTP/WebSocket example comes from the complete `http-ws` starter, exercised against both the checkout and packed package; it uses one listener with separate route and message-handler classes and the shared entrypoint lifecycle helper. Historical release snapshots retain their original source/examples.

## Version boundaries

Development output uses `/docs/reference/unreleased/`. Its package metadata version is informational: it does not claim that the published package of that version contains new behavior. Development recipe commands explicitly require the matching tarball for both initialization and installation.

For a release, first update the package version and move the pending changelog entries into that version's section. Run `npm run generate:docs -- --release`. This creates a snapshot in `docs/releases/<version>.json` and updates the current catalogue. An existing release snapshot cannot be overwritten with different content. Commit the snapshot with the release. These commands do not publish npm or deploy the website.

`npm test` and `npm pack` check generated content for drift. `--check` preserves the existing catalogue's channel rather than silently turning release documentation into development documentation. Run `npm run generate:docs` explicitly to start documenting the next unreleased increment.

## Verification scope

Unit tests check determinism, version labels, links, hashes, fences, and identity with the initializer's file plan. Real integration tests extract application files from the actual Markdown code fences, compile them, execute the shipped HTTP/WebSocket tests, remove source from the deployed location, and rerun those tests. The packed-package gate repeats this against the extracted tarball, including checking that packed docs match packed source.

Complete recipe pages are executable programs. Topic/API snippets remain explanatory and are not all independently runnable; public declarations are separately covered by the package's type-test suites. Do not claim that every illustrative snippet or generated browser branch is covered by library coverage metrics.

Website export, published-version availability, read-only MCP access, and fresh-agent benchmarks have separate acceptance gates. Generating this catalogue alone does not complete those requirements or guarantee agent discovery.

The optional MCP integration reads this same catalogue rather than regenerating or duplicating documentation. See [agent access setup and limits](AGENT_ACCESS.md); its dependencies and tests are separate from the normal library runtime.

## Website consumer

The separate Redweb site imports this catalogue through `npm run sync:docs -- /absolute/path/to/redweb`; after a matching release is installed, `npm run sync:docs` reads that package by default. It does not import application runtime code from the development checkout. Its committed generated content allows independent clean-checkout builds.

The site derives its existing API articles, examples, homepage snippets, versioned guides, raw recipe downloads, and agent-readable indexes from this source. Release snapshots are retained across imports rather than replaced by the newest package's snapshot set. Import preflight and atomic site-build replacement are separate safeguards. Website tests exercise real imports, builds, and HTTP requests for current and historical versions; publishing npm and deploying hosting remain separate actions.
