# Private rooms without custom socket plumbing

A room is a list of subscriptions, not an identity provider. Authentication answers **who is this connection?** A room policy answers **may that identity enter this room?** Only a literal `true` grants entry.

Configure `rooms.authorize(context, roomId)` on a `SocketRoute`, then use `await socket.enterRoom(roomId)` in the corresponding handler. URL paths still choose routes and message `type` still chooses handlers; there is no second action dispatcher or socket decorator system.

## A complete shared-identity example

The [runnable page and room example](snippets/room-access.tsx) uses one authentication function for the rendered page and `/team` socket route. It generates a fresh local-demo bearer credential on each run, has a protected page, exposes a `join` handler, and revokes page sessions and room memberships together. Its exact source is also shown on the generated examples page. The library's package gate compiles it with both standard and legacy decorators, removes its TypeScript source, and verifies real HTTP/WebSocket access, publication, and revocation against the extracted package.

To run locally, save that file as `src/app.tsx` in an initialized realtime starter, then run `npm run build` and `npm start`. Send the printed `Authorization: Bearer …` header to `http://127.0.0.1:8181/` or `ws://127.0.0.1:8181/team`; the socket accepts `{"type":"join"}`. The existing starter's counter tests describe a different application, so do not treat them as acceptance tests for your modified app. Never publish the printed token or use this demonstration as a production credential service. A normal browser WebSocket cannot set an Authorization header; use your application's secure cookie/session integration for a browser product. The [dashboard recipe](../recipes/dashboard/README.md) demonstrates real cookies, persistent accounts and sign-out.

## Entry, publication, and revocation

- `await socket.enterRoom(id)` and `await route.rooms.enter(id, socket)` perform the bounded policy check and then commit membership synchronously. They resolve to `false` when the connection is no longer eligible or a membership limit prevents entry.
- Existing `socket.joinRoom(id)` and `route.rooms.join(id, socket)` remain synchronous for unprotected rooms. They throw for protected rooms, with guidance to use asynchronous entry; they cannot bypass the guard. Use `enterRoom` for new guarded application code.
- Denial, timeout, cancellation, and authorization capacity exhaustion reject entry with safe diagnostic codes. The normal handler boundary sends these to the client without disconnecting it. Broken policies remain sanitized application failures, not disguised permission denials.
- On protected rooms, `socket.roomBroadcast` and `rooms.broadcastFrom(socket, …)` require the sender to be a current, live member. That is a membership check, **not** an application-specific write-role policy. Validate and authorize actions such as moderator announcements separately.
- `route.rooms.broadcast` is privileged server publication. Do not expose a client-selected room through it without your own authorization. It publishes only to current eligible members and rechecks membership after serialization.
- A grant lasts until leave, disconnect, replacement, clear, or shutdown. Changing a policy does not automatically unsubscribe existing readers. Invalidate credentials/permissions first, then call `leaveRoom`, `rooms.leave`, or `rooms.leaveAll` on affected connections. Those operations also cancel pending entry. A late policy completion cannot silently rejoin the connection.
- `leaveAll` removes all of that connection's memberships before firing policy cancellation callbacks. `clear` removes every membership before cancellation. Nested cancellation/clear cannot reopen entry while the outer operation is still cancelling work.

Redweb's `LiveHtmlServer.revoke(principal)` manages its own page lifetimes; it does not automatically revoke custom raw socket routes. The complete example explicitly invalidates its shared credential, removes the raw route's memberships, then revokes page sessions. Application storage and cross-process invalidation remain application-owned.

## One request-context shape

`RequestContext` and `RedWebRequest` are shared public types. Page callbacks receive `LivePageRequestContext`; enabled raw socket features expose `socket.context` as `RedWebConnectionContext`. Both provide a selected request snapshot, `principal`, and cancellation `signal`.

The request snapshot is captured before raw-route admission code runs. It contains path, URL, method, headers, params, query, body and a case-insensitive `get(name)` helper—no HTTP response, transport, or framework object graph. Its data is deeply frozen and bounded to 64 KiB/16 nesting levels. Raw upgrade paths and repeated query parameters are parsed from the URL. It is not an Express request, and forwarded headers do not become trusted identities automatically.

Socket identity/request/protocol references cannot be replaced; application `metadata` and resumable `session` fields remain mutable. Existing raw admission object identities remain supported and application-owned, not deeply frozen by Redweb. Page identities retain their existing primitive identity contract. Never derive a trusted identity from a client message's `principal` field or mutable application metadata.

Each relevant raw connection has its own signal, cancelled on disconnect, replacement, or route draining. An operation policy receives a separate bounded signal that also cancels on leave or its deadline. Socket context remains optional when all features requiring it are disabled. In Live HTML callbacks, use the supplied callback context for the application identity: the underlying transport's internal page-session principal is not that callback identity.

## Resource limits and failure meanings

Protected rooms retain the existing room/member/name limits and add:

| Option | Default | Meaning |
| --- | --- | --- |
| `authorizationTimeoutMs` | 5000 | Maximum time to wait for one policy. |
| `maxPendingAuthorizations` | 128 | Underlying policy work across the registry. |
| `maxPendingPerConnection` | 4 | Underlying policy work for one connection. |

These options require `authorize`. Concurrent pending requests for the same connection/room share one check. No room or membership is reserved while permission is pending; final insertion rechecks all capacities. Timed-out or cancelled policy work stays charged until the **actual application promise settles**, so an uncooperative policy cannot spawn unlimited background work. Honor the signal and use bounded downstream I/O; policies that never settle can exhaust capacity until corrected/restarted. JavaScript's synchronous execution cannot be preempted.

`ACCESS_DENIED`, `ACCESS_TIMEOUT`, `ACCESS_CANCELLED`, and `ACCESS_CAPACITY` indicate no membership was committed by that failed entry. They do not assert that an external policy had no side effects. Protocol routes return the standard error envelope and request ID; unversioned routes return `{ code, error }`. A policy exception becomes sanitized `HANDLER_FAILED` and follows the normal application-error close behavior. Nothing automatically retries entry or promises exactly-once application delivery.

Use HTTPS/WSS, trusted origins for browser credentials, real session expiry, input limits, and persistent application authorization before public deployment. Process-local rooms and grants do not become distributed merely because a socket route has a distribution adapter.
