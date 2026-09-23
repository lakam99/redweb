# Security defaults and application responsibilities

Redweb applies transport boundaries; it cannot decide who may read a game room, make a move, or access an account. Authenticate and authorize those actions in the application, use HTTPS/WSS, and test the deployed proxy configuration.

## Current defaults

- WebSocket upgrades with an `Origin` header require the same scheme and host as the request. Clients without `Origin` remain possible, so this is browser cross-site protection, not authentication. Configure `admission.origins` for intentionally cross-origin sockets; an explicit policy replaces the default check.
- Ordinary HTTP services do not emit wildcard CORS headers. Configure `corsOptions` only for origins that should read responses. CORS is not authorization.
- A cookie-bearing unsafe HTTP request needs a matching `Origin` or `Sec-Fetch-Site: same-origin`; cross-site requests and requests with neither signal are rejected. Same-origin POSTs remain valid. Services must still authorize the account and validate input. Apps using a trusted TLS reverse proxy should configure Express proxy trust and verify forwarded headers are set by that proxy, not clients.
- WebSocket frames have a 1 MiB default maximum; override `websocketOptions.maxPayload` only when a route genuinely needs more. Application-level payload and rate limits remain useful.
- An empty `SocketServer` route list opens no WebSocket endpoint. Register an echo/demo route explicitly if desired.
- A route bound to a rendered page requires a valid page session for upgrades. Put separately authenticated raw clients on a separate socket route.
- Rendered pages set `X-Frame-Options: SAMEORIGIN`. Uploaded client filenames are reduced to safe basenames; applications must still generate their own storage keys and enforce upload size, type, and destination policy.
- A second connection from the same network address cannot evict an existing client merely because `allowDuplicateConnections` is false. Intentional replacement requires an explicitly configured client-key/proxy policy. For public multiplayer, use authenticated identities rather than addresses as players.
- Static public paths do not serve through a symlink outside their configured root. Keep untrusted users from modifying a public directory while the server runs; a filesystem race is outside this request-time check.

Protected room grants persist until explicit leave, disconnect, replacement, clear, or shutdown. Changing a policy alone does not revoke an existing membership: invalidate credentials, then remove affected connections with `leaveRoom`/`leaveAll`. See [room authorization](ROOM_AUTHORIZATION.md).
