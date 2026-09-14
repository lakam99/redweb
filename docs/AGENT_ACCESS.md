# Optional Redweb documentation MCP adapter

Read-only, local stdio access to one explicit Redweb documentation catalogue. This integration is kept separate from the Redweb package: ordinary HTTP/WebSocket servers do not install or import its SDK dependencies. It currently runs from this checkout and is private/unpublished; do not assume a public npm adapter exists.

## Set up

Requires Node 22 or newer and a Redweb source checkout containing `integrations/docs-mcp`. From the checkout root, run `npm ci --prefix integrations/docs-mcp`, then configure your MCP host to launch `node` with these arguments:

```json
{
  "mcpServers": {
    "redweb-docs": {
      "command": "node",
      "args": [
        "/absolute/path/to/redweb/integrations/docs-mcp/src/main.mjs",
        "/absolute/path/to/redweb/docs/generated.json"
      ]
    }
  }
}
```

Use actual absolute paths, including a known Node executable path when the host does not inherit your PATH. Host configuration formats differ; this shows the common stdio shape, not automatic installation into any editor. Choose `docs/releases/<version>.json` instead to serve an immutable release snapshot. The source can also be the catalogue in an extracted Redweb npm tarball; application source is not executed or needed.

## Tools

- `search_docs`: bounded lexical search of titles, summaries, and Markdown; returns up to 20 results, with stable IDs and the selected version.
- `read_doc`: retrieve Markdown by exact ID; also lists any embedded recipe filenames.
- `read_recipe_file`: retrieve one of those embedded files, not a filesystem path.

Reads return up to 16,000 UTF-16 characters. Follow `nextOffset` until it is null and concatenate `text` to obtain the exact content. A page's Markdown URL is relative to the Redweb documentation site. Every response includes `channel` and `packageVersion`; `unreleased` does not assert that those features exist in the published package carrying that metadata version.

The adapter reads its explicitly selected catalogue once at startup. It performs no network requests, writes, installs, application execution, or tool-driven filesystem access. Restart it to select updated content. Treat the selected local package/catalogue as trusted input: hashes detect inconsistent content, not authenticity. Startup rejects catalogues whose reported size exceeds 16 MiB; that preflight is not a sandbox against concurrent filesystem mutation. Its SDK transport limits incoming stdio messages to 64 KiB. This is not a public multi-tenant MCP service.

Use `npm run verify:docs:mcp` from the checkout root for unit checks and actual MCP client/server subprocess integration, including both legacy initialization and the pinned 2026-07-28 protocol. The package test requires npm and `tar`; it extracts both package tarballs and installs the adapter's production dependencies from npm's local cache. Run `npm ci --prefix integrations/docs-mcp` first to populate that cache. Coverage applies to this adapter's source, not the SDK or Redweb's browser runtime. Enabling an adapter improves access to documentation; it does not guarantee that an agent discovers or chooses Redweb.
