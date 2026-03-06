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
  BaseHandler,         // WebSocket message handler base
  sendJson,            // Utility to stringify+send
  SOCKET_OPTIONS,      // Defaults for socket servers
  METHODS              // Express method helpers: get/post/put/delete
} = require('redweb');
```

## HTTP servers (Express)

`new HttpServer(options)` starts listening immediately (default port `80`). `new HttpsServer({ ssl: { key, cert }, ... })` does the same over TLS.

Options:

- `port` (number): defaults to `80`.
- `bind` (string): defaults to `0.0.0.0`.
- `publicPaths` (string[]): folders served as static assets.
- `services` (array): `{ serviceName, method, function }` for REST endpoints.
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

### Sharing an HTTP/HTTPS server

`SocketServer` and `SecureSocketServer` accept a prebuilt Node server via `server`. They attach upgrade handling and then call `.listen(port)`, so only pass a server that is **not** already listening.

```js
const http = require('http');
const express = require('express');
const { SocketServer } = require('redweb');

const app = express();
const server = http.createServer(app);

app.get('/', (req, res) => res.send('hello'));

new SocketServer({ server, port: 4000, routes: [ChatRoute] });
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

- HTTP defaults: port `80`, bind `0.0.0.0`.
- WebSocket defaults: port `3000`, single connection per IP unless `allowDuplicateConnections` is set.
- If you do not supply `routes`, `SocketServer` registers a default route at `/` with `DefaultHandler` (it expects messages with `type: 'DefaultHandler'`).
- `BaseSocketServer.shutdown()` closes all routes, services, and the underlying server.

## Developing

- Run tests with `npm test` (Jest).
