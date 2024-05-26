Sure, here is a concise version of the `README.md`:

```markdown
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
        'function': (req, res) => {
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

#### WebSocket Server

```javascript
const { SocketServer } = require('redweb');

const options = {
    port: 3000,
    connectionOpenCallback: (socket) => {
        console.log('WebSocket client connected');
    },
    connectionCloseCallback: (socket) => {
        console.log('WebSocket client disconnected');
    },
    messageHandlers: {
        'msg': () => (socket, data) => {
            console.log(data);
            socket.send('guuuuuurl');
        }
    }
};

const socketServer = new SocketServer(options);
```

#### Secure WebSocket Server

```javascript
const { SecureSocketServer } = require('redweb');

const options = {
    port: 4443,
    ssl: {
        key: './path/to/key.pem',
        cert: './path/to/cert.pem'
    },
    connectionOpenCallback: (socket) => {
        console.log('WebSocket client connected');
    },
    connectionCloseCallback: (socket) => {
        console.log('WebSocket client disconnected');
    },
    messageHandlers: {
        'msg': () (socket, data) => {
            console.log(data);
            socket.send('guuuuuurl');
        }
    }
};

const secureSocketServer = new SecureSocketServer(options);
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
    },
    messageHandlers: {
        'msg': () => (socket, data) {
            console.log(data);
            socket.send('guuuuuurl');
        }
    }
});

// Access the list of connected clients
console.log(socketServer.clients); // Map of clients by their IP addresses
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
- **ssl**: SSL configuration for SecureSocketServer (`{ key: './path/to/key.pem', cert: './path/to/cert.pem' }`).

## License

MIT License
```

This `README.md` is now more concise, providing a clear overview of the basic and custom configurations for both HTTP and WebSocket servers, along with their available options.