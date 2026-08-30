const { WebSocketServer } = require("ws");
const { sendJson, sendPayload, broadcast } = require("./util");
const { randomUUID } = require("crypto");
const { settleTasks, throwCleanupErrors } = require('../serverLifecycle');
const { closeWebSocketServer } = require('./shutdown');
const { AdmissionPolicy } = require('./AdmissionPolicy');
const TransportPolicy = require('./TransportPolicy');
const Metrics = require('./Metrics');
const RouteRuntime = require('./RouteRuntime');
const { ProtocolPolicy, ERROR_CODES } = require('./ProtocolPolicy');
const { InboundContractValidationError } = require('./ContractValidationError');
const { AccessDenied } = require('../access/AccessPolicy');

function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

function instantiate(ClassType, label) {
    if (typeof ClassType !== 'function') throw new TypeError(`${label} entries must be constructor functions.`);
    return new ClassType();
}

function withinDeadline(promise, timeoutMs, message) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        timer.unref?.();
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function sendJsonFromSocket(data) {
    return this.__redwebRouteOwner.send(this, data);
}

function broadcastFromSocket(data) {
    const route = this.__redwebRouteOwner;
    const sent = broadcast(
        [...route.clients.values()].filter(socket => socket !== this),
        data,
        route.transportPolicy
    );
    if (sent) route.metrics?.increment('redweb.messages.outbound', sent);
    return sent;
}

function sendEventFromSocket(type, payload, metadata) {
    const route = this.__redwebRouteOwner;
    return route.send(this, route.protocolPolicy.envelope(this.context.protocol.version, type, payload, metadata));
}

function sendProtocolErrorFromSocket(code, message, metadata) {
    const route = this.__redwebRouteOwner;
    return route.send(this, route.protocolPolicy.error(this.context.protocol.version, code, message, metadata));
}

function sendBinaryEventFromSocket(value) {
    return this.__redwebRouteOwner.sendBinary(this, value);
}

function handleRuntimeError(error) {
    const socket = this;
    socket.__redwebRouteOwner.handleError(socket, error);
    socket.close?.(1011, 'Message processing failed');
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
        admission,
        limits,
        orderedMessages = false,
        heartbeat,
        rooms,
        sessions,
        metrics,
        distribution,
        drainHandlers = false,
        protocol,
        maxPendingUpgrades = 64,
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
        if (typeof orderedMessages !== 'boolean') {
            throw new TypeError('`orderedMessages` must be a boolean.');
        }
        if (typeof drainHandlers !== 'boolean') {
            throw new TypeError('`drainHandlers` must be a boolean.');
        }
        if (!Number.isInteger(maxPendingUpgrades) || maxPendingUpgrades < 1) {
            throw new TypeError('`maxPendingUpgrades` must be a positive integer.');
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
        this.admissionPolicy = admission === undefined ? null : new AdmissionPolicy(admission);
        this.transportPolicy = limits === undefined && !orderedMessages
            ? null
            : new TransportPolicy(limits, orderedMessages);
        this.metrics = metrics === undefined ? null : new Metrics(metrics, path, this.logger);
        this.protocolPolicy = protocol === undefined || protocol === false ? null : new ProtocolPolicy(protocol);
        this.draining = false;
        this.maxPendingUpgrades = maxPendingUpgrades;
        this.pendingUpgrades = 0;
        this.pendingCapacity = 0;
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
        try {
            this.runtime = new RouteRuntime(this, { heartbeat, rooms, sessions, distribution, drainHandlers });
            Object.assign(this, this.runtime.expose());
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

    authorizeUpgrade(request, rawSocket, signal) {
        if (!this.admissionPolicy && !this.protocolPolicy) return true;
        return this.authorizePolicies(request, rawSocket, signal);
    }

    async authorizePolicies(request, rawSocket, signal) {
        if (this.admissionPolicy && !await this.admissionPolicy.authorize(request, rawSocket, this, signal)) return false;
        return this.protocolPolicy ? this.protocolPolicy.negotiate(request) : true;
    }

    reserveUpgrade(request) {
        if (this.draining || this.pendingUpgrades >= this.maxPendingUpgrades) return null;
        const clientKey = this.resolveRemoteAddress(request);
        const replacing = !this.allowDuplicateConnections && this.clients.has(clientKey);
        const capacity = !replacing;
        if (capacity && this.clients.size + this.pendingCapacity >= (this.transportPolicy?.maxConnections ?? Infinity)) {
            return null;
        }
        this.pendingUpgrades += 1;
        if (capacity) this.pendingCapacity += 1;
        return { capacity };
    }

    releaseUpgrade(reservation) {
        if (!reservation) return false;
        this.pendingUpgrades = Math.max(0, this.pendingUpgrades - 1);
        if (reservation.capacity) this.pendingCapacity = Math.max(0, this.pendingCapacity - 1);
        return true;
    }
    /**
     * Handles a new WebSocket connection.
     * @param {WebSocket} socket - The WebSocket connection instance.
     * @param {import('http').IncomingMessage} req - The HTTP request object associated with the connection.
     */
    handleConnection(socket, req) {
        const ip = this.resolveRemoteAddress(req);
        const clientKey = this.allowDuplicateConnections ? randomUUID() : ip;

        this.runtime.decorate(socket, req);

        this.logger.log?.(`New client connected: ${ip}`);

        if (!this.allowDuplicateConnections) {
            const existing = this.clients.get(clientKey);
            if (existing) {
                this.runtime.detach(existing);
                this.logger.warn?.(`Client ${ip} already connected, disconnecting existing connection.`);
                if (existing.sendEvent) {
                    existing.sendEvent('system.disconnect', { reason: 'replaced' });
                } else {
                    this.send(existing, { msg: 'You are being disconnected because a new client is connected with your IP address.' });
                }
                existing.close?.(1000, 'Replaced by a new connection');
            }
        }

        const replacesExisting = !this.allowDuplicateConnections && this.clients.has(clientKey);
        if (!replacesExisting && this.clients.size >= (this.transportPolicy?.maxConnections ?? Infinity)) {
            this.sendFailure(socket, ERROR_CODES.CAPACITY_REACHED, 'Server capacity reached');
            socket.close?.(1013, 'Server capacity reached');
            this.metrics?.increment('redweb.connections.rejected');
            return;
        }

        this.clients.set(clientKey, socket);
        socket.__redwebRouteOwner = this;
        socket.clientKey = clientKey;
        socket.__redwebClientKey = clientKey;
        socket.remoteAddress = socket.remoteAddress || ip;
        socket.isAssigned = false; // Tracks whether the socket has been assigned a handler.
        socket.sendJson = sendJsonFromSocket;
        socket.broadcast = broadcastFromSocket;
        if (this.protocolPolicy) {
            socket.sendEvent = sendEventFromSocket;
            socket.sendProtocolError = sendProtocolErrorFromSocket;
            if (this.protocolPolicy.binary) socket.sendBinaryEvent = sendBinaryEventFromSocket;
        }
        socket.__redwebRuntime = this.transportPolicy?.createRuntime(handleRuntimeError, socket) || null;

        socket.on('close', () => this.handleClose(socket));
        socket.on('error', (error) => this.handleError(socket, error));
        socket.on('message', (message, isBinary) => this.receiveMessage(socket, message, isBinary));
        this.runtime.attach(socket);
        this.metrics?.increment('redweb.connections.accepted');
        this.metrics?.gauge('redweb.connections.active', this.clients.size);

        this.invokeLifecycleHook(socket, () => this.connectionOpenCallback(socket, req), true);
        this.handlers.forEach((handler) => {
            this.invokeLifecycleHook(socket, () => handler.onInitialContact?.(socket, req), true);
        });
    }

    invokeLifecycleHook(socket, hook, closeOnError) {
        const task = () => Promise.resolve().then(hook).catch(error => {
                this.handleError(socket, error);
                if (!closeOnError) return;
                this.sendFailure(socket, ERROR_CODES.INITIALIZATION_FAILED, 'Connection initialization failed');
                socket.close?.(1011, 'Connection initialization failed');
            });
        void this.runtime.run(task);
    }

    send(socket, data) {
        const sent = this.transportPolicy
            ? sendJson(socket, data, this.transportPolicy)
            : sendJson(socket, data);
        if (sent) this.metrics?.increment('redweb.messages.outbound');
        return sent;
    }

    sendFailure(socket, code, message, metadata) {
        if (!this.protocolPolicy || !socket.context?.protocol) return this.send(socket, { error: message });
        return this.send(
            socket,
            this.protocolPolicy.error(socket.context.protocol.version, code, message, metadata)
        );
    }

    sendAccessFailure(socket, error, metadata) {
        if (!(error instanceof AccessDenied)) return false;
        if (this.protocolPolicy && socket.context?.protocol) this.sendFailure(socket, error.code, error.message, metadata);
        else this.send(socket, { code: error.code, error: error.message });
        return true;
    }

    async sendBinary(socket, value) {
        try {
            const encoded = await this.protocolPolicy.encodeBinary(value, socket.context);
            if (!encoded) return false;
            const sent = sendPayload(socket, encoded, this.transportPolicy);
            if (sent) this.metrics?.increment('redweb.messages.outbound');
            return sent;
        } catch (error) {
            this.handleError(socket, error);
            return false;
        }
    }

    receiveMessage(socket, message, isBinary) {
        if (this.draining) return false;
        this.metrics?.increment('redweb.messages.inbound');
        const runtime = socket.__redwebRuntime;
        if (this.transportPolicy && !this.transportPolicy.acceptsMessage(runtime)) {
            this.metrics?.increment('redweb.messages.rate_limited');
            if (this.transportPolicy.messageRate.action === 'disconnect') {
                this.sendFailure(socket, ERROR_CODES.RATE_LIMITED, 'Message rate exceeded');
                socket.close?.(1008, 'Message rate exceeded');
            }
            return false;
        }
        const task = () => this.runMessageTask(() => this.dispatchMessage(socket, message, isBinary));
        if (!runtime?.queue) {
            void task();
            return true;
        }
        if (runtime.queue.enqueue(task)) return true;
        runtime.queue.close();
        this.sendFailure(socket, ERROR_CODES.QUEUE_FULL, 'Message queue full');
        socket.close?.(1013, 'Message queue full');
        this.metrics?.increment('redweb.messages.queue_full');
        return false;
    }

    runMessageTask(task) {
        return this.runtime.run(task);
    }

    beginDrain() {
        if (this.draining) return false;
        this.draining = true;
        this.runtime.beginDrain();
        this.metrics?.gauge('redweb.ready', 0);
        return true;
    }

    isReady() {
        return !this.draining && this.runtime.isReady();
    }

    publish(type, payload) {
        return this.distribution ? this.distribution.publish(type, payload) : Promise.resolve(false);
    }

    dispatchMessage(socket, message, isBinary) {
        if (isBinary) return this.handleBinaryMessage(socket, message);
        try {
            return this.handleMessage(socket, JSON.parse(message));
        } catch (error) {
            this.logger.error?.(`Error parsing message from ${socket.remoteAddress}:`, error);
            this.metrics?.increment('redweb.messages.malformed');
            this.sendFailure(socket, ERROR_CODES.INVALID_MESSAGE, 'Invalid JSON format');
            socket.close?.(1003, 'Invalid JSON');
            return false;
        }
    }

    connectionOpenCallback(socket) {
        this.logger.log?.(`Opening new connection: ${socket.remoteAddress}`);
    }

    async handleMessage(sock, data) {
        if (this.protocolPolicy && !this.protocolPolicy.validateEnvelope(data, sock.context?.protocol?.version)) {
            this.sendFailure(sock, ERROR_CODES.INVALID_MESSAGE, 'Invalid protocol envelope');
            sock.close?.(1008, 'Invalid message');
            return false;
        }
        if (!data || typeof data !== 'object' || typeof data.type !== 'string' || !data.type) {
            this.sendFailure(sock, ERROR_CODES.INVALID_MESSAGE, 'Message must be an object with a non-empty string `type`');
            sock.close?.(1008, 'Invalid message');
            return false;
        }
        const handler = this.handlers.find((handler) => handler.name == data.type);
        if (!handler) {
            this.sendFailure(sock, ERROR_CODES.UNKNOWN_HANDLER, `No such handler ${data.type}`, { requestId: data.requestId });
            sock.close?.(1008, 'Unknown handler');
            return false;
        } else {
            try {
                await handler.handleMessage(sock, data);
                return true;
            } catch (error) {
                if (this.sendAccessFailure(sock, error, { requestId: data.requestId })) return false;
                if (error instanceof InboundContractValidationError) {
                    this.sendFailure(sock, error.code, error.message, { requestId: data.requestId });
                    sock.close?.(1008, 'Invalid contract payload');
                    return false;
                }
                this.logger.error?.(`Error handling message in handler ${handler.name}:`, error);
                this.metrics?.increment('redweb.handlers.failed');
                this.sendFailure(sock, ERROR_CODES.HANDLER_FAILED, this.exposeErrors ? errorMessage(error) : 'Handler failed', { requestId: data.requestId });
                sock.close?.(1011, 'Handler failed');
                return false;
            }
        }
    }

    async handleBinaryMessage(socket, buffer) {
        try {
            if (this.protocolPolicy) {
                if (!this.protocolPolicy.binary) {
                    this.sendFailure(socket, ERROR_CODES.BINARY_UNSUPPORTED, 'Binary messages are not supported on this protocol route');
                    return false;
                }
                const decoded = await this.protocolPolicy.decodeBinary(buffer, socket.context);
                if (!decoded) {
                    this.sendFailure(socket, ERROR_CODES.INVALID_MESSAGE, 'Invalid binary protocol message');
                    return false;
                }
                return this.handleMessage(socket, decoded);
            }
            const handlersWithPredicate = this.handlers.filter(handler => typeof handler.acceptsBinary === 'function');
            const handler = handlersWithPredicate.length
                ? handlersWithPredicate.find(handler => handler.acceptsBinary(socket, buffer))
                : this.handlers.find(handler => handler.onBinaryMessage !== undefined);

            if (!handler) {
                this.sendFailure(socket, ERROR_CODES.BINARY_UNSUPPORTED, 'Binary messages are not supported on this route');
                return false;
            }

            await handler.handleBinaryMessage(socket, buffer);
            return true;
        } catch (error) {
            if (this.sendAccessFailure(socket, error)) return false;
            this.logger.error?.('Error handling binary message:', error);
            this.metrics?.increment('redweb.handlers.failed');
            this.sendFailure(socket, ERROR_CODES.HANDLER_FAILED, this.exposeErrors ? errorMessage(error) : 'Binary handler failed');
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
        if (socket.__redwebCloseHandled) return false;
        socket.__redwebCloseHandled = true;
        const key = socket.clientKey || socket.__redwebClientKey;
        const ip = socket.remoteAddress || 'unknown';
        this.logger.log?.(`Client disconnected: ${ip}`);
        if (key !== undefined && key !== null && this.clients.get(key) === socket) this.clients.delete(key);
        this.runtime.detach(socket);
        socket.__redwebRuntime?.queue?.close();
        this.metrics?.increment('redweb.connections.closed');
        this.metrics?.gauge('redweb.connections.active', this.clients.size);
        this.invokeLifecycleHook(socket, () => this.connectionCloseCallback?.(socket), false);
        return true;
    }

    shutdown() {
        if (!this._shutdownPromise) this._shutdownPromise = this.performShutdown();
        return this._shutdownPromise;
    }

    async performShutdown() {
        this.beginDrain();
        const deadline = Date.now() + this.shutdownTimeoutMs;
        this.runtime.stopHeartbeat();
        const cleanup = settleTasks([
            ...this.services.map(service => () => service.onShutdown?.()),
            () => this.runtime.closeDistribution(),
            () => this.inFlight ? Promise.allSettled([...this.inFlight]) : undefined,
        ]);
        let errors;
        try {
            errors = await withinDeadline(
                cleanup,
                Math.max(0, deadline - Date.now()),
                'Route cleanup exceeded shutdownTimeoutMs.'
            );
        } catch (error) {
            errors = [error];
        }
        this.services = [];
        this.runtime.closeState();
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
            await closeWebSocketServer(this.server, clients, Math.max(0, deadline - Date.now()));
        } catch (error) {
            errors.push(error);
        }
        clients.forEach(socket => this.handleClose(socket));
        this.runtime.stopAcceptingWork();
        try {
            await withinDeadline(
                this.inFlight ? Promise.allSettled([...this.inFlight]) : Promise.resolve(),
                Math.max(0, deadline - Date.now()),
                'Route lifecycle cleanup exceeded shutdownTimeoutMs.'
            );
        } catch (error) {
            errors.push(error);
        }
        this.runtime.clearInFlight();
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
