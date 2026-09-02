# Redweb docs MCP

Optional, private/unpublished stdio adapter. It is not a dependency of Redweb's HTTP/WebSocket runtime.

From this directory:

```sh
npm ci
npm start -- /absolute/path/to/redweb/docs/generated.json
npm test
```

The adapter reads only that nominated catalogue; tools search and retrieve its embedded documents and recipe files. It does not execute recipes, write files, or access network services. Requires Node 22+, with npm and `tar` for the package tests.

The canonical setup, host configuration, limits, and verification guide is `docs/AGENT_ACCESS.md` in the Redweb checkout or extracted Redweb package. No npm publication or automatic host installation is implied.
