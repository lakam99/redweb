const { randomUUID } = require('crypto');
const path = require('path');
const { BaseHandler } = require('../ws/BaseHandler');
const { SocketRoute } = require('../ws');
const HtmxRenderer = require('./HtmxRenderer');
const LivePage = require('./LivePage');
const browserRuntime = require('./browserRuntime');
const { getPageMetadata } = require('./metadata');

const PROTOCOL_VERSION = '1';
const DEFAULT_PATHS = Object.freeze({
    socket: '/__redweb/live',
    client: '/__redweb/client.js',
    runtime: '/__redweb/runtime.js',
});

function boundedName(value, label) {
    if (typeof value !== 'string' || !value || value.length > 128 || ['__proto__', 'prototype', 'constructor'].includes(value)) {
        throw new TypeError(`${label} must be a safe non-empty string of at most 128 characters.`);
    }
    return value;
}

function internalPath(value, label) {
    if (typeof value !== 'string' || !/^\/(?!\/)(?!.*\/\/)(?:[A-Za-z0-9._~-]|%[0-9A-Fa-f]{2}|\/)+$/.test(value)) {
        throw new TypeError(`${label} path must be an absolute URL pathname using safe characters.`);
    }
    return value;
}

class PageManager {
    constructor({ pages, templateRoot = process.cwd(), paths = {}, sessionTtlMs = 30_000, maxSessions = 1000, shutdownTimeoutMs = 1000, authenticate, origins, logger = console }) {
        if (!Array.isArray(pages) || pages.length === 0) throw new TypeError('`pages` must be a non-empty array.');
        if (typeof templateRoot !== 'string' || !templateRoot) throw new TypeError('`templateRoot` must be a non-empty string.');
        if (!Number.isInteger(sessionTtlMs) || sessionTtlMs < 0) throw new TypeError('`sessionTtlMs` must be a non-negative integer.');
        if (!Number.isInteger(maxSessions) || maxSessions < 1) throw new TypeError('`maxSessions` must be a positive integer.');
        if (!Number.isInteger(shutdownTimeoutMs) || shutdownTimeoutMs < 0) throw new TypeError('`shutdownTimeoutMs` must be a non-negative integer.');
        if (!paths || typeof paths !== 'object' || Array.isArray(paths)) throw new TypeError('`paths` must be an object.');
        if (authenticate !== undefined && typeof authenticate !== 'function') throw new TypeError('`authenticate` must be a function.');
        if (origins !== undefined && typeof origins !== 'function' &&
            (!Array.isArray(origins) || origins.some(origin => typeof origin !== 'string' || !origin))) {
            throw new TypeError('`origins` must be a function or an array of non-empty origins.');
        }
        this.paths = { ...DEFAULT_PATHS, ...paths };
        Object.entries(this.paths).forEach(([name, value]) => {
            internalPath(value, name);
        });
        if (new Set(Object.values(this.paths)).size !== Object.values(this.paths).length) {
            throw new Error('Live HTML internal paths must be unique.');
        }
        this.templateRoot = path.resolve(templateRoot);
        this.sessionTtlMs = sessionTtlMs;
        this.maxSessions = maxSessions;
        this.shutdownTimeoutMs = shutdownTimeoutMs;
        this.logger = logger || { log() {}, warn() {}, error() {} };
        this.authenticateRequest = authenticate;
        this.origins = origins;
        this.pending = new Map();
        this.active = new Map();
        this.records = new Map();
        this.sharedPages = new Set();
        this.rendering = 0;
        this.renderWaiters = [];
        this.renderPages = new Set();
        this.renderAbortController = new AbortController();
        this.closing = false;
        pages.forEach(PageClass => this.register(PageClass));
    }

    register(PageClass) {
        if (typeof PageClass !== 'function' || !(PageClass.prototype instanceof LivePage)) {
            throw new TypeError('Every page must extend LivePage.');
        }
        const metadata = getPageMetadata(PageClass);
        if (!metadata) throw new TypeError(`${PageClass.name || 'Page'} is missing @page metadata.`);
        if (this.records.has(metadata.path) || Object.values(this.paths).includes(metadata.path)) {
            throw new Error(`Duplicate or reserved Live HTML path: ${metadata.path}`);
        }
        const record = {
            PageClass,
            metadata,
            template: metadata.template ? HtmxRenderer.template(metadata.template, this.templateRoot) : null,
            shared: null,
        };
        if (metadata.scope === 'shared') {
            record.shared = this.instantiate(record);
            this.sharedPages.add(record.shared);
        }
        this.records.set(metadata.path, record);
    }

    instantiate(record) {
        const instance = new record.PageClass();
        if (!(instance instanceof LivePage)) throw new TypeError('Page construction must return a LivePage.');
        instance._activateState();
        return instance;
    }

    mount(app) {
        const clientFile = path.join(path.dirname(require.resolve('redweb-client')), 'index.js');
        app.get(this.paths.client, (_request, response) => response.sendFile(clientFile));
        app.get(this.paths.runtime, (_request, response) => response.type('text/javascript').send(browserRuntime(this.paths.client)));
        this.records.forEach(record => app.get(record.metadata.path, (request, response, next) => {
            Promise.resolve(this.render(record, request)).then(markup => response.type('html').send(markup), next);
        }));
    }

    async render(record, request) {
        if (this.closing || this.pending.size + this.active.size + this.rendering >= this.maxSessions) {
            const error = new Error('Live HTML session capacity reached.');
            error.status = 503;
            throw error;
        }
        this.rendering += 1;
        const ownsPage = record.metadata.scope === 'connection';
        let page;
        try {
            page = ownsPage ? this.instantiate(record) : record.shared;
            this.renderPages.add(page);
            const principal = this.authenticateRequest ? await this.authenticateRequest(request) : undefined;
            if (this.authenticateRequest && (principal === false || principal === null || principal === undefined || typeof principal === 'object')) {
                const error = new Error('Live HTML authentication failed.');
                error.status = 401;
                throw error;
            }
            const context = Object.freeze({
                request,
                params: request.params,
                query: request.query,
                body: request.body,
                principal,
                signal: this.renderAbortController.signal,
            });
            await page.loading?.(context);
            if (this.closing) throw new Error('Live HTML server is shutting down.');
            const source = record.template ?? await page.render?.(context);
            if (this.closing) throw new Error('Live HTML server is shutting down.');
            if (source === undefined) throw new Error(`${record.PageClass.name} must provide a template or render().`);
            const markup = HtmxRenderer.render(source.toString(), page);
            const session = this.createSession(page, ownsPage, principal);
            return HtmxRenderer.document(markup, {
                pageId: session.id,
                socketPath: this.paths.socket,
                runtimePath: this.paths.runtime,
                version: PROTOCOL_VERSION,
            });
        } catch (error) {
            if (ownsPage && page) await page.dispose();
            throw error;
        } finally {
            if (page) this.renderPages.delete(page);
            this.rendering -= 1;
            if (this.rendering === 0) this.renderWaiters.splice(0).forEach(resolve => resolve());
        }
    }

    createSession(page, ownsPage, principal) {
        const id = randomUUID();
        const session = { id, page, ownsPage, principal, socket: null, timer: null };
        this.pending.set(id, session);
        this.expire(session);
        return session;
    }

    expire(session) {
        clearTimeout(session.timer);
        session.timer = setTimeout(() => {
            this.release(session).catch(error => this.logger.error?.('Live HTML session cleanup failed.', error));
        }, this.sessionTtlMs);
        session.timer.unref?.();
    }

    async authenticate(request) {
        let id;
        try {
            id = new URL(request.url, `http://${request.headers.host || 'localhost'}`).searchParams.get('pageId');
        } catch {
            return false;
        }
        if (typeof id !== 'string' || id.length > 128) return false;
        const session = this.pending.get(id) || this.active.get(id);
        if (!session || session.socket) return false;
        if (this.authenticateRequest) {
            const principal = await this.authenticateRequest(request);
            if (!Object.is(principal, session.principal)) return false;
        }
        return !session.socket && !session.page._disposed ? session : false;
    }

    acceptsOrigin(origin, request) {
        if (typeof origin !== 'string') return false;
        try {
            const parsed = new URL(origin);
            if (typeof this.origins === 'function') return this.origins(origin, request);
            if (this.origins) return this.origins.includes(parsed.origin);
            const protocol = request.socket?.encrypted ? 'https:' : 'http:';
            return parsed.protocol === protocol && parsed.host === request.headers.host;
        } catch {
            return false;
        }
    }

    connect(session, socket) {
        if (!session || session.socket || session.page._disposed) throw new Error('Page session is unavailable.');
        clearTimeout(session.timer);
        this.pending.delete(session.id);
        this.active.set(session.id, session);
        session.socket = socket;
        socket.__redwebPageSession = session;
        return session.page._attach(socket, Object.freeze({ socket, signal: socket.context?.signal, principal: session.principal }));
    }

    async disconnect(socket) {
        const session = socket.__redwebPageSession;
        if (!session || session.socket !== socket) return false;
        try {
            await session.page._detach(socket, Object.freeze({ socket }));
        } finally {
            session.socket = null;
            this.expire(session);
        }
        return true;
    }

    async release(session) {
        clearTimeout(session.timer);
        this.pending.delete(session.id);
        this.active.delete(session.id);
        if (session.ownsPage) await session.page.dispose();
        return true;
    }

    async receive(socket, message) {
        const session = socket.__redwebPageSession;
        if (!session) throw new Error('Page session is not connected.');
        const payload = message.payload;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('Live HTML payload must be an object.');
        const name = boundedName(payload.name, 'Live HTML member name');
        if (payload.kind === 'action') {
            const result = await session.page._invoke(name, payload.args, Object.freeze({
                socket,
                signal: socket.context?.signal,
                principal: session.principal,
            }));
            if (message.requestId !== undefined) {
                socket.sendEvent('redweb:result', result ?? null, { requestId: message.requestId });
            }
            return;
        }
        if (payload.kind === 'state') {
            session.page._setFromClient(name, payload.value);
            return;
        }
        throw new TypeError('Live HTML message kind must be "action" or "state".');
    }

    route() {
        const manager = this;
        class LiveHtmlHandler extends BaseHandler {
            constructor() { super('redweb:html'); }
            onInitialContact(socket) { return manager.connect(socket.context.principal, socket); }
            onMessage(socket, message) { return manager.receive(socket, message); }
        }
        return class LiveHtmlRoute extends SocketRoute {
            constructor() {
                super({
                    path: manager.paths.socket,
                    handlers: [LiveHtmlHandler],
                    allowDuplicateConnections: true,
                    orderedMessages: true,
                    drainHandlers: true,
                    shutdownTimeoutMs: manager.shutdownTimeoutMs,
                    limits: { maxPendingMessages: 64, maxBufferedBytes: 256 * 1024 },
                    websocketOptions: { maxPayload: 64 * 1024 },
                    protocol: { versions: [PROTOCOL_VERSION] },
                    admission: {
                        origins: (origin, request) => manager.acceptsOrigin(origin, request),
                        authenticate: request => manager.authenticate(request),
                    },
                    logger: manager.logger,
                });
            }
            connectionCloseCallback(socket) { return manager.disconnect(socket); }
        };
    }

    async shutdown() {
        this.closing = true;
        this.renderAbortController.abort();
        const errors = [];
        if (this.rendering > 0) {
            let timer;
            const drained = new Promise(resolve => this.renderWaiters.push(resolve));
            const deadline = new Promise(resolve => {
                timer = setTimeout(() => resolve(false), this.shutdownTimeoutMs);
                timer.unref?.();
            });
            const completed = await Promise.race([drained.then(() => true), deadline]);
            clearTimeout(timer);
            if (!completed) {
                const timeout = new Error('Live HTML render cleanup exceeded shutdownTimeoutMs.');
                timeout.code = 'LIVE_HTML_SHUTDOWN_TIMEOUT';
                errors.push(timeout);
            }
        }
        const results = await Promise.allSettled([
            ...[...this.pending.values(), ...this.active.values()].map(session => this.release(session)),
            ...[...this.sharedPages].map(page => page.dispose()),
            ...[...this.renderPages].map(page => page.dispose()),
        ]);
        this.sharedPages.clear();
        this.renderPages.clear();
        errors.push(...results.filter(result => result.status === 'rejected').map(result => result.reason));
        if (errors.length) {
            const aggregate = new AggregateError(errors, 'Live HTML page cleanup failed.');
            if (errors.some(error => error?.code === 'LIVE_HTML_SHUTDOWN_TIMEOUT')) {
                aggregate.code = 'LIVE_HTML_SHUTDOWN_TIMEOUT';
            }
            throw aggregate;
        }
    }
}

module.exports = { DEFAULT_PATHS, PROTOCOL_VERSION, PageManager };
