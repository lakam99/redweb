const express = require('express');
const HttpServer = require('../http/HttpServer');
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
            logger: httpOptions.logger,
        });
        this.manager.mount(app);
        const listen = httpOptions.listen ?? true;
        this.http = new HttpServer({ ...httpOptions, server: app, listen: false });
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
        this.app = this.http.app;
        this.server = this.http.server;
        this._shutdownPromise = null;
    }

    shutdown() {
        if (!this._shutdownPromise) {
            this._shutdownPromise = this.sockets.shutdown()
                .then(() => this.manager.shutdown())
                .then(() => this.http.shutdown());
        }
        return this._shutdownPromise;
    }
}

module.exports = LiveHtmlServer;
