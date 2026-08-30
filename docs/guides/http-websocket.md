# Serve HTTP and WebSockets on one port

Build an Express endpoint and a raw WebSocket route on the same Node listener. Use this when an existing HTTP application needs socket endpoints without a second port or a separate web framework. This guide demonstrates server composition, not a rendered chat interface.

## Explain it like I'm five

Imagine one front door with two signs. Ordinary HTTP visitors ask for a page or JSON response. WebSocket visitors ask to keep a conversation open. Both use the same door, but different route and handler classes decide what happens inside. One owner is responsible for closing the building.

## Follow the design

1. `HttpServer({ listen: false })` builds the Express application and Node server without opening a port. `/health` answers ordinary HTTP requests; `publicPaths: []` avoids exposing an incidental working-directory folder.
2. Pass that Node server to `SocketServer`, alongside the `/chat` route. `listen: true` explicitly starts the supplied listener; `closeServerOnShutdown: true` assigns its cleanup to the socket service.
3. The URL selects `ChatRoute`. A raw JSON message with `type: "hello"` selects `Hello`; there is no secondary action dispatcher.
4. `createApp()` returns the one cleanup owner. Its `shutdown()` processes route failures and still closes the shared HTTP peers. The generated entrypoint helper adds bounded process shutdown without another handwritten signal policy.

The framework ordinarily leaves supplied listeners caller-owned. These explicit flags are a choice made by this starter, not a change to that default. Use [migration and ownership guidance](../MIGRATION.md) when adapting an existing application; do not let two independent services compete to close the same listener.

## Check that it works

Request `http://127.0.0.1:8181/health` and expect `{"ok":true}`. Open a WebSocket to `ws://127.0.0.1:8181/chat`, send `{"type":"hello"}`, and expect `{"type":"hello","message":"Hello from the server!"}`. An unknown socket path is rejected rather than sent to a catch-all handler.

The [shipped tests](../../recipes/http-ws/app.test.cjs) use real HTTP and WebSocket clients on one ephemeral port. They also leave an HTTP request incomplete, repeat shutdown, and deliberately fail an application route's cleanup to confirm the listener still closes. Shared lifecycle tests cover process-level shutdown failures; the package gate repeats the compiled application checks with source removed.

## Before public deployment

The starter deliberately binds loopback. Configure the deployment bind address and HTTPS/WSS termination, trusted origins, identity, authorization and capacity limits before exposing it. `/health` proves liveness, not readiness to accept game traffic or completion of durable work. Forced shutdown closes transports; it does not guarantee delivery, transaction completion or storage.

For shared validation and inferred payloads, use the [typed WebSocket guide](typed-websockets.md). For UI updates driven by server-side components, use the [chatroom guide](chatroom.md). See [operations and deployment boundaries](../MULTIPLAYER_OPERATIONS.md) before adding proxies or multiple workers.
