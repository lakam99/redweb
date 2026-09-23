# Serve HTTP and WebSockets on one port

Build an Express endpoint and a raw WebSocket route on the same Node listener. Use this when an existing HTTP application needs socket endpoints without a second port or a separate web framework. This guide demonstrates server composition, not a rendered chat interface.

## Explain it like I'm five

Imagine one front door with two signs. Ordinary HTTP visitors ask for a page or JSON response. WebSocket visitors ask to keep a conversation open. Both use the same door, but different route and handler classes decide what happens inside. One owner is responsible for closing the building.

## Follow the design

1. `defineApp` describes one application without opening a port. `httpServices` registers `/health`; `publicPaths: []` avoids exposing an incidental working-directory folder.
2. Register `ChatRoute` in `sockets`, then call `app.run()`. Redweb creates one HTTP server and attaches its WebSocket upgrade listener before opening the port.
3. The URL selects `ChatRoute`. A raw JSON message with `type: "hello"` selects `Hello`; there is no secondary action dispatcher.
4. The application is the one cleanup owner. Its `shutdown()` processes route failures and still closes the shared HTTP peers. Signal handling and cleanup deadlines are built into Redweb rather than copied into the generated project.

The low-level server APIs still support caller-owned listeners. Use [application composition](../APPLICATION.md) for the unified entry point and [migration and ownership guidance](../MIGRATION.md) when adapting an existing application; do not let two independent services compete to close the same listener.

## Check that it works

Request `http://127.0.0.1:8181/health` and expect `{"ok":true}`. Open a WebSocket to `ws://127.0.0.1:8181/chat`, send `{"type":"hello"}`, and expect `{"type":"hello","message":"Hello from the server!"}`. An unknown socket path is rejected rather than sent to a catch-all handler.

The [shipped tests](../../recipes/http-ws/app.test.cjs) use real HTTP and WebSocket clients on one ephemeral port. They also leave an HTTP request incomplete, repeat shutdown, and deliberately fail an application route's cleanup to confirm the listener still closes. Shared lifecycle tests cover process-level shutdown failures; the package gate repeats the compiled application checks with source removed.

## Before public deployment

The starter deliberately binds loopback. Configure the deployment bind address and HTTPS/WSS termination, trusted origins, identity, authorization and capacity limits before exposing it. `/health` proves liveness, not readiness to accept game traffic or completion of durable work. Forced shutdown closes transports; it does not guarantee delivery, transaction completion or storage.

For shared validation and inferred payloads, use the [typed WebSocket guide](typed-websockets.md). For UI updates driven by server-side components, use the [chatroom guide](chatroom.md). See [operations and deployment boundaries](../MULTIPLAYER_OPERATIONS.md) before adding proxies or multiple workers.
