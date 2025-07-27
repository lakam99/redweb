const { WebSocketServer } = require("ws");
const { sendJson, broadcast } = require("./util");
const { randomUUID } = require("crypto");

/**
 * Represents a WebSocket route configuration.
 * This class is used to define a specific WebSocket endpoint (`path`) and its associated handlers.
 */
class SocketRoute {
    /**
     * Creates a new instance of `SocketRoute`.
     * @param {Object} options - Configuration options for the WebSocket route.
     * @param {string} options.path - The path of the WebSocket route (e.g., `/chat`, `/lobby`).
     * @param {boolean} options.allowDuplicateConnections - Whether to allow multiple connections from the same client IP address.
     * @param {import('./BaseHandler').BaseHandler[]} options.handlers - An array of handler instances that manage connections and messages for this route.
     */
    constructor({path, handlers, allowDuplicateConnections } = {}) {
        if (!path) {
            throw new Error('A `path` must be specified for the SocketRoute.');
        }
        if (!handlers || !Array.isArray(handlers) || handlers.length === 0) {
            throw new Error('At least one handler must be specified for the SocketRoute.');
        }
        /**
         * The path of the WebSocket route.
         * This determines the endpoint that clients must connect to (e.g., `ws://localhost:3000/chat`).
         * @type {string}
         */
        this.path = path;
        /**
         * The array of handler instances associated with this route.
         * Each handler is responsible for managing WebSocket connections and message handling logic.
         * @type {import('./BaseHandler').BaseHandler[]}
         */
        this.handlers = handlers.map(HandlerClass => new HandlerClass());
        this.clients = new Map();
        this.server = new WebSocketServer({ noServer: true, path });
        this.server.on('connection', this.handleConnection.bind(this));
        this.allowDuplicateConnections = allowDuplicateConnections;
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
        if (this.allowDuplicateConnections) {
            this.clients.set(randomUUID(), socket);
        } else {
            if (this.clients.get(ip) !== undefined) {
                const oldClient = this.clients.get(ip);
                console.warn(`Client ${ip} already connected, disconnecting existing connection.`);
                oldClient.send(
                    JSON.stringify({ msg: 'You are being disconnected because a new client is connected with your IP address.' })
                );
                oldClient.close();
            }
            this.clients.set(ip, socket);
        }
        socket.isAssigned = false; // Tracks whether the socket has been assigned a handler.
        socket.sendJson = (data) => sendJson(socket, data);
        socket.broadcast = (data) => broadcast([...this.clients.values()].filter(sock => sock !== socket), data);

        this.connectionOpenCallback(socket);
        socket.on('close', this.handleClose.bind(this));
        socket.on('error', this.handleError.bind(this));
        socket.on('message', (message) => {
            try {
                const parsed = JSON.parse(message);
                this.handleMessage(socket, parsed);
            } catch (error) {
                console.error(`Error parsing message from ${ip}:`, error);
                socket.sendJson({ error: 'Invalid JSON format' });
                socket.close();
                return;
            }
        });
    }

    connectionOpenCallback(socket) {
        console.log(`Opening new connection: ${socket.remoteAddress}`);
    }

    handleMessage(sock, data) {
        const handler = this.handlers.find((handler) => handler.name == data.type);
        if (!handler) {
            sendJson(sock, {error: `No such handler ${data.type}`});
            sock.close();
        } else {
            try {
                handler.handleMessage(sock, data);
            } catch (error) {
                console.error(`Error handling message in handler ${handler.name}:`, error);
                sendJson(sock, { error: `${error.message}` });
                sock.close();
            }
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
}

module.exports = SocketRoute;