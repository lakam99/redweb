'use strict';

const LiveHtmlServer = require('./htmx/LiveHtmlServer');
const HttpServer = require('./http/HttpServer');
const HttpsServer = require('./http/HttpsServer');
const SocketServer = require('./ws/SocketServer');
const SocketService = require('./ws/SocketService');
const OwnedServerLifecycle = require('./OwnedServerLifecycle');
const { validateListenerOptions } = require('./serverLifecycle');
const { awaitStartupCleanup } = require('./StartupCleanup');

function classes(value, name) {
    if (!Array.isArray(value) || value.some(Type => typeof Type !== 'function')) {
        throw new TypeError(`\`${name}\` must be an array of classes.`);
    }
    return [...value];
}

function bounded(operation, milliseconds, label) {
    let timer;
    return Promise.race([
        Promise.resolve().then(operation),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded its deadline.`)), milliseconds); }),
    ]).finally(() => clearTimeout(timer));
}

/** One deferred application definition, one listener and one cleanup owner. */
class Application {
    constructor(options = {}) {
        if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Application options must be an object.');
        const { pages = [], sockets = [], services = [], port = 8181, bind = '0.0.0.0',
            startupTimeoutMs = 5000, shutdownTimeoutMs = 5000, signals = true, ...rest } = options;
        for (const name of ['listen', 'routes', 'socketRoutes', 'closeServerOnShutdown']) {
            if (name in rest) throw new TypeError(`defineApp owns \`${name}\`; use pages/sockets and run().`);
        }
        validateListenerOptions({ port, bind, listen: false, listenCallback: rest.listenCallback });
        for (const value of [startupTimeoutMs, shutdownTimeoutMs]) {
            if (!Number.isInteger(value) || value < 1 || value > 2147483647) throw new RangeError('Application deadlines must be positive timer-safe integers.');
        }
        if (typeof signals !== 'boolean') throw new TypeError('`signals` must be a boolean.');
        this.options = { ...rest, pages: classes(pages, 'pages'), sockets: classes(sockets, 'sockets'),
            services: classes(services, 'services'), port, bind, startupTimeoutMs, shutdownTimeoutMs, signals };
        if (this.options.services.some(Type => Type === SocketService || Type.prototype instanceof SocketService)) {
            throw new TypeError('SocketService belongs to a socket route, not application services.');
        }
        this.services = [];
        this.server = null;
        this.app = null;
        this.http = null;
        this.sockets = null;
        this._live = null;
        this._owner = null;
        this._runPromise = null;
        this._shutdownPromise = null;
        this._cleanupPromise = null;
        this._stopping = false;
        this._abort = new AbortController();
        this._onSignal = () => { void this.shutdown().catch(() => { process.exitCode = 1; }); };
        this._onError = () => { process.exitCode = 1; this._onSignal(); };
    }

    run() {
        if (this._runPromise) return this._runPromise;
        if (this._stopping) return Promise.reject(new Error('An application cannot run after shutdown. Define a new application.'));
        this._runPromise = this._start().catch(async error => {
            this._stopping = true;
            this._abort.abort();
            try {
                const results = await Promise.allSettled([awaitStartupCleanup(error), this._cleanup()]);
                const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
                if (errors.length) throw new AggregateError(errors, 'Application rollback failed.');
            }
            catch (cleanup) { throw new AggregateError([error, cleanup], 'Application startup and cleanup failed.', { cause: error }); }
            throw error;
        });
        return this._runPromise;
    }

    async _start() {
        const { pages, sockets, services, startupTimeoutMs, shutdownTimeoutMs, signals, httpServices = [], ...options } = this.options;
        if (signals) {
            process.on('SIGINT', this._onSignal);
            process.on('SIGTERM', this._onSignal);
        }
        const httpOptions = { ...options, services: httpServices, listen: false, shutdownTimeoutMs };
        if (pages.length) {
            this._live = new LiveHtmlServer({ ...httpOptions, pages, socketRoutes: sockets });
            this.http = this._live.http;
            this.sockets = this._live.sockets;
        } else {
            const Server = options.ssl ? HttpsServer : HttpServer;
            this.http = new Server(httpOptions);
            this._owner = new OwnedServerLifecycle(this.http.server);
        }
        this.server = this.http.server;
        this.app = this.http.app;
        if (!pages.length && sockets.length) {
            this.sockets = new SocketServer({ server: this.server, routes: sockets, listen: false,
                closeServerOnShutdown: false, logger: options.logger });
        }
        for (const Service of services) {
            this._checkStarting();
            const service = new Service();
            this.services.push(service);
            if (typeof service.onInit !== 'function' || typeof service.onShutdown !== 'function') {
                throw new TypeError('Application services require onInit(app, signal) and onShutdown().');
            }
            await bounded(() => service.onInit(this, this._abort.signal), startupTimeoutMs, 'Application service initialization');
        }
        this._checkStarting();
        await this._listen();
        this._checkStarting();
        this.server.on('error', this._onError);
        this.server.once('close', this._onSignal);
        if (options.listenCallback) options.listenCallback();
        else options.logger?.log?.(`Redweb application listening on ${options.bind}:${this.server.address().port}`);
        return this;
    }

    _checkStarting() {
        if (this._stopping) throw new Error('Application startup was cancelled.');
    }

    async _listen() {
        const { server } = this;
        let ready, failed;
        try {
            await bounded(() => new Promise((resolve, reject) => {
                ready = resolve;
                failed = reject;
                server.once('listening', ready);
                server.once('error', failed);
                server.listen(this.options.port, this.options.bind);
            }), this.options.startupTimeoutMs, 'Application listener startup');
        } finally {
            server.off('listening', ready);
            server.off('error', failed);
        }
    }

    shutdown() {
        if (!this._shutdownPromise) {
            this._stopping = true;
            this._abort.abort();
            this._shutdownPromise = Promise.resolve(this._runPromise).catch(() => {}).then(() => this._cleanup());
        }
        return this._shutdownPromise;
    }

    _cleanup() {
        if (!this._cleanupPromise) this._cleanupPromise = this._dispose();
        return this._cleanupPromise;
    }

    async _dispose() {
        const errors = [];
        const close = async operation => {
            try { await operation(); } catch (error) { errors.push(error); }
        };
        // Drain handlers and close listeners before releasing their dependencies.
        if (this._live) await close(() => this._live.shutdown());
        else {
            if (this.sockets) await close(() => this.sockets.shutdown());
            if (this._owner) await close(() => this._owner.close(this.options.shutdownTimeoutMs, () => this.http.shutdown()));
        }
        for (const service of [...this.services].reverse()) {
            await close(() => bounded(() => service.onShutdown(), this.options.shutdownTimeoutMs, 'Application service shutdown'));
        }
        this.server?.off('error', this._onError);
        this.server?.off('close', this._onSignal);
        process.off('SIGINT', this._onSignal);
        process.off('SIGTERM', this._onSignal);
        if (errors.length) throw new AggregateError(errors, 'Application shutdown failed.');
    }
}

function defineApp(options) { return new Application(options); }

module.exports = { Application, defineApp };
