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

class PageManager {
    constructor({ pages, templateRoot = process.cwd(), paths = {}, sessionTtlMs = 30_000, maxSessions = 1000, logger = console }) {
        if (!Array.isArray(pages) || pages.length === 0) throw new TypeError('`pages` must be a non-empty array.');
        if (typeof templateRoot !== 'string' || !templateRoot) throw new TypeError('`templateRoot` must be a non-empty string.');
        if (!Number.isInteger(sessionTtlMs) || sessionTtlMs < 0) throw new TypeError('`sessionTtlMs` must be a non-negative integer.');
        if (!Number.isInteger(maxSessions) || maxSessions < 1) throw new TypeError('`maxSessions` must be a positive integer.');
        if (!paths || typeof paths !== 'object' || Array.isArray(paths)) throw new TypeError('`paths` must be an object.');
        this.paths = { ...DEFAULT_PATHS, ...paths };
        Object.entries(this.paths).forEach(([name, value]) => {
            if (typeof value !== 'string' || !value.startsWith('/')) throw new TypeError(`${name} path must begin with "/".`);
        });
        if (new Set(Object.values(this.paths)).size !== Object.values(this.paths).length) {
            throw new Error('Live HTML internal paths must be unique.');
        }
        this.templateRoot = path.resolve(templateRoot);
        this.sessionTtlMs = sessionTtlMs;
        this.maxSessions = maxSessions;
        this.logger = logger || { log() {}, warn() {}, error() {} };
        this.pending = new Map();
        this.active = new Map();
        this.records = new Map();
        this.sharedPages = new Set();
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
        if (this.pending.size + this.active.size >= this.maxSessions) {
            const error = new Error('Live HTML session capacity reached.');
            error.status = 503;
            throw error;
        }
        const ownsPage = record.metadata.scope === 'connection';
        const page = ownsPage ? this.instantiate(record) : record.shared;
        try {
            const context = Object.freeze({ request, params: request.params, query: request.query, body: request.body });
            await page.loading?.(context);
            const source = record.template ?? await page.render?.(context);
            if (source === undefined) throw new Error(`${record.PageClass.name} must provide a template or render().`);
            const markup = HtmxRenderer.render(source.toString(), page);
            const session = this.createSession(page, ownsPage);
            return HtmxRenderer.document(markup, {
                pageId: session.id,
                socketPath: this.paths.socket,
                runtimePath: this.paths.runtime,
                version: PROTOCOL_VERSION,
            });
        } catch (error) {
            if (ownsPage) page.dispose();
            throw error;
        }
    }

    createSession(page, ownsPage) {
        const id = randomUUID();
        const session = { id, page, ownsPage, socket: null, timer: null };
        this.pending.set(id, session);
        this.expire(session);
        return session;
    }

    expire(session) {
        clearTimeout(session.timer);
        session.timer = setTimeout(() => this.release(session), this.sessionTtlMs);
        session.timer.unref?.();
    }

    authenticate(request) {
        let id;
        try {
            id = new URL(request.url, `http://${request.headers.host || 'localhost'}`).searchParams.get('pageId');
        } catch {
            return false;
        }
        if (typeof id !== 'string' || id.length > 128) return false;
        const session = this.pending.get(id) || this.active.get(id);
        return session && !session.socket ? session : false;
    }

    acceptsOrigin(origin, request) {
        if (typeof origin !== 'string') return false;
        try {
            const parsed = new URL(origin);
            return ['http:', 'https:'].includes(parsed.protocol) && parsed.host === request.headers.host;
        } catch {
            return false;
        }
    }

    connect(session, socket) {
        if (!session || session.socket) throw new Error('Page session is unavailable.');
        clearTimeout(session.timer);
        this.pending.delete(session.id);
        this.active.set(session.id, session);
        session.socket = socket;
        socket.__redwebPageSession = session;
        return session.page._attach(socket, Object.freeze({ socket, signal: socket.context?.signal }));
    }

    disconnect(socket) {
        const session = socket.__redwebPageSession;
        if (!session || session.socket !== socket) return false;
        try {
            session.page._detach(socket, Object.freeze({ socket }));
        } finally {
            session.socket = null;
            this.expire(session);
        }
        return true;
    }

    release(session) {
        clearTimeout(session.timer);
        this.pending.delete(session.id);
        this.active.delete(session.id);
        if (session.ownsPage) session.page.dispose();
        return true;
    }

    async receive(socket, message) {
        const session = socket.__redwebPageSession;
        if (!session) throw new Error('Page session is not connected.');
        const payload = message.payload;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('Live HTML payload must be an object.');
        const name = boundedName(payload.name, 'Live HTML member name');
        if (payload.kind === 'action') {
            const result = await session.page._invoke(name, payload.args, Object.freeze({ socket, signal: socket.context?.signal }));
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
            connectionCloseCallback(socket) { manager.disconnect(socket); }
        };
    }

    shutdown() {
        [...this.pending.values(), ...this.active.values()].forEach(session => this.release(session));
        this.sharedPages.forEach(page => page.dispose());
        this.sharedPages.clear();
    }
}

module.exports = { DEFAULT_PATHS, PROTOCOL_VERSION, PageManager };
