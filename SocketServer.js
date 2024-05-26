const http = require('http');
const https = require('https');
const socketIo = require('socket.io');
const loadSslConfig = require('./sslConfig');

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
        'ping': (socket) => socket.send('pong')
    },
    ssl: null
};

/**
 * Base Socket Server
 * @param {Object} server - The HTTP or HTTPS server instance.
 * @param {SocketServerOptions} options - Configuration options for SocketServer.
 * @return {Object} Socket.IO server instance.
 */
function BaseSocketServer(server, options = {}) {
    this.io = socketIo(server);
    Object.assign(this, { ...SOCKET_OPTIONS, ...options });

    this.io.on('connection', socket => {
        console.log('New client connected');
        if (this.connectionOpenCallback) this.connectionOpenCallback(socket);

        socket.on('message', (message) => {
            try {
                const parsedMessage = JSON.parse(message);
                const { type, data } = parsedMessage;

                if (this.messageHandlers[type]) {
                    this.messageHandlers[type](socket, data);
                }

                if (this.messageCallback) this.messageCallback(socket, message);
            } catch (error) {
                console.error('Error handling message:', error);
            }
        });

        socket.on('disconnect', () => {
            console.log('Client disconnected');
            if (this.connectionCloseCallback) this.connectionCloseCallback(socket);
        });

        socket.on('error', (error) => {
            console.error('Socket error:', error);
        });
    });
}

/**
 * WebSocket Server
 * @param {SocketServerOptions} options - Configuration options for SocketServer.
 * @return {Object} Socket.IO server instance.
 */
function SocketServer(options = {}) {
    const server = http.createServer();
    BaseSocketServer.call(this, server, options);
    server.listen(this.port, () => console.log(`RedWeb SocketServer listening on port ${this.port}`));
    return this.io;
}

/**
 * Secure WebSocket Server
 * @param {SocketServerOptions} options - Configuration options for SecureSocketServer.
 * @return {Object} Socket.IO server instance.
 */
function SecureSocketServer(options = {}) {
    const sslOptions = loadSslConfig(options.ssl);
    const server = https.createServer(sslOptions);
    BaseSocketServer.call(this, server, options);
    server.listen(this.port, () => console.log(`RedWeb SecureSocketServer listening on port ${this.port}`));
    return this.io;
}

module.exports = {
    SocketServer,
    SecureSocketServer,
    SOCKET_OPTIONS
};
