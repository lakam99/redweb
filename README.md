Here is the **fully updated and cleaned-up `README.md`** for RedWeb, now featuring a **working broadcast chat example** using `allowDuplicateConnections`:

---

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

const httpServer = new HttpServer();
const socketServer = new SocketServer();
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

`.htmx` files under `public/` will render server-side.
Example:

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
    console.log(`Broadcasting: ${text}`);
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
      allowDuplicateConnections: true // key for local testing!
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

Open multiple tabs to test!

---

## 🔧 Options

### HTTP / HTTPS Server Options

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

| Option                      | Type                | Default | Description                         |
| --------------------------- | ------------------- | ------- | ----------------------------------- |
| `port`                      | number              | `3000`  | WebSocket port                      |
| `routes`                    | `SocketRoute[]`     | `[]`    | List of custom route classes        |
| `allowDuplicateConnections` | boolean (per route) | `false` | Allow multiple clients from same IP |

---

## 🆕 0.7.0 Update Highlights

* ✅ `allowDuplicateConnections` for multi-tab testing
* ✅ Robust message validation
* ✅ `socket.broadcast()` now excludes sender
* ✅ Better error handling

---

## 🪪 License

MIT