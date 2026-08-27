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
  FixedStepService,    // Drift-aware, non-overlapping simulation ticks
  SocketRegistry,      // Evented in-memory store
  RoomRegistry,        // Bounded route-local connection groups
  SessionRegistry,     // Bounded, expiring application-issued sessions
  BaseHttpServer,      // Express app builder for advanced composition
  BaseHandler,         // WebSocket message handler base
  sendJson,            // Utility to stringify+send
  HTTP_OPTIONS,        // Defaults for HTTP servers
  ENCODINGS,           // json/urlencoded encoding names
  SOCKET_OPTIONS,      // Defaults for socket servers
  METHODS              // Express method helpers
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
- `corsOptions: false`: disables the CORS middleware entirely.
- `enableHtmxRendering` (boolean): render `.htmx` files with the built-in renderer.
- `exposeErrors` (boolean): include HTMX rendering details in responses; defaults to `false`.
- `logger`: an object with optional `log`, `warn`, and `error` methods. Pass `null` to disable library logging.

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

Templates are trusted server-side code. They may load relative modules within their configured public directory, execute for at most one second by default, and interpolate raw HTML. Never render user-supplied template files.

CORS remains permissive by default for backward compatibility. CORS is not authorization; configure `corsOptions`, add authentication middleware to `server.app`, or disable the middleware as appropriate.

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
Redweb controls `noServer`, `path`, `server`, and `port`; do not include them in `websocketOptions`. Route selection is performed once by Redweb so strict matching and optional root fallback behave consistently. Handshake authentication can use the `ws` `verifyClient` option, although authenticating in the surrounding HTTP upgrade flow is preferable for complex applications.

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

Other route options:

- `trustProxy`: use the first `X-Forwarded-For` value as the connection identity. Enable this only behind a trusted proxy.
- `getClientKey(req)`: provide application-specific connection identity logic instead of IP-based identity.
- `exposeErrors`: return handler exception messages to clients; defaults to `false`.
- `logger`: route logger with optional `log`, `warn`, and `error` methods; pass `null` to disable it.
- `shutdownTimeoutMs`: grace period before non-cooperating peers are terminated during shutdown; defaults to `1000`.
- `admission`: optional pre-upgrade authentication/origin/placement policy. It may be a function or `{ authenticate, origins, place, allowedPlacementOrigins, allowInsecurePlacement, timeoutMs }`. Secure `wss` placement is the default; returned destinations can be origin-allowlisted.
- `maxPendingUpgrades`: maximum concurrent pre-upgrade authorization/negotiation operations; defaults to `64`.
- `limits`: opt-in connection, message-rate, pending-message, and outbound-buffer limits.
- `orderedMessages`: process each connection's messages serially through a bounded queue; defaults to `false` for compatibility.
- `heartbeat`: optional `{ intervalMs, timeoutMs }` half-open detection using one scheduler per route.
- `rooms` and `sessions`: optional bounded route-local grouping and resumable session registries. Session payload shape and byte size remain the application's responsibility.
- `distribution`: optional bounded fan-out adapter. Mark it `required` to fail readiness and reject new upgrades while unavailable.
- `drainHandlers`: expose a route shutdown signal to handlers and track their work within `shutdownTimeoutMs`.
- `protocol`: optional version negotiation, stable envelopes, and binary codec hooks.

Production protections are deliberately opt-in, so existing applications retain their behavior and disabled features add no timers or per-connection queues. A protected route can stay compact:

```js
class GameRoute extends SocketRoute {
  constructor() {
    super({
      path: '/game',
      handlers: [InputHandler],
      admission: {
        origins: ['https://game.example'],
        timeoutMs: 3000,
        authenticate: (request, { signal }) => verifySession(request, signal)
      },
      limits: {
        maxConnections: 5000,
        maxBufferedBytes: 1024 * 1024,
        maxPendingMessages: 64,
        messageRate: { capacity: 60, refillPerSecond: 30 }
      },
      orderedMessages: true,
      heartbeat: { intervalMs: 30000, timeoutMs: 10000 },
      websocketOptions: { maxPayload: 64 * 1024 }
    });
  }
}
```

Admission completes before the WebSocket upgrade and before any handler hook runs. Its return value becomes `socket.context.principal`; the random `connectionId`, authenticated principal, future resumable session, and legacy IP-based `clientKey` remain separate concepts. Authentication errors are never returned to clients.

Rate and backpressure actions are `"drop"` or `"disconnect"`. Slow-consumer checks apply equally to `sendJson` and `broadcast`, and broadcasts still serialize a message once. Ordered processing never keeps more than `maxPendingMessages` waiting behind the active task.

### Rooms, resumable sessions, and metrics

Set `rooms: true` to add bounded route-local rooms, or pass limits such as `{ maxRooms, maxMembersPerRoom, maxRoomsPerConnection, maxRoomIdLength }`. Connected sockets receive `joinRoom`, `leaveRoom`, and `roomBroadcast`. Joins and leaves are idempotent, disconnect removes every membership, and empty rooms are reclaimed.

Set `sessions: true` or provide `{ ttlMs, maxSessions, maxSessionIdLength, sweepIntervalMs }`. Applications supply opaque session IDs; Redweb does not create credentials. Sockets receive `createSession` and `resumeSession`. A successful takeover closes the former owner, and a stale close cannot release the replacement. Disconnected sessions expire through one route scheduler.

The optional `metrics` sink is vendor-neutral and supports `increment`, `gauge`, and `observe`. Framework attributes contain only the static route path—never player IDs, room IDs, tokens, payloads, or exception text.

```js
class MatchRoute extends SocketRoute {
  constructor() {
    super({
      path: '/match',
      handlers: [MatchHandler],
      rooms: { maxRooms: 1000, maxMembersPerRoom: 32 },
      sessions: { ttlMs: 30000, maxSessions: 10000 },
      metrics: myMetricsSink
    });
  }
}
```

### Horizontal composition and draining

Distribution is an opt-in adapter seam, not a bundled broker. Provide `distribution: { adapter, channel, nodeId, onEvent }`; the adapter only needs `publish(channel, serializedEvent)` and `subscribe(channel, listener)`. Optional `start`, `unsubscribe`, and `close` hooks have bounded lifecycles. Redweb validates event size, ignores events published by the same node, and retains a bounded, expiring deduplication window. Delivery remains at-most-effort: partitions can lose events and reconnects can duplicate them, so authoritative games should include their own tick or sequence in payloads.

Sockets on distributed routes receive `publishEvent(type, payload)`. The application decides how a received event affects rooms or state:

```js
super({
  path: '/match',
  handlers: [MatchHandler],
  rooms: true,
  distribution: {
    adapter: brokerAdapter,
    channel: 'matches',
    nodeId: process.env.INSTANCE_ID,
    onEvent(event, route) {
      route.rooms.broadcast('match-42', event.payload)
    }
  }
})
```

`server.beginDrain()` flips readiness before rejecting new upgrades with `503`; `server.isReady()` exposes the state. Set `drainHandlers: true` to give connection contexts an `AbortSignal` and make shutdown wait for active handlers. Handlers must cooperate with that signal—JavaScript cannot forcibly cancel arbitrary application promises. This option is off by default, adding no per-message tracking to existing routes.

### Versioned game protocol

Set `protocol: { versions: ['1'] }` to require version negotiation before upgrade. Browser clients use `?redwebVersion=1`; non-browser clients may send `x-redweb-version: 1`. Missing or unsupported versions receive `426 Upgrade Required` with a `Redweb-Versions` response header. The selected value is available as `socket.context.protocol.version`.

Protocol messages use `{ v, type, payload, requestId?, sequence? }`. Protocol routes add `socket.sendEvent(...)` and `socket.sendProtocolError(...)`; framework failures use stable codes exported as `ERROR_CODES`. This affects only opted-in routes. Existing routes retain their existing message and error shapes.

```js
super({
  path: '/match',
  handlers: [MoveHandler],
  protocol: {
    versions: ['2', '1'],
    binary: {
      maxBytes: 64 * 1024,
      encode: state => myCodec.encode(state),
      decode: bytes => myCodec.decode(bytes)
    }
  }
})
```

The optional binary hooks add no codec dependency. Decoded values pass through the same version/envelope validation and handler dispatch as JSON; `socket.sendBinaryEvent(value)` applies the same slow-consumer policy as other outbound traffic. Without binary hooks, binary frames on a protocol route receive `BINARY_UNSUPPORTED`.

For clients, `require('redweb/client')` exports the dependency-free `ProtocolClient` and the same error codes. Its TypeScript declarations are generated from Redweb's checked-in protocol schema and checked for drift before every test run.

`BaseHandler.validateMessage(message, socket)` may return `false` or a promise resolving to `false` to reject a message. Text and binary handlers may be asynchronous; rejected promises are caught and converted to safe error responses.

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

For authoritative simulation timing, extend `FixedStepService`. It compensates for timer drift, caps catch-up work, contains tick failures, and never overlaps an asynchronous tick with itself:

```js
class Simulation extends FixedStepService {
  constructor() { super('simulation', 50, 3); }
  async onTick(stepMs, tick) {
    await game.update(stepMs, tick);
  }
}
```

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
- Upgrade paths are matched strictly by default. Set `fallbackToRoot: true` for legacy behavior that sends unmatched paths to `/`.
- If you do not supply `routes`, `SocketServer` registers a default route at `/` with `DefaultHandler` (it expects messages with `type: 'DefaultHandler'`).
- `shutdown()` closes routes and services. It closes an owned listener, but leaves a supplied listener running unless `closeServerOnShutdown: true` is set.
- Shutdown is best-effort: all hooks, clients, routes, and owned listeners are processed before collected cleanup errors are reported.
- `HttpServer` and `HttpsServer` expose an idempotent async `shutdown()` helper.

## 0.8 migration notes

- Unmatched WebSocket paths are rejected unless `fallbackToRoot: true` is configured.
- Handler exception details are hidden unless `exposeErrors: true` is configured.
- Shutting down a WebSocket server no longer closes a caller-supplied HTTP/HTTPS server by default.
- `bind` is now honored by HTTP, HTTPS, WebSocket, and secure WebSocket listeners.
- `shutdown()` is asynchronous; await it when deterministic cleanup matters.

## Developing

- Run tests with `npm test` (Jest). The suite includes mock-free HTTP, HTTPS, WebSocket, and secure WebSocket integration tests plus unit tests, with 100% coverage enforced for statements, branches, functions, and lines.
