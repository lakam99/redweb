## HTTP and WebSockets on one listener

One Node server answers ordinary HTTP requests and upgrades `/chat` connections to WebSockets. HTTP paths select Express services; a socket URL selects a route and each message's `type` selects a handler. No socket decorators or secondary `message.action` dispatcher are needed.

After starting the application, request `http://127.0.0.1:8181/health` to receive `{"ok":true}`. Connect a WebSocket to `ws://127.0.0.1:8181/chat` and send `{"type":"hello"}` to receive `{"type":"hello","message":"Hello from the server!"}`. This is a raw JSON socket example, not a chatroom UI or the versioned socket-contract protocol. Use the chat or socket starter for those applications.

The HTTP builder does not bind a port. The socket service explicitly takes responsibility for listening and closing the supplied server with `listen: true` and `closeServerOnShutdown: true`. Call the returned application's `shutdown()`; it processes route failures and still closes its HTTP/TCP peers. Do not separately close the HTTP builder. Importing this module creates no listener; the standalone entrypoint uses the same bounded `runApp` helper as the other starters.

`/health` reports liveness, not readiness or completed application work. Loopback binding is intentional. Before exposing the service, choose your deployment bind address, configure HTTPS/WSS, trusted origins, authentication, authorization, payload/connection limits, and any persistence you need. Shared listeners do not automatically provide these policies. Shutdown may force connections closed; it does not guarantee message delivery or durable work.

`npm test` runs real HTTP and WebSocket requests on ephemeral ports, checks strict socket routing and multiple clients, verifies idempotent cleanup with an incomplete HTTP peer, and proves a failing route cleanup still closes the listener. It also runs the shared process-lifecycle suite. No mocks are used. The package verification gate repeats the tests against the compiled application with `src/` unavailable.
