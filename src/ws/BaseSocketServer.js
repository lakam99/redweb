const WebSocket = require('ws');

/**
 * @typedef {Object} SocketServerOptions
 * @property {number} [port=3000] - The port number to bind the socket server.
 * @property {Function} [connectionOpenCallback] - Callback function to execute once a client connects.
 * @property {Function} [connectionCloseCallback] - Callback function to execute once a client disconnects.
 * @property {Function} [messageCallback] - Callback function to execute for every message received.
 * @property {Object} [messageHandlers] - Object containing message handlers based on message type.
 * @property {Object} [ssl] - SSL configuration for SecureSocketServer.
 * @property {string} [ssl.key] - Path to the SSL key file.
 * @property {string} [ssl.cert] - Path to the SSL certificate file.
 */

const SOCKET_OPTIONS = {
    port: 3000,
    connectionOpenCallback: undefined,
    connectionCloseCallback: undefined,
    messageCallback: undefined,
    messageHandlers: {
        ping: (socket, data) => socket.send(JSON.stringify({ type: 'pong' }))
    },
    ssl: null
};

class BaseSocketServer {
    /**
     * Base Socket Server
     * @param {Object} server - The HTTP or HTTPS server instance.
     * @param {SocketServerOptions} options - Configuration options for SocketServer.
     */
    constructor(server, options = {}) {
        this.wss = new WebSocket.Server({ server });
        this.clients = new Map();  // Use a Map to store clients by their IP addresses
        Object.assign(this, { ...SOCKET_OPTIONS, ...options });

        this.wss.on('connection', this.handleConnection.bind(this));
    }

    handleConnection(socket, req) {
        const ip = req.socket.remoteAddress;
        console.log(`New client connected: ${ip}`);
        this.clients.set(ip, socket);

        if (this.connectionOpenCallback) this.connectionOpenCallback(socket);

        socket.on('message', (message) => this.handleMessage(socket, message, ip));
        socket.on('close', () => this.handleClose(socket, ip));
        socket.on('error', (error) => this.handleError(socket, error, ip));
    }

    handleMessage(socket, message, ip) {
        try {
            console.info(`Received message from ${ip}: ${message}`);
            if (this.messageCallback) this.messageCallback(socket, message);

            const { type, data } = JSON.parse(message);
            if (this.messageHandlers[type]) {
                this.messageHandlers[type](socket, data);
            }
        } catch (error) {
            console.error(`Error handling message from ${ip}:`, error);
        }
    }

    handleClose(socket, ip) {
        console.log(`Client disconnected: ${ip}`);
        this.clients.delete(ip);
        if (this.connectionCloseCallback) this.connectionCloseCallback(socket);
    }

    handleError(socket, error, ip) {
        console.error(`Socket error from ${ip}:`, error);
    }
}

module.exports = {BaseSocketServer, SOCKET_OPTIONS};
