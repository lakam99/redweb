const WebSocket = require('ws');

/**
 * @typedef {Object} SocketServerOptions
 * @property {import('http').Server} [server] - The HTTP server instance to bind the WebSocket server to.
 * @property {number} [port=3000] - The port number for the WebSocket server.
 * @property {(socket: WebSocket) => void} [connectionOpenCallback] - Callback executed when a client connects.
 * @property {(socket: WebSocket) => void} [connectionCloseCallback] - Callback executed when a client disconnects.
 * @property {(socket: WebSocket, message: object) => void} [messageCallback] - Callback executed when a message is received.
 * @property {Record<string, (socket: WebSocket, data: object) => void>} [messageHandlers] - A dictionary of message types and their corresponding handler functions.
 * @property {{ key: string, cert: string } | null} [ssl] - SSL configuration for a secure WebSocket server.
 * @property {Array<new () => BaseHandler>} [handlerConfig] - An array of handler classes to use for routing.
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

/**
 * Broadcasts a message to all connected clients.
 * @param {BaseSocketServer} socketServer - The WebSocket server instance.
 * @param {object} message - The message to broadcast.
 */
function broadcast(socketServer, message) {
    socketServer.clients.forEach(client => client.send(JSON.stringify(message)));
}

/**
 * Represents the base WebSocket server.
 */
class BaseSocketServer {
    /**
     * @param {import('http').Server} server - The HTTP server instance to bind the WebSocket server to.
     * @param {SocketServerOptions} options - The configuration options for the WebSocket server.
     */
    constructor(server, options = {}) {
        this.wss = new WebSocket.Server({ server });
        this.clients = new Map(); // Map of clients by their IP addresses.
        Object.assign(this, { ...SOCKET_OPTIONS, ...options });

        this.handlers = this.initHandlers(options.handlerConfig || []);
        this.wss.on('connection', this.handleConnection.bind(this));
    }

    /**
     * Initializes the handler classes.
     * @param {Array<new () => BaseHandler>} handlerConfig - Array of handler classes.
     * @returns {BaseHandler[]} - Array of handler instances.
     */
    initHandlers(handlerConfig) {
        return handlerConfig.map(HandlerClass => new HandlerClass());
    }

    /**
     * Adds a new handler to the WebSocket server.
     * @param {new () => BaseHandler} HandlerClass - The handler class to add.
     */
    addHandler(HandlerClass) {
        const newHandler = new HandlerClass();
        if (this.handlers.find(handler => handler.name === newHandler.name)) {
            console.warn(`Handler with name '${newHandler.name}' already exists.`);
            return;
        }
        this.handlers.push(newHandler);
        console.log(`Handler '${newHandler.name}' added successfully.`);
    }

    /**
     * Handles a new WebSocket connection.
     * @param {WebSocket} socket - The WebSocket connection instance.
     * @param {import('http').IncomingMessage} req - The HTTP request object associated with the connection.
     */
    handleConnection(socket, req) {
        const ip = req.socket.remoteAddress;
        console.log(`New client connected: ${ip}`);
        if (this.clients.get(ip) !== undefined) {
            const oldClient = this.clients.get(ip);
            console.warn(`Client ${ip} already connected, disconnecting existing connection.`);
            oldClient.send(
                JSON.stringify({ msg: 'You are being disconnected because a new client is connected with your IP address.' })
            );
            oldClient.close();
        }
        this.clients.set(ip, socket);
        socket.isAssigned = false; // Tracks whether the socket has been assigned a handler.

        if (this.connectionOpenCallback) this.connectionOpenCallback(socket);

        socket.on('message', message => this.initialMessageHandler(socket, message, ip));
        socket.on('close', () => this.handleClose(socket, ip));
        socket.on('error', error => this.handleError(socket, error, ip));
    }

    /**
     * Processes the initial message to determine if a handler assignment is required.
     * @param {WebSocket} socket - The WebSocket connection instance.
     * @param {string} message - The received message.
     * @param {string} ip - The client's IP address.
     */
    initialMessageHandler(socket, message, ip) {
        try {
            const parsedMessage = JSON.parse(message);

            // If the first message is '__handlerConnect', attempt to assign a handler
            if (parsedMessage.type === '__handlerConnect') {
                this.assignToHandler(socket, parsedMessage);
                return;
            }

            // If no handler is assigned, use the default messageHandlers or fallback
            if (!socket.isAssigned) {
                this.handleMessage(socket, parsedMessage, ip);
            } else {
                throw new Error('Unexpected message after handler assignment');
            }
        } catch (error) {
            console.error(`Error handling initial message from ${ip}:`, error);
            socket.close(); // Optionally close the socket for invalid behavior.
        }
    }

    /**
     * Assigns the socket to a specific handler.
     * @param {WebSocket} socket - The WebSocket connection instance.
     * @param {{ handlerName: string, key?: string }} data - Data containing the handler name and optional authentication key.
     */
    assignToHandler(socket, connectMessage) {
        if (!connectMessage.data) {
            console.warn(`No data provided for handlerConnect message.`);
            socket.close();
            return;
        }
        const { handlerName, data } = connectMessage.data;
        const handler = this.handlers.find(h => h.name === handlerName);
        if (!handler) {
            console.warn(`Handler not found: ${handlerName}`);
            socket.send(JSON.stringify({ error: `Handler '${handlerName}' not found` }));
            socket.close();
            return;
        }

        // Optional: Perform authentication with `key`
        socket.removeAllListeners('message');
        handler.newConnection(socket, connectMessage.data);
    }

    /**
     * Handles a message using the default messageHandlers.
     * @param {WebSocket} socket - The WebSocket connection instance.
     * @param {{ type: string, [key: string]: any }} parsedMessage - The parsed message object.
     * @param {string} ip - The client's IP address.
     */
    handleMessage(socket, parsedMessage, ip) {
        const { type, ...data } = parsedMessage;

        if (this.messageCallback) this.messageCallback(socket, parsedMessage);

        if (this.messageHandlers[type]) {
            this.messageHandlers[type](socket, data);
        } else {
            console.warn(`Unhandled message type from ${ip}: ${type}`);
            socket.close();
        }
    }

    /**
     * Handles socket disconnection.
     * @param {WebSocket} socket - The WebSocket connection instance.
     * @param {string} ip - The client's IP address.
     */
    handleClose(socket, ip) {
        console.log(`Client disconnected: ${ip}`);
        this.clients.delete(ip);
        if (this.connectionCloseCallback) this.connectionCloseCallback(socket);
    }

    /**
     * Handles socket errors.
     * @param {WebSocket} socket - The WebSocket connection instance.
     * @param {Error} error - The error object.
     * @param {string} ip - The client's IP address.
     */
    handleError(socket, error, ip) {
        console.error(`Socket error from ${ip}:`, error);
    }

    /**
     * Broadcasts a message to all connected clients.
     * @param {object} message - The message to broadcast.
     */
    broadcast(message) {
        broadcast(this, message);
    }
}

module.exports = { BaseSocketServer, SOCKET_OPTIONS };
