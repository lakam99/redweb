# Share typed WebSocket contracts

Build a `/match` service with independent join, move and resume handlers. A shared schema validates payloads and supplies TypeScript types to both sides. Use this when you need a raw socket protocol, such as a game client or a custom realtime client, rather than a server-rendered page.

## Explain it like I'm five

The URL is the room's address. A message's `type` tells the receptionist which person should handle it. The shared contract is the form that says what information that person needs. Checking the form before handing it over prevents a movement handler from receiving a name where a coordinate should be.

## Follow the design

1. [The contract](../../recipes/socket/contract.ts) declares `join`, `move`, `resume` and `state` once. It is safe to import into a browser bundle because it does not import the server application.
2. [The route](../../recipes/socket/app.tsx) binds `/match`, enables the contract protocol and registers `Join`, `Move` and `Resume`. There is no socket decorator layer and no inner `message.action` switch.
3. The handlers below receive parsed payloads. `Join` creates an in-memory player session, `Move` changes its server-owned coordinates, and `Resume` reclaims it using a private bearer token.
4. Each sends a validated `state` response. A client uses `match.client(socket)` to send and parse typed messages. That wrapper does **not** open or reconnect its transport; the application creates the WebSocket first.

Connect to `ws://localhost:8181/match?redwebVersion=1` during local development. Follow the [complete recipe's client example](../../recipes/socket/README.md) for opening a transport and handling responses; use WSS outside local development. The [contract reference](../SOCKET_CONTRACTS.md) documents wire envelopes, validation and failure behavior.

## Check that it works

Join with two independent clients, move one, then disconnect and resume it with its session token. The other player's state must remain independent. Send invalid coordinates and a malformed raw message to verify both client and server checks. The [real-socket acceptance test](../../recipes/socket/app.test.cjs) covers those sequences, including server rejection that bypasses client validation.

## This is not a complete game backend

The example bounds coordinate values; it does not prove a move obeys your game's speed, turn or collision rules. Add authoritative game rules and authentication. Keep session tokens private: possession permits resume and connection takeover. Sessions are capped at 100, expire 30 seconds after disconnect, and are lost on restart. They are not a durable or cross-worker identity store.

Per-connection ordering is not exactly-once delivery. After a disconnect, a client may not know whether its last action completed; reconcile state before retrying side effects. Choose transport limits from measured load and read [operations](../MULTIPLAYER_OPERATIONS.md) and [runtime retry boundaries](../RUNTIME_DIAGNOSTICS.md).
