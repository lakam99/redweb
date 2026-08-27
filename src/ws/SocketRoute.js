const { WebSocketServer } = require("ws");
const { sendJson, broadcast } = require("./util");
const { randomUUID } = require("crypto");
const { settleTasks, throwCleanupErrors } = require('../serverLifecycle');
const { closeWebSocketServer } = require('./shutdown');

function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

function instantiate(ClassType, label) {
    if (typeof ClassType !== 'function') throw new TypeError(`${label} entries must be constructor functions.`);
    return new ClassType();
}

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
     * @param {Array<new () => SocketService>} [options.services] 
     * @param {import('ws').ServerOptions} [options.websocketOptions] - Options passed to the underlying WebSocketServer.
    */
    constructor({
        path,
        handlers,
        services = [],
        allowDuplicateConnections = false,
        websocketOptions = {},
        trustProxy = false,
        getClientKey,
        exposeErrors = false,
        logger = console,
        shutdownTimeoutMs = 1000,
    } = {}) {
        if (typeof path !== 'string' || !path.startsWith('/')) {
            throw new Error('A `path` beginning with "/" must be specified for the SocketRoute.');
        }
        if (!handlers || !Array.isArray(handlers) || handlers.length === 0) {
            throw new Error('At least one handler must be specified for the SocketRoute.');
        }
        if (!Array.isArray(services)) throw new TypeError('`services` must be an array.');
        if (!websocketOptions || typeof websocketOptions !== 'object' || Array.isArray(websocketOptions)) {
            throw new TypeError('`websocketOptions` must be an object.');
        }
        if (getClientKey !== undefined && typeof getClientKey !== 'function') {
            throw new TypeError('`getClientKey` must be a function.');
        }
        const reservedOption = ['noServer', 'path', 'server', 'port']
            .find(option => Object.prototype.hasOwnProperty.call(websocketOptions, option));
        if (reservedOption) throw new TypeError(`Redweb controls websocketOptions.${reservedOption}.`);
        if (!Number.isInteger(shutdownTimeoutMs) || shutdownTimeoutMs < 0) {
            throw new TypeError('`shutdownTimeoutMs` must be a non-negative integer.');
        }
        /**
         * The path of the WebSocket route.
         * This determines the endpoint that clients must connect to (e.g., `ws://localhost:3000/chat`).
         * @type {string}
         */
        this.path = path;
        this.websocketOptions = { ...websocketOptions };
        this.logger = logger || { log() {}, warn() {}, error() {} };
        this.trustProxy = trustProxy;
        this.getClientKey = getClientKey;
        this.exposeErrors = exposeErrors;
        this.shutdownTimeoutMs = shutdownTimeoutMs;
        /**
         * The array of handler instances associated with this route.
         * Each handler is responsible for managing WebSocket connections and message handling logic.
         * @type {import('./BaseHandler').BaseHandler[]}
         */
        this.handlers = handlers.map(HandlerClass => instantiate(HandlerClass, 'Handler'));
        const handlerNames = this.handlers.map(handler => handler.name);
        if (handlerNames.some(name => typeof name !== 'string' || !name)) {
            throw new TypeError('Every handler must have a non-empty name.');
        }
        if (new Set(handlerNames).size !== handlerNames.length) {
            throw new Error('Handler names must be unique within a route.');
        }
        this.clients = new Map();
        this.server = new WebSocketServer({ ...websocketOptions, noServer: true });
        this.server.on('connection', this.handleConnection.bind(this));
        this.allowDuplicateConnections = Boolean(allowDuplicateConnections);

        /* ─── ROUTE‑SCOPED SERVICES ─────────────────────────── */
        this.services = [];
        try {
            services.forEach(SvcClass => {
                const svc = instantiate(SvcClass, 'Service');
                this.services.push(svc);
                if (typeof svc.onInit !== 'function') return;
                const result = svc.onInit(this);
                if (result && typeof result.then === 'function') {
                    result.catch(() => {});
                    throw new TypeError('SocketService.onInit must be synchronous.');
                }
            });
        } catch (error) {
            this.disposeServices();
            this.server.close();
            throw error;
        }
    }

    disposeServices() {
        this.services.forEach(service => {
            Promise.resolve()
                .then(() => service.onShutdown?.())
                .catch(error => this.logger.error?.('Error shutting down service:', error));
        });
    }
    /**
     * Adds a new handler to the WebSocket server.
     * @param {new () => BaseHandler} HandlerClass - The handler class to add.
     */
    addHandler(HandlerClass) {
        const newHandler = instantiate(HandlerClass, 'Handler');
        if (this.handlers.find(handler => handler.name === newHandler.name)) {
            this.logger.warn?.(`Handler with name '${newHandler.name}' already exists.`);
            return false;
        }
        if (typeof newHandler.name !== 'string' || !newHandler.name) throw new TypeError('A handler must have a non-empty name.');
        this.handlers.push(newHandler);
        this.logger.log?.(`Handler '${newHandler.name}' added successfully.`);
        return true;
    }

    resolveRemoteAddress(req) {
        if (this.getClientKey) return String(this.getClientKey(req));
        if (this.trustProxy) {
            const forwarded = req?.headers?.['x-forwarded-for'];
            if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
        }
        return req?.socket?.remoteAddress || 'unknown';
    }
    /**
     * Handles a new WebSocket connection.
     * @param {WebSocket} socket - The WebSocket connection instance.
     * @param {import('http').IncomingMessage} req - The HTTP request object associated with the connection.
     */
    handleConnection(socket, req) {
        const ip = this.resolveRemoteAddress(req);
        const clientKey = this.allowDuplicateConnections ? randomUUID() : ip;

        this.logger.log?.(`New client connected: ${ip}`);

        if (!this.allowDuplicateConnections) {
            const existing = this.clients.get(clientKey);
            if (existing) {
                this.logger.warn?.(`Client ${ip} already connected, disconnecting existing connection.`);
                sendJson(existing, { msg: 'You are being disconnected because a new client is connected with your IP address.' });
                existing.close?.(1000, 'Replaced by a new connection');
            }
        }

        this.clients.set(clientKey, socket);
        socket.clientKey = clientKey;
        socket.__redwebClientKey = clientKey;
        socket.remoteAddress = socket.remoteAddress || ip;
        socket.isAssigned = false; // Tracks whether the socket has been assigned a handler.
        socket.sendJson = (data) => sendJson(socket, data);
        socket.broadcast = (data) => broadcast([...this.clients.values()].filter(sock => sock !== socket), data);

        socket.on('close', () => this.handleClose(socket));
        socket.on('error', (error) => this.handleError(socket, error));
        socket.on('message', (message, isBinary) => {
            if (isBinary) {
                void this.handleBinaryMessage(socket, message);
                return;
            }

            try {
                const parsed = JSON.parse(message);
                void this.handleMessage(socket, parsed);
            } catch (error) {
                this.logger.error?.(`Error parsing message from ${ip}:`, error);
                socket.sendJson({ error: 'Invalid JSON format' });
                socket.close?.(1003, 'Invalid JSON');
                return;
            }
        });

        this.invokeLifecycleHook(socket, () => this.connectionOpenCallback(socket, req), true);
        this.handlers.forEach((handler) => {
            this.invokeLifecycleHook(socket, () => handler.onInitialContact?.(socket, req), true);
        });
    }

    invokeLifecycleHook(socket, hook, closeOnError) {
        Promise.resolve()
            .then(hook)
            .catch(error => {
                this.handleError(socket, error);
                if (!closeOnError) return;
                sendJson(socket, { error: 'Connection initialization failed' });
                socket.close?.(1011, 'Connection initialization failed');
            });
    }

    connectionOpenCallback(socket) {
        this.logger.log?.(`Opening new connection: ${socket.remoteAddress}`);
    }

    async handleMessage(sock, data) {
        if (!data || typeof data !== 'object' || typeof data.type !== 'string' || !data.type) {
            sendJson(sock, { error: 'Message must be an object with a non-empty string `type`' });
            sock.close?.(1008, 'Invalid message');
            return false;
        }
        const handler = this.handlers.find((handler) => handler.name == data.type);
        if (!handler) {
            sendJson(sock, { error: `No such handler ${data.type}` });
            sock.close?.(1008, 'Unknown handler');
            return false;
        } else {
            try {
                await handler.handleMessage(sock, data);
                return true;
            } catch (error) {
                this.logger.error?.(`Error handling message in handler ${handler.name}:`, error);
                sendJson(sock, { error: this.exposeErrors ? errorMessage(error) : 'Handler failed' });
                sock.close?.(1011, 'Handler failed');
                return false;
            }
        }
    }

    async handleBinaryMessage(socket, buffer) {
        try {
            const handlersWithPredicate = this.handlers.filter(handler => typeof handler.acceptsBinary === 'function');
            const handler = handlersWithPredicate.length
                ? handlersWithPredicate.find(handler => handler.acceptsBinary(socket, buffer))
                : this.handlers.find(handler => handler.onBinaryMessage !== undefined);

            if (!handler) {
                sendJson(socket, { error: 'Binary messages are not supported on this route' });
                return false;
            }

            await handler.handleBinaryMessage(socket, buffer);
            return true;
        } catch (error) {
            this.logger.error?.('Error handling binary message:', error);
            sendJson(socket, { error: this.exposeErrors ? errorMessage(error) : 'Binary handler failed' });
            socket.close?.(1011, 'Binary handler failed');
            return false;
        }
    }

    /**
     * Handles socket disconnection.
     * @param {WebSocket} socket - The WebSocket connection instance.
     * @param {string} ip - The client's IP address.
     */
    handleClose(socket) {
        const key = socket.clientKey || socket.__redwebClientKey;
        const ip = socket.remoteAddress || 'unknown';
        this.logger.log?.(`Client disconnected: ${ip}`);
        if (key !== undefined && key !== null && this.clients.get(key) === socket) this.clients.delete(key);
        this.invokeLifecycleHook(socket, () => this.connectionCloseCallback?.(socket), false);
    }

    shutdown() {
        if (!this._shutdownPromise) this._shutdownPromise = this.performShutdown();
        return this._shutdownPromise;
    }

    async performShutdown() {
        const errors = await settleTasks(this.services.map(service => () => service.onShutdown?.()));
        const clients = [...this.clients.values()];
        clients.forEach(socket => {
            try {
                socket.close?.(1001, 'Server shutting down');
            } catch (error) {
                errors.push(error);
            }
        });
        this.clients.clear();
        try {
            await closeWebSocketServer(this.server, clients, this.shutdownTimeoutMs);
        } catch (error) {
            errors.push(error);
        }
        throwCleanupErrors(errors, 'One or more WebSocket route cleanup operations failed.');
    }

    /**
     * Handles socket errors.
     * @param {WebSocket} socket - The WebSocket connection instance.
     * @param {Error} error - The error object.
     * @param {string} ip - The client's IP address.
     */
    handleError(socket, error) {
        const ip = socket.remoteAddress || 'unknown';
        this.logger.error?.(`Socket error from ${ip}:`, error);
    }
}

module.exports = SocketRoute;
