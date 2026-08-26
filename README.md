# RedWeb

RedWeb is a small Node.js helper that wires together Express HTTP/HTTPS servers and `ws` WebSocket servers with simple defaults. Use it to serve static files plus JSON APIs and to route WebSocket traffic to handler classes.

## Install

```bash
npm install redweb
```

## Exports

```js
const {
  HttpServer,          // HTTP over Express
  HttpsServer,         // HTTP with TLS (key/cert required)
  SocketServer,        // WebSocket over HTTP
  SecureSocketServer,  // WebSocket over HTTPS
  SocketRoute,         // Per-path WebSocket routing
  SocketService,       // Route-scoped background/tick logic
  SocketRegistry,      // Evented in-memory store
  BaseHttpServer,      // Express app builder for advanced composition
  BaseHandler,         // WebSocket message handler base
  sendJson,            // Utility to stringify+send
  SOCKET_OPTIONS,      // Defaults for socket servers
  METHODS              // Express method helpers: get/post/put/delete
} = require('redweb');
```

## HTTP servers (Express)

`new HttpServer(options)` creates a Node HTTP server and starts listening immediately by default (default port `80`). `new HttpsServer({ ssl: { key, cert }, ... })` does the same over TLS.

Options:

- `port` (number): defaults to `80`.
- `bind` (string): defaults to `0.0.0.0`.
- `publicPaths` (string[]): folders served as static assets.
- `services` (array): `{ serviceName, method, function }` for REST endpoints.
- `listen` (boolean): defaults to `true`; set `false` to build `.app` and `.server` without binding a port.
- `listenCallback` (function): invoked after `.listen`.
- `encoding` (`'json' | 'urlencoded'`): body parser selection.
- `corsOptions`: passed to `cors`.
- `enableHtmxRendering` (boolean): render `.htmx` files with the built-in renderer.

Example:

```js
const { HttpServer, METHODS } = require('redweb');

new HttpServer({
  port: 3000,
  publicPaths: ['./public'],
  services: [
    {
      serviceName: '/api/hello',
      method: METHODS.GET,
      function: (req, res) => res.json({ hello: 'world' })
    }
  ]
});
```

HTMX rendering example (`enableHtmxRendering: true`):

```js
new HttpServer({ publicPaths: ['./public'], enableHtmxRendering: true });
```

`public/example.htmx`:

```js
const name = 'RedWeb';

<@>
  <h1>Hello, {{name}}!</h1>
<@/>
```

Requesting `/example.htmx` returns rendered HTML.

## WebSocket servers

`SocketServer` uses `ws` and routes connections to `SocketRoute` instances. Clients must send JSON containing a `type` that matches a handler name.

Handler:

```js
const { BaseHandler } = require('redweb');

class ChatHandler extends BaseHandler {
  constructor() { super('chat'); }

  onMessage(socket, message) {
    socket.broadcast({ type: 'chat', text: message.text });
  }
}
```

Route:

```js
const { SocketRoute } = require('redweb');

class ChatRoute extends SocketRoute {
  constructor() {
    super({
      path: '/chat',
      handlers: [ChatHandler],
      allowDuplicateConnections: true // otherwise one connection per IP
    });
  }
}
```

Server:

```js
const { SocketServer } = require('redweb');

new SocketServer({
  port: 3000,          // default
  routes: [ChatRoute], // defaults to a route at "/" with DefaultHandler if omitted
});
```

Each connected socket gets:

- `socket.sendJson(data)` to send JSON.
- `socket.broadcast(data)` to send JSON to all other clients on the same route.

Invalid JSON triggers an error response and closes the socket.

### Binary WebSocket messages

Text frames are still parsed as JSON and routed by `message.type`. Binary frames are dispatched separately, so handlers can receive raw `Buffer` payloads without triggering JSON parse errors.

```js
const { BaseHandler, SocketRoute } = require('redweb');

class UploadHandler extends BaseHandler {
  constructor() { super('upload'); }

  onMessage(socket, message) {
    socket.sendJson({ type: 'upload:control', action: message.action });
  }

  onBinaryMessage(socket, buffer) {
    socket.sendJson({ type: 'upload:chunk', bytes: buffer.length });
  }
}

class UploadRoute extends SocketRoute {
  constructor() {
    super({
      path: '/upload',
      handlers: [UploadHandler],
      allowDuplicateConnections: true,
      websocketOptions: {
        maxPayload: 2 * 1024 * 1024
      }
    });
  }
}
```

`BaseHandler` provides `handleBinaryMessage(socket, buffer)` and `onBinaryMessage(socket, buffer)`. Override `onBinaryMessage` for normal use. If a handler does not override it, RedWeb sends:

```json
{ "error": "Binary messages are not supported by this handler" }
```

Routes may also select a binary-capable handler with `acceptsBinary(socket, buffer)`:

```js
class ImageHandler extends BaseHandler {
  constructor() { super('image'); }

  acceptsBinary(socket, buffer) {
    return buffer.length > 0;
  }

  onMessage(socket, message) {}
  onBinaryMessage(socket, buffer) {}
}
```

### WebSocket route options

`SocketRoute` accepts `websocketOptions`, which are passed to `new WebSocketServer(...)`. Use this for `ws` server settings such as `maxPayload` or `perMessageDeflate`.

```js
class ClipboardRoute extends SocketRoute {
  constructor() {
    super({
      path: '/clipboard',
      handlers: [ClipboardHandler],
      websocketOptions: {
        maxPayload: 1024 * 1024,
        perMessageDeflate: false
      }
    });
  }
}
```

### Sharing an HTTP/HTTPS server

Use `listen: false` on `HttpServer` to build the Express app and Node server without binding a port. Then pass `httpServer.server` to `SocketServer`. When `SocketServer` receives a prebuilt `server`, it attaches upgrade handling but does not call `.listen()` unless you explicitly set `listen: true`.

```js
const { HttpServer, METHODS, SocketServer } = require('redweb');

const httpServer = new HttpServer({
  port: 3030,
  listen: false,
  publicPaths: ['./public'],
  services: [
    { serviceName: '/health', method: METHODS.GET, function: (req, res) => res.json({ ok: true }) },
    { serviceName: '/session', method: METHODS.POST, function: createSession }
  ]
});

new SocketServer({
  server: httpServer.server,
  routes: [ClipboardRoute]
});

httpServer.server.listen(3030, () => console.log('HTTP and WebSocket server listening on 3030'));
```

### Socket services

Route-scoped background logic:

```js
const { SocketService } = require('redweb');

class ClockService extends SocketService {
  constructor() { super('clock', 1000); } // tick every 1s
  onTick() {
    this.route.clients.forEach((socket) => socket.sendJson({ type: 'time', now: Date.now() }));
  }
}
```

Add with `services: [ClockService]` when constructing a `SocketRoute`.

### Socket registries

`SocketRegistry` is a small evented list for socket-bound objects.

```js
const { SocketRegistry } = require('redweb');

class PlayerRegistry extends SocketRegistry {
  addPlayer(player) {
    this.add(player);
    this.emit('playerJoined', player);
  }
}
```

Helpers: `add`, `remove(itemOrId, byKey = 'id')`, `all()`, `count()`.

## Defaults and lifecycle

- HTTP defaults: port `80`, bind `0.0.0.0`, `listen: true`.
- WebSocket defaults: port `3000`, single connection per IP unless `allowDuplicateConnections` is set.
- `SocketServer` owns and listens on its own server by default; if you pass `server`, you own calling `.listen()` unless you also pass `listen: true`.
- If you do not supply `routes`, `SocketServer` registers a default route at `/` with `DefaultHandler` (it expects messages with `type: 'DefaultHandler'`).
- `BaseSocketServer.shutdown()` closes all routes, services, and the underlying server.

## Developing

- Run tests with `npm test` (Jest).
