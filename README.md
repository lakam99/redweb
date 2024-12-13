# RedWeb

RedWeb is a simple and flexible Node.js framework built on top of Express.js and WebSocket. It allows you to quickly set up web servers and WebSocket servers with customizable options.

## Installation

To install RedWeb, use npm:

```bash
npm install redweb
```

## Usage

### Basic Example

Initialize your RedWeb instance with the default options:

```javascript
const { HttpServer, SocketServer } = require('redweb');

// HTTP server with default configuration
const httpServer = new HttpServer();

// WebSocket server with default configuration
const socketServer = new SocketServer();
```

### Custom Configuration

#### HTTP Server

```javascript
const { HttpServer, METHODS } = require('redweb');

const services = [
    {
        serviceName: '/submit-form',
        method: METHODS.POST,
        function: (req, res) => {
            const { name, email, message } = req.body;
            if (!name || !email || !message) {
                return res.status(400).json({ error: 'All fields are required' });
            }
            res.status(200).json({ success: 'Form submitted successfully' });
        }
    }
];

const options = {
    port: 3000,
    publicPaths: ['./public'],
    encoding: 'urlencoded',
    services: services
};

const app = new HttpServer(options);
```

#### HTTPS Server

```javascript
const { HttpsServer } = require('redweb');

const options = {
    port: 3443,
    ssl: {
        key: './path/to/key.pem',
        cert: './path/to/cert.pem'
    },
    publicPaths: ['./public']
};

const app = new HttpsServer(options);
```

### WebSocket Server with Routes and Handlers

RedWeb uses **route-based architecture** for WebSocket connections, allowing you to modularize and secure your WebSocket message handling logic.

#### Defining a Custom Handler

Handlers extend the `BaseHandler` class and manage their own connections and message types.

```javascript
const { BaseHandler } = require('redweb');

class ChatHandler extends BaseHandler {
    constructor() {
        super('chat');
    }

    onMessage(socket, message) {
        console.log(`Received chat message: ${message.text}`);
        socket.send(JSON.stringify({ type: 'chatResponse', message: 'Hello!' }));
    }
}

module.exports = ChatHandler;
```

#### Defining a WebSocket Route

Routes group handlers and specify the WebSocket path.

```javascript
const { SocketRoute } = require('redweb');
const ChatHandler = require('./ChatHandler');

class ChatRoute extends SocketRoute {
    constructor() {
        super({
            path: '/chat',
            handlers: [ChatHandler]
        });
    }
}

module.exports = ChatRoute;
```

#### Setting Up a WebSocket Server with Routes

```javascript
const { SocketServer } = require('redweb');
const ChatRoute = require('./ChatRoute');

new SocketServer({
    port: 3000,
    routes: [ChatRoute]
});
```

### Adding Routes Dynamically

Routes can be added to the WebSocket server after initialization.

```javascript
const { SocketServer, SocketRoute } = require('redweb');
const ChatHandler = require('./ChatHandler');

class ChatRoute extends SocketRoute {
    constructor() {
        super({
            path: '/chat',
            handlers: [ChatHandler]
        });
    }
}

const socketServer = new SocketServer({ port: 3000 });

// Dynamically add a new route
const chatRoute = new ChatRoute();
socketServer.routes.push(chatRoute);
```

### Client Communication with a Route

The client connects to the WebSocket server using the specified route.

```javascript
const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3000/chat');

ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'chat', text: 'Hello there!' }));
});

ws.on('message', (message) => {
    console.log('Received:', message);
});
```

### Managing Connected Clients

RedWeb's WebSocket server maintains a list of connected clients by their IP addresses for each route. This list is automatically updated when clients connect or disconnect.

```javascript
const { SocketRoute } = require('redweb');

class ChatRoute extends SocketRoute {
    constructor() {
        super({
            path: '/chat',
            handlers: []
        });
    }

    onConnection(socket) {
        console.log('New client connected:', socket.remoteAddress);
    }
}

module.exports = ChatRoute;
```

## Options

### HttpServer and HttpsServer Options

- **port**: Port number (default: `80`).
- **bind**: Bind address (default: `0.0.0.0`).
- **publicPaths**: Array of paths to serve static files (default: `['./public']`).
- **services**: Array of services with endpoints and handlers (default: `[]`).
- **listenCallback**: Function to execute once the server starts listening.
- **encoding**: Encoding type for request bodies (`'json'` or `'urlencoded'`).
- **ssl**: SSL configuration for HTTPS server (`{ key: './path/to/key.pem', cert: './path/to/cert.pem' }`).

### SocketServer Options

- **port**: Port number (default: `3000`).
- **routes**: Array of `SocketRoute` classes to define WebSocket routes and handlers.
- **ssl**: SSL configuration for SecureSocketServer (`{ key: './path/to/key.pem', cert: './path/to/cert.pem' }`).

## License

MIT License