## Socket starter

This is a WebSocket service, not an HTML page. Connect to `ws://localhost:8181/match?redwebVersion=1`.
The URL selects the match route; `type` selects its individual `Join`, `Move`, or `Resume` handler.
There are no socket decorators or secondary `message.action` dispatchers.

`src/contract.ts` declares the wire payloads once using Zod, a Standard Schema validator. Both the server and a bundled browser/Node client can import it for runtime validation and inferred TypeScript types:

```ts
import { match } from './contract';

const socket = new WebSocket('ws://localhost:8181/match?redwebVersion=1');
const client = match.client(socket);
socket.addEventListener('open', () => {
    client.send('join', { name: 'Ada' }).catch(console.error);
});
socket.addEventListener('message', async event => {
    try { console.log(await client.parse(event)); }
    catch (error) { console.error(error); }
});
```

The initial `state` response contains `{ session, name, x, y }`. Send `move` with `{ x: 7, y: -3 }` to change your server-owned position; send `resume` with `{ session }` on a new connection to recover it. Messages are processed in order on each connection. The client wrapper validates messages; it does not open or reconnect the WebSocket for you. Use WSS outside local development.

`npm test` opens real sockets and checks independent players, server-side moves, disconnect/resume, client validation, and server rejection of a malformed raw message. The starter also passes with the original source directory unavailable after building.

### Boundaries

- This demonstrates session-aware dispatch, not a complete authoritative game simulation. Coordinates are bounded integers; applications must enforce their own movement/rate/game rules.
- The random session ID is a bearer credential. Anyone holding it can resume that player and replace its previous connection. Keep it private; do not broadcast the `state` response to other players. Add account authentication and bind sessions to authenticated identity for production.
- Sessions are in memory, local to this server, capped at 100, and expire 30 seconds after disconnect. Server restart loses them. This is not persistent storage or a multi-instance session system.
- Calling `join` or `resume` while already joined is rejected. Movement before joining and unknown/expired sessions are rejected. Application failures currently use the protocol's sanitized `HANDLER_FAILED` error.
- Invalid contract payloads produce `INVALID_PAYLOAD` and close that connection with code 1008. The contract's `state` type is server output; it has no client-callable handler.
- Transport and heartbeat bounds are illustrative; tune and load-test them for your deployment. Zod belongs to this starter, not Redweb's runtime dependencies.
