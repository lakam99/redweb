const express = require('express');
const HttpServer = require('../http/HttpServer');
const HttpsServer = require('../http/HttpsServer');
const SocketServer = require('../ws/SocketServer');
const { PageManager } = require('./PageManager');
const { createInspection } = require('../development/Inspection');
const developmentSettings = require('../development/settings');
const OwnedServerLifecycle = require('../OwnedServerLifecycle');
const { listenServer, validateListenerOptions } = require('../serverLifecycle');
const { scheduleStartupCleanup } = require('../StartupCleanup');

class LiveHtmlServer {
    constructor(options = {}) {
        try { this.initialize(options); }
        catch (error) { throw scheduleStartupCleanup(error, () => this.shutdown()); }
    }

    initialize(options) {
        if (!options || typeof options !== 'object' || Array.isArray(options)) {
            throw new TypeError('Live HTML server options must be an object.');
        }
        const {
            pages,
            socketRoutes = [],
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
            development,
            server: suppliedApp,
            ...httpOptions
        } = options;
        if (!Array.isArray(socketRoutes) || socketRoutes.some(Route => typeof Route !== 'function')) {
            throw new TypeError('`socketRoutes` must be an array of route classes.');
        }
        const settings = developmentSettings(development, ['inspect', 'refresh'], { refresh: process.env.REDWEB_DEV_REFRESH === '1' });
        this._inspection = createInspection({ inspect: settings.inspect });
        const app = suppliedApp === undefined ? express() : suppliedApp;
        if (!app || typeof app.get !== 'function' || typeof app.use !== 'function') {
            throw new TypeError('`server` must be an Express-compatible application.');
        }
        const Manager = settings.refresh ? require('../development/DevelopmentPageManager') : PageManager;
        this.manager = new Manager({
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
        if (this._inspection) this.manager.Renderer = this._inspection.Renderer;
        this.manager.mount(app);
        const listen = httpOptions.listen ?? true;
        const ServerClass = httpOptions.ssl ? HttpsServer : HttpServer;
        this.http = new ServerClass({ ...httpOptions, server: app, listen: false });
        validateListenerOptions({ ...this.http, listen });
        this._ownedServer = new OwnedServerLifecycle(this.http.server);
        try {
            if (this.manager.hasLivePages || socketRoutes.length) {
                this.sockets = new SocketServer({
                    server: this.http.server,
                    routes: [...(this.manager.hasLivePages ? [this.manager.route()] : []), ...socketRoutes],
                    listen,
                    port: this.http.port,
                    bind: this.http.bind,
                    listenCallback: this.http.listenCallback,
                    logger: this.http.logger,
                    closeServerOnShutdown: false,
                });
            } else {
                this.sockets = null;
                if (listen) listenServer(this.http.server, {
                    port: this.http.port, bind: this.http.bind, callback: this.http.listenCallback,
                    logger: this.http.logger, name: httpOptions.ssl ? 'HttpsServer' : 'HttpServer',
                });
            }
        } catch (error) { this._ownedServer.dispose(); throw error; }
        this.app = this.http.app;
        this.server = this.http.server;
        this._shutdownPromise = null;
    }

    revoke(principal) { return this.manager.revoke(principal); }

    inspect() { return this._inspection ? this._inspection.snapshot(this) : null; }

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
        try { await this.manager?.shutdown(); }
        catch (error) {
            errors.push(error);
        }
        try { await this._ownedServer?.close(this.manager.shutdownTimeoutMs, () => this.http.shutdown()); }
        catch (error) { errors.push(error); }
        if (errors.length) throw new AggregateError(errors, 'Live HTML shutdown failed.');
    }
}

module.exports = LiveHtmlServer;
