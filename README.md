# RedWeb

**RedWeb** is a flexible Node.js framework built on top of **Express.js** and **WebSocket**. It enables quick setup of HTTP(S) and WebSocket servers with a modular route and handler system.

---

## 📦 Installation

```bash
npm install redweb
```

---

## 🚀 Quick Start

```js
const { HttpServer, SocketServer } = require('redweb');

new HttpServer(); // serves public/ by default
new SocketServer(); // starts WS on :3000
```

---

## 🌐 HTTP Server Example (HTMX Support)

```js
const { HttpServer, METHODS } = require('redweb');

new HttpServer({
  port: 3000,
  publicPaths: ['./public'],
  enableHtmxRendering: true,
  services: [
    {
      serviceName: '/submit',
      method: METHODS.POST,
      function: (req, res) => {
        if (!req.body.name) return res.status(400).json({ error: 'Missing name' });
        res.status(200).json({ message: `Thanks, ${req.body.name}!` });
      }
    }
  ]
});
```

`.htmx` files under `public/` will render server-side. Example:

```html
<!-- public/hello.htmx -->
<@>
  <h1>Hello, {{name}}!</h1>
<@/>
```

---

## 🔌 WebSocket Broadcast Chat (🔥 Instant Testing)

### 1. `ChatHandler.js`

```js
const { BaseHandler } = require('redweb');

class ChatHandler extends BaseHandler {
  constructor() {
    super('chat');
  }

  onMessage(socket, message) {
    const text = message.text;
    socket.broadcast({ type: 'chat', text });
  }
}

module.exports = ChatHandler;
```

---

### 2. `ChatRoute.js`

```js
const { SocketRoute } = require('redweb');
const ChatHandler = require('./ChatHandler');

class ChatRoute extends SocketRoute {
  constructor() {
    super({
      path: '/chat',
      handlers: [ChatHandler],
      allowDuplicateConnections: true
    });
  }
}

module.exports = ChatRoute;
```

---

### 3. `server.js`

```js
const { SocketServer } = require('redweb');
const ChatRoute = require('./ChatRoute');

new SocketServer({
  port: 3000,
  routes: [ChatRoute]
});
```

---

### 4. `client.html`

```html
<!DOCTYPE html>
<html>
  <body>
    <h1>Broadcast Chat</h1>
    <input id="msg" placeholder="Type message..." />
    <button onclick="send()">Send</button>
    <pre id="log"></pre>

    <script>
      const log = document.getElementById('log');
      const ws = new WebSocket('ws://localhost:3000/chat');

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        log.textContent += `\n${msg.text}`;
      };

      function send() {
        const text = document.getElementById('msg').value;
        ws.send(JSON.stringify({ type: 'chat', text }));
      }
    </script>
  </body>
</html>
```

Open multiple tabs to test.

---

## 🧩 Socket Architecture

### `SocketRoute`

Defines a WebSocket path, handlers, and optional route-scoped services:

```js
new SocketRoute({
  path: '/game',
  handlers: [ChatHandler, MoveHandler],
  services: [MatchService], // ✅ Scoped only to this route
  allowDuplicateConnections: true
});
```

---

### `BaseHandler`

Handlers are message-type keyed classes:

```js
class MoveHandler extends BaseHandler {
  constructor() {
    super('move');
  }

  onMessage(socket, message) {
    // handle movement logic
  }
}
```

---

### `SocketService` (NEW)

Socket services run alongside handlers on a route. Use for timers, logic, cleanup.

```js
class MatchService extends SocketService {
  constructor() {
    super('match', 1000); // tick every 1s
  }

  onInit(route) {
    route.registry.on('maxPlayersReached', () => this.startMatch());
  }

  onTick() {
    // tick logic
  }

  onShutdown() {
    // cleanup
  }
}
```

### 📦 `SocketRegistry` (NEW) – Event-Driven Socket Object Store

`SocketRegistry` is a lightweight, extendable class for managing WebSocket-connected clients (or any socket-bound object). It provides add/remove/get/broadcast utilities with full `EventEmitter` support.

Useful for managing players, NPCs, chat members, rooms, etc.

---

### 🔧 Basic Usage

```js
const { SocketRegistry } = require('redweb');

class Player {
    constructor(socket, id) {
        this.socket = socket;
        this.id = id;
    }

    send(type, payload) {
        this.socket.send(JSON.stringify({ type, ...payload }));
    }

    getSanitized() {
        return { id: this.id };
    }
}
```

---

### 🚀 Extending `SocketRegistry` to Create a Player Registry

```js
class PlayerRegistry extends SocketRegistry {
    create(socket, id) {
        return new Player(socket, id);
    }

    addPlayer(socket, id) {
        const player = this.create(socket, id);
        const success = this.add(player);
        if (success) this.emit('playerJoined', player);
        return success;
    }

    removePlayer(id) {
        const success = this.remove(id);
        if (success) this.emit('playerLeft', id);
        return success;
    }

    broadcastToAll(message) {
        this.items.forEach(player => player.send(message.type, message));
    }
}
```

---

### 📣 Built-in Events

You can listen to events:

```js
const registry = new PlayerRegistry();

registry.on('playerJoined', player => {
    console.log('New player:', player.id);
});

registry.on('playerLeft', id => {
    console.log('Player left:', id);
});
```

---

### 🔄 Built-in Methods

* `add(player)`
* `remove(id)`
* `getById(id)`
* `getBySocket(socket)`
* `all()`
* `count()`
* `broadcast(message, excludeSocket?)`
* `getSanitizedList()`

---

## 🔧 Configuration

### HTTP / HTTPS Options

| Option                | Type      | Default        | Description                    |
| --------------------- | --------- | -------------- | ------------------------------ |
| `port`                | number    | `80`           | Port to listen on              |
| `bind`                | string    | `'0.0.0.0'`    | Bind address                   |
| `publicPaths`         | string\[] | `['./public']` | Serve static and `.htmx` files |
| `services`            | object\[] | `[]`           | REST endpoints                 |
| `enableHtmxRendering` | boolean   | `false`        | Enables `.htmx` file rendering |
| `ssl`                 | object    | `undefined`    | Used in `HttpsServer`          |

---

### WebSocket Server Options

| Option   | Type            | Default | Description                  |
| -------- | --------------- | ------- | ---------------------------- |
| `port`   | number          | `3000`  | WebSocket port               |
| `routes` | `SocketRoute[]` | `[]`    | List of custom route classes |

&nbsp;

# Changelog
Here’s the updated `CHANGELOG.md` entry for **RedWeb v0.7.1**, written professionally and focused only on the framework-level additions:

---

## 📦 RedWeb v0.7.1 – Socket Services & Registries

### ✨ Added

* `SocketService`: A new class for running autonomous, lifecycle-aware logic alongside a `SocketRoute`. Ideal for game loops, timers, state machines, or server-side AI.

  * Hooks: `onInit(route)`, `onTick()`, `onShutdown()`
  * Optional `tickRateMs` support for periodic execution

* `SocketRegistry`: A generic, event-driven registry for managing WebSocket-bound entities

  * Includes `.add()`, `.remove()`, `.getById()`, `.broadcast()`
  * Fully compatible with custom socket wrappers and `EventEmitter`

## 0.7.0 Update Highlights

* allowDuplicateConnections for multi-tab testing
* Robust message validation
* socket.broadcast() now excludes sender
* Better error handling

---

## 🪪 License

MIT