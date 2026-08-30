const express = require('express');
const HttpServer = require('../http/HttpServer');
const HttpsServer = require('../http/HttpsServer');
const SocketServer = require('../ws/SocketServer');
const { PageManager } = require('./PageManager');

class LiveHtmlServer {
    constructor(options = {}) {
        if (!options || typeof options !== 'object' || Array.isArray(options)) {
            throw new TypeError('Live HTML server options must be an object.');
        }
        const {
            pages,
            templateRoot,
            livePaths,
            sessionTtlMs,
            maxSessions,
            maxConcurrentRenders,
            shutdownTimeoutMs = 1000,
            heartbeat,
            authenticate,
            authenticationTimeoutMs,
            origins,
            server: suppliedApp,
            ...httpOptions
        } = options;
        const app = suppliedApp === undefined ? express() : suppliedApp;
        if (!app || typeof app.get !== 'function' || typeof app.use !== 'function') {
            throw new TypeError('`server` must be an Express-compatible application.');
        }
        this.manager = new PageManager({
            pages,
            templateRoot,
            paths: livePaths,
            sessionTtlMs,
            maxSessions,
            maxConcurrentRenders,
            shutdownTimeoutMs,
            heartbeat,
            authenticate,
            authenticationTimeoutMs,
            origins,
            logger: httpOptions.logger,
        });
        this.manager.mount(app);
        const listen = httpOptions.listen ?? true;
        const ServerClass = httpOptions.ssl ? HttpsServer : HttpServer;
        this.http = new ServerClass({ ...httpOptions, server: app, listen: this.manager.hasLivePages ? false : listen });
        if (this.manager.hasLivePages) {
            const Route = this.manager.route();
            this.sockets = new SocketServer({
                server: this.http.server,
                routes: [Route],
                listen,
                port: this.http.port,
                bind: this.http.bind,
                listenCallback: this.http.listenCallback,
                logger: this.http.logger,
                closeServerOnShutdown: false,
            });
        } else {
            this.sockets = null;
        }
        this.app = this.http.app;
        this.server = this.http.server;
        this._shutdownPromise = null;
    }

    revoke(principal) { return this.manager.revoke(principal); }

    shutdown() {
        if (!this._shutdownPromise) {
            this._shutdownPromise = this.performShutdown();
        }
        return this._shutdownPromise;
    }

    async performShutdown() {
        const errors = [];
        if (this.sockets) {
            try { await this.sockets.shutdown(); }
            catch (error) { errors.push(error); }
        }
        try { await this.manager.shutdown(); }
        catch (error) {
            errors.push(error);
            if (error?.code === 'LIVE_HTML_SHUTDOWN_TIMEOUT') this.server.closeAllConnections?.();
        }
        try { await this.http.shutdown(); }
        catch (error) { errors.push(error); }
        if (errors.length) throw new AggregateError(errors, 'Live HTML shutdown failed.');
    }
}

module.exports = LiveHtmlServer;
