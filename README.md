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

### WebSocket Server with Handlers

RedWeb now supports **handler-based routing** for WebSocket connections, allowing you to modularize and secure your WebSocket message handling logic.

#### Defining a Custom Handler

Handlers extend the `BaseHandler` class and manage their own connections and message types.

```javascript
const { BaseHandler } = require('redweb');

class ChatHandler extends BaseHandler {
    constructor() {
        super({
            name: 'ChatHandler',
            handlers: {
                chat: (socket, data) => {
                    console.log(`Received chat message: ${data.message}`);
                    socket.send(JSON.stringify({ type: 'chatResponse', message: 'Hello!' }));
                }
            }
        });
    }
}

module.exports = ChatHandler;
```

#### Setting Up a WebSocket Server with Handlers

```javascript
const { SocketServer } = require('redweb');
const ChatHandler = require('./ChatHandler');

const options = {
    port: 3000,
    handlerConfig: [ChatHandler],
    connectionOpenCallback: (socket) => {
        console.log('WebSocket client connected');
    },
    connectionCloseCallback: (socket) => {
        console.log('WebSocket client disconnected');
    }
};

const socketServer = new SocketServer(options);
```

#### Client Communication with a Handler

The client must identify the handler during the initial connection with a `__handlerConnect` message.

```javascript
const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3000');

ws.on('open', () => {
    ws.send(JSON.stringify({
        type: '__handlerConnect',
        data: { handlerName: 'ChatHandler' }
    }));

    // Send a message to the handler
    ws.send(JSON.stringify({ type: 'chat', message: 'Hi there!' }));
});

ws.on('message', (message) => {
    console.log('Received:', message);
});
```

### Managing Connected Clients

RedWeb's WebSocket server maintains a list of connected clients by their IP addresses. This list is automatically updated when clients connect or disconnect.

```javascript
const { SocketServer } = require('redweb');

const socketServer = new SocketServer({
    port: 3000,
    connectionOpenCallback: (socket) => {
        console.log('WebSocket client connected');
    },
    connectionCloseCallback: (socket) => {
        console.log('WebSocket client disconnected');
    }
});

// Access the list of connected clients
console.log(socketServer.clients); // Map of clients by their IP addresses
```

### Backward-Compatible Message Handlers

If no handler is assigned during the initial connection, you can still use traditional `messageHandlers`.

```javascript
const { SocketServer } = require('redweb');

const options = {
    port: 3000,
    messageHandlers: {
        echo: (socket, data) => {
            socket.send(JSON.stringify({ type: 'echoResponse', message: data.message }));
        }
    }
};

const socketServer = new SocketServer(options);
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

### SocketServer and SecureSocketServer Options

- **port**: Port number (default: `3000`).
- **connectionOpenCallback**: Function to execute once a client connects.
- **connectionCloseCallback**: Function to execute once a client disconnects.
- **messageCallback**: Function to execute for every message received.
- **messageHandlers**: Object containing message handlers based on message type.
- **handlerConfig**: Array of handler classes to support handler-based routing.
- **ssl**: SSL configuration for SecureSocketServer (`{ key: './path/to/key.pem', cert: './path/to/cert.pem' }`).

## License

MIT License