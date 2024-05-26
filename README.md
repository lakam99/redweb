# RedWeb

RedWeb is a simple and flexible Node.js framework built on top of Express.js and WebSocket. It allows you to quickly set up a web server with customizable options, including serving static files, defining custom API endpoints, and integrating WebSocket communication.

## Installation

To install RedWeb, use npm:

```bash
npm install redweb
```

## Usage

### Basic Example

To get started with RedWeb, simply initialize your RedWeb instance with the default options:

```javascript
const { HttpServer } = require('redweb');

const app = new HttpServer();
```

### Custom Configuration

You can also configure RedWeb according to your needs:

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
            // Implement your logic here
            res.status(200).json({ success: 'Form submitted successfully' });
        }
    }
];

const options = {
    port: 3000,
    publicPaths: [
        './pages/my_public_html',
        './content/my_public_images',
        './styles/styles.css'
    ],
    encoding: 'urlencoded',
    services: services
};

const app = new HttpServer(options);
```

### HTTPS Server

To create an HTTPS server, provide the SSL options including the paths to your SSL key and certificate files:

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

### WebSocket Server

To create a WebSocket server, use the `SocketServer` function:

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
        'msg': function (data) {
            console.log(data);
            this.send('guuuuuurl');
        }
    }
};

const socketServer = new SocketServer(options);
```

### Secure WebSocket Server

To create a secure WebSocket server, provide the SSL options:

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
        'msg': function (data) {
            console.log(data);
            this.send('guuuuuurl');
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
        'msg': function (data) {
            console.log(data);
            this.send('guuuuuurl');
        }
    }
});

// Access the list of connected clients
console.log(socketServer.clients); // Map of clients by their IP addresses
```

## Options

### HttpServer and HttpsServer Options

- **port**: The port number to bind the server (default: `80`).
- **bind**: The bind address for the server (default: `0.0.0.0`).
- **publicPaths**: An array of paths to serve static files from (default: `['./public']`).
- **services**: An array of services with their endpoints and handlers (default: `[]`).
- **listenCallback**: A callback function to execute once the server starts listening (default: `undefined`).
- **encoding**: The encoding type for the request bodies. It can be either `'json'` or `'urlencoded'` (default: `'json'`).
- **ssl**: SSL configuration for the HTTPS server. An object containing the paths to the SSL key and certificate files.

### SocketServer and SecureSocketServer Options

- **port**: The port number to bind the socket server (default: `3000`).
- **connectionOpenCallback**: Callback function to execute once a client connects.
- **connectionCloseCallback**: Callback function to execute once a client disconnects.
- **messageCallback**: Callback function to execute for every message received.
- **messageHandlers**: Object containing message handlers based on message type.
- **ssl**: SSL configuration for the SecureSocketServer. An object containing the paths to the SSL key and certificate files.

## License

MIT License
```