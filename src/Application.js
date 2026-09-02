'use strict';

const LiveHtmlServer = require('./htmx/LiveHtmlServer');
const HttpServer = require('./http/HttpServer');
const HttpsServer = require('./http/HttpsServer');
const SocketServer = require('./ws/SocketServer');
const SocketService = require('./ws/SocketService');
const OwnedServerLifecycle = require('./OwnedServerLifecycle');
const { validateListenerOptions } = require('./serverLifecycle');
const { awaitStartupCleanup } = require('./StartupCleanup');
const { performance } = require('node:perf_hooks');

function classes(value, name) {
    if (!Array.isArray(value) || value.some(Type => typeof Type !== 'function')) {
        throw new TypeError(`\`${name}\` must be an array of classes.`);
    }
    return [...value];
}

function bounded(operation, milliseconds, label, signal) {
    let timer, abort;
    return Promise.race([
        Promise.resolve().then(() => {
            if (signal?.aborted) throw new Error('Application startup was cancelled.');
            return operation();
        }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded its deadline.`)), milliseconds); }),
        new Promise((_, reject) => {
            abort = () => reject(new Error('Application startup was cancelled.'));
            signal?.addEventListener('abort', abort, { once: true });
            if (signal?.aborted) abort();
        }),
    ]).finally(() => { clearTimeout(timer); signal?.removeEventListener('abort', abort); });
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
        this._onSignal = () => this._stopProcess();
        this._onClose = () => {
            if (this._stopping) return;
            if (this.options.signals) this._stopProcess();
            else void this.shutdown().catch(() => {});
        };
        this._onError = () => {
            if (this.options.signals) process.exitCode = 1;
            this._onClose();
        };
    }

    run() {
        if (this._stopping) return Promise.reject(new Error('An application cannot run after shutdown. Define a new application.'));
        if (this._runPromise) return this._runPromise;
        this._startupDeadline = performance.now() + this.options.startupTimeoutMs;
        this._runPromise = this._start().catch(async error => {
            this._stopping = true;
            this._abort.abort();
            try {
                const results = await Promise.allSettled([
                    this._withinShutdown(() => awaitStartupCleanup(error), 'Construction rollback'), this._cleanup(),
                ]);
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
            this._owner = this._live._ownedServer;
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
            await this._withinStartup(() => service.onInit(this, this._abort.signal), 'Application service initialization');
        }
        this._checkStarting();
        await this._listen();
        this._checkStarting();
        this.server.on('error', this._onError);
        this.server.once('close', this._onClose);
        if (options.listenCallback) await this._withinStartup(() => options.listenCallback(), 'Application listening callback');
        else this.http.logger?.log?.(`Redweb application listening on ${options.bind}:${this.server.address().port}`);
        this._checkStarting();
        return this;
    }

    _checkStarting() {
        if (this._stopping) throw new Error('Application startup was cancelled.');
    }

    async _listen() {
        const { server } = this;
        let ready, failed;
        const detach = () => {
            if (ready) server.off('listening', ready);
            if (failed) server.off('error', failed);
        };
        try {
            await this._withinStartup(() => new Promise((resolve, reject) => {
                failed = error => { detach(); reject(error); };
                ready = () => {
                    try {
                        // Node 18 can complete even a numeric-host lookup after
                        // AbortSignal closed the server. Close before accepting peers.
                        if (this._abort.signal.aborted) server.close();
                        detach();
                        resolve();
                    } catch (error) { failed(error); }
                };
                server.once('listening', ready);
                server.once('error', failed);
                server.listen({ port: this.options.port, host: this.options.bind, signal: this._abort.signal });
            }), 'Application listener startup');
        } finally {
            // Aborted native lookup may still emit an error or begin listening
            // on older Node releases. Keep these one-shot guards until it settles.
            // On newer Node, the unreachable closed server/guards are GC-able.
            if (!this._abort.signal.aborted) detach();
        }
    }

    shutdown() {
        if (!this._shutdownPromise) {
            this._stopping = true;
            this._deadline ??= performance.now() + this.options.shutdownTimeoutMs;
            this._abort.abort();
            this._shutdownPromise = Promise.resolve(this._runPromise).catch(() => {}).then(() => this._cleanup());
        }
        return this._shutdownPromise;
    }

    _stopProcess() {
        if (this._processStopping) return;
        this._processStopping = true;
        const timer = setTimeout(() => { process.exitCode = 1; process.exit(); }, this.options.shutdownTimeoutMs);
        void this.shutdown().then(() => clearTimeout(timer), () => { process.exitCode = 1; timer.unref(); });
    }

    _withinShutdown(operation, label) {
        this._deadline ??= performance.now() + this.options.shutdownTimeoutMs;
        return bounded(operation, Math.max(0, this._deadline - performance.now()), label);
    }

    _withinStartup(operation, label) {
        const remaining = this._startupDeadline - performance.now();
        if (remaining <= 0) return Promise.reject(new Error(`${label} exceeded its deadline.`));
        return bounded(operation, remaining, label, this._abort.signal);
    }

    _cleanup() {
        if (!this._cleanupPromise) this._cleanupPromise = this._dispose();
        return this._cleanupPromise;
    }

    async _dispose() {
        const errors = [];
        const close = async (operation, label) => {
            try { await this._withinShutdown(operation, label); } catch (error) { errors.push(error); }
        };
        // Drain handlers and close listeners before releasing their dependencies.
        if (this.server?.listening) {
            try { this.server.close(); } catch (error) { errors.push(error); }
        }
        if (this.sockets) await close(() => this.sockets.shutdown(), 'Socket shutdown');
        if (this._live) await close(() => this._live.manager.shutdown(), 'Page shutdown');
        if (this._owner) {
            await close(() => this._owner.close(Math.max(0, this._deadline - performance.now()), () => this.http.shutdown()), 'HTTP shutdown');
            errors.push(...this._owner.forceClose());
        }
        for (const service of [...this.services].reverse()) {
            await close(() => service.onShutdown(), 'Application service shutdown');
        }
        this.server?.off('error', this._onError);
        this.server?.off('close', this._onClose);
        if (!errors.length || !this._processStopping) {
            process.off('SIGINT', this._onSignal);
            process.off('SIGTERM', this._onSignal);
        }
        if (errors.length) throw new AggregateError(errors, 'Application shutdown failed.');
    }
}

function defineApp(options) { return new Application(options); }

module.exports = { Application, defineApp };
