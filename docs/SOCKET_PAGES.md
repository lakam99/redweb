# Server-side TSX for custom socket routes

Added in Redweb 0.15.0 with redweb-client 0.3.0, installed automatically by Redweb.
Earlier Redweb 0.14.0/client 0.2.0 packages do not provide this extension.
Contributors editing both packages can use the optional npm-link workflow in the repository's `docs/CLIENT_DEVELOPMENT.md`.

A live page can attach to a registered custom `SocketRoute` using
`@page('/', { socket: MatchRoute })`. There is no new view class, no second renderer,
and no application-specific browser module. Its connection carries ordinary typed
commands and reserved `redweb:*` rendering/completion messages.

## Typed controls

`defineSocketContract(...).handler(type, callback)` still returns a handler class.
That class can now be used as a JSX binding:

```tsx
<form rw-submit={Join}>
    <input name="room" required />
    <button>Join room</button>
</form>

<button rw-click={Move.with({ cell, revision })}>Move</button>
```

`.with()` snapshots JSON data; it never invokes the handler during rendering.
TypeScript checks the payload's input type. Incoming wire data is independently
validated by the contract, including asynchronous schemas. Form fields merge over
the bound object payload. A click sends its bound payload, or an empty object when
none was supplied. Bound values are untrusted inputs, not server-held secrets or
authorization capabilities. Do not embed private data in them.

Bindings are server-owned identities, not arbitrary function closures. Rendering
rejects references to handlers absent from the attached route, even if a different
handler has the same message name. Existing string `rw-click`/`rw-submit` actions
remain unchanged on ordinary live pages. Socket-bound pages dispatch only their
custom route handlers; do not mix local `@action()`/`rw-bind` commands into them.

## Server-owned client state

On an attached connection, `socket.page(PageClass)` returns that connection's
concrete page after checking its class, ownership and active lifetime:

```ts
if (socket.page) {
    socket.page(GamePage).game = games.snapshot(room, account);
}
```

Assigning `@state()` fields uses the existing reactive renderer and keyed TSX.
Raw connections have no `page` accessor and keep their existing socket protocol.
Shared domain state belongs in a room/service; each private page receives only its
authorized perspective. Components remain ordinary page-owned Redweb components.

## Configuration and boundaries

Register the route once in `defineApp({ pages: [GamePage], sockets: [MatchRoute] })`.
Socket-bound pages must be live, connection-scoped and render TSX. Their route must
support protocol version `1` with the default `redwebVersion` query parameter and
explicitly allow duplicate connections (independent tabs). `redweb:*` handler names
are reserved. Page-enabled routes use ordered, bounded message dispatch and track
in-flight work for shutdown. JSON commands are supported; binary input is rejected
on page-attached connections. Raw route connections retain binary handling.

The adapter preserves route admission, origin and placement policies, then checks
the page token, exact route, page identity and page origin. Use `authenticate` for
page identity and `authorize` for current permissions/session validity. Authorization
runs before commands, again after contract validation, and before render publication.
Revocation and disconnect cancel ownership even when validation is still running.
The page token is not a substitute for credentials.

Initial page attachment completes before custom initialization hooks or commands.
Do not call page commands from initialization hooks expecting those hooks themselves
to finish first. Each page owns its connection; the same token cannot attach twice.

Reconnect reauthenticates, invokes existing `connected()` hooks, and sends a fresh
rendering snapshot. Game-seat recovery remains in that server hook. Commands are
not queued or replayed. Page-session expiration requires a reload; game persistence
is not provided by page retention.

## Completion and client runtime

After successful handler dispatch, Redweb sends a correlated `redweb:result`.
The generated runtime waits specifically for that terminal type or a protocol error,
not intermediate correlated progress messages. Direct client users can opt into
the same behavior using `client.request(type, payload, { responseType })`; omitting
the option preserves the existing any-correlated-response behavior.

For an expected application rejection, send a safe correlated error with
`socket.sendProtocolError('GAME_REJECTED', safeMessage, { requestId })` and return
`false` from the handler. Only literal `false` declines successful dispatch;
`undefined` remains success. The browser shows error feedback, preserves the form,
and keeps its connection usable. Returning `false` without sending a correlated
reply leaves a requesting client waiting until its deadline. Unexpected exceptions
retain the existing sanitized handler-failure behavior and close the connection.

This browser support lives in redweb-client's existing feedback/transport modules.
The server still owns validation, authorization, game revisions, room fan-out and
private rendering. Disabled controls are presentation, never permissions.
