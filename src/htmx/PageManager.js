const { createHash, randomUUID } = require('crypto');
const path = require('path');
const { setMaxListeners } = require('events');
const { BaseHandler } = require('../ws/BaseHandler');
const { SocketRoute } = require('../ws');
const HtmlRenderer = require('./HtmlRenderer');
const PageAssetLoader = require('./PageAssetLoader');
const LivePage = require('./LivePage');
const ReactiveRenderer = require('./ReactiveRenderer');
const browserRuntime = require('./browserRuntime');
const { isHtml, renderValue, trustedHtml } = require('./Html');
const { getPageMetadata, getPageStylesheetRoots, getPageTemplateRoot } = require('./metadata');
const synchronous = require('./synchronous');
const { ActionInputError } = require('./ActionDefinition');
const { AccessDenied } = require('./AccessPolicy');
const { PageIdentity, AuthenticationFailure, isPrincipal } = require('./PageIdentity');
const PageLifetime = require('./PageLifetime');
const requestSnapshot = require('./RequestSnapshot');

const PROTOCOL_VERSION = '1';
const DEFAULT_HEARTBEAT = Object.freeze({ intervalMs: 15_000, timeoutMs: 10_000 });
const DEFAULT_PATHS = Object.freeze({
    socket: '/__redweb/live',
    client: '/__redweb/client.js',
    runtime: '/__redweb/runtime.js',
    css: '/__redweb/css',
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

function withinDeadline(promise, deadline) {
    const remaining = Math.max(0, deadline - Date.now());
    if (remaining === 0) return Promise.resolve({ completed: false });
    return new Promise(resolve => {
        const timer = setTimeout(() => resolve({ completed: false }), remaining);
        promise.then(value => {
            clearTimeout(timer);
            resolve({ completed: true, value });
        });
    });
}

function cacheControl(cache = {}) {
    const directives = ['public', `max-age=${cache.maxAge ?? 0}`];
    if ((cache.staleWhileRevalidate ?? 0) > 0) directives.push(`stale-while-revalidate=${cache.staleWhileRevalidate}`);
    if (cache.immutable) directives.push('immutable');
    else if ((cache.maxAge ?? 0) === 0) directives.push('must-revalidate');
    return directives.join(', ');
}

function matchesIfNoneMatch(header, etag) {
    if (typeof header !== 'string') return false;
    return header.split(',').some(value => {
        const candidate = value.trim();
        return candidate === '*' || candidate.replace(/^W\//i, '') === etag;
    });
}

class PageManager {
    constructor({ pages, templateRoot, paths = {}, sessionTtlMs = 30_000, maxSessions = 1000, maxConcurrentRenders = maxSessions, shutdownTimeoutMs = 1000, heartbeat = DEFAULT_HEARTBEAT, authenticate, authenticationTimeoutMs, origins, logger = console }) {
        if (!Array.isArray(pages) || pages.length === 0) throw new TypeError('`pages` must be a non-empty array.');
        if (templateRoot !== undefined && (typeof templateRoot !== 'string' || !templateRoot)) throw new TypeError('`templateRoot` must be a non-empty string.');
        if (!Number.isInteger(sessionTtlMs) || sessionTtlMs < 0) throw new TypeError('`sessionTtlMs` must be a non-negative integer.');
        if (!Number.isInteger(maxSessions) || maxSessions < 1) throw new TypeError('`maxSessions` must be a positive integer.');
        if (!Number.isInteger(maxConcurrentRenders) || maxConcurrentRenders < 1) {
            throw new TypeError('`maxConcurrentRenders` must be a positive integer.');
        }
        if (!Number.isInteger(shutdownTimeoutMs) || shutdownTimeoutMs < 0) throw new TypeError('`shutdownTimeoutMs` must be a non-negative integer.');
        if (!paths || typeof paths !== 'object' || Array.isArray(paths)) throw new TypeError('`paths` must be an object.');
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
        if (this.paths.css.endsWith('/')) {
            throw new TypeError('Live HTML css path must be a URL prefix without a trailing slash.');
        }
        if (Object.entries(this.paths).some(([name, value]) => name !== 'css' && value.startsWith(`${this.paths.css}/`))) {
            throw new Error('Live HTML css path must not contain another internal path.');
        }
        this.templateRoot = path.resolve(templateRoot || process.cwd());
        this.hasExplicitTemplateRoot = templateRoot !== undefined;
        this.sessionTtlMs = sessionTtlMs;
        this.maxSessions = maxSessions;
        this.maxConcurrentRenders = maxConcurrentRenders;
        this.shutdownTimeoutMs = shutdownTimeoutMs;
        this.heartbeat = heartbeat;
        this.logger = logger || { log() {}, warn() {}, error() {} };
        this.authenticateRequest = authenticate;
        this.identity = new PageIdentity(authenticate, authenticationTimeoutMs);
        this.lifetimes = new Set();
        this.origins = origins;
        this.pending = new Map();
        this.active = new Map();
        this.records = new Map();
        this.stylesheets = new Map();
        this.stylesheetUrls = new Map();
        this.assets = new PageAssetLoader();
        this.sharedPages = new Set();
        this.rendering = 0;
        this.liveRendering = 0;
        this.renderWaiters = [];
        this.renderPages = new Set();
        this.renderAbortController = new AbortController();
        setMaxListeners(maxSessions + maxConcurrentRenders + 1, this.renderAbortController.signal);
        this.closing = false;
        pages.forEach(PageClass => this.register(PageClass));
        this.hasLivePages = [...this.records.values()].some(record => record.metadata.live !== false);
    }

    register(PageClass) {
        if (typeof PageClass !== 'function') throw new TypeError('Every page must be a class.');
        const metadata = getPageMetadata(PageClass);
        if (!metadata) throw new TypeError(`${PageClass.name || 'Page'} is missing @page metadata.`);
        if (this.records.has(metadata.path) || Object.values(this.paths).includes(metadata.path) || metadata.path.startsWith(`${this.paths.css}/`)) {
            throw new Error(`Duplicate or reserved Live HTML path: ${metadata.path}`);
        }
        const root = this.hasExplicitTemplateRoot ? this.templateRoot : getPageTemplateRoot(PageClass);
        const record = {
            PageClass,
            metadata,
            template: metadata.template ? this.assets.load(metadata.template, root, 'template').content : null,
            stylesheets: [...new Set((metadata.css || []).map((file, index) => this.registerStylesheet(
                file,
                (this.hasExplicitTemplateRoot ? undefined : getPageStylesheetRoots(PageClass)?.[index]) || root,
            )))],
            shared: null,
        };
        if (metadata.scope === 'shared') {
            record.shared = this.instantiate(record);
            this.sharedPages.add(record.shared);
        }
        this.records.set(metadata.path, record);
    }

    registerStylesheet(file, root) {
        const asset = this.assets.load(file, root, 'stylesheet');
        const existing = this.stylesheetUrls.get(asset.path);
        if (existing) return existing;
        const digest = createHash('sha256').update(asset.content).digest('hex');
        const url = `${this.paths.css}/${digest}.css`;
        this.stylesheets.set(url, asset.content);
        this.stylesheetUrls.set(asset.path, url);
        return url;
    }

    instantiate(record) {
        const instance = new record.PageClass();
        if (!(instance instanceof record.PageClass)) throw new TypeError('Page construction returned an incompatible object.');
        const page = LivePage.adopt(instance);
        page._activateState();
        return page;
    }

    mount(app) {
        if (this.hasLivePages) {
            const clientFile = path.join(path.dirname(require.resolve('redweb-client')), 'index.js');
            app.get(this.paths.client, (_request, response) => response.sendFile(clientFile));
            app.get(this.paths.runtime, (_request, response) => response.type('text/javascript').send(browserRuntime(this.paths.client)));
        }
        this.stylesheets.forEach((content, url) => app.get(url, (_request, response) => {
            response.set('Cache-Control', 'public, max-age=31536000, immutable').type('text/css').send(content);
        }));
        this.records.forEach(record => app.get(record.metadata.path, (request, response, next) => {
            const controller = new AbortController();
            const closed = () => controller.abort();
            const finished = () => { response.off('close', closed); response.off('finish', finished); };
            response.once('close', closed);
            response.once('finish', finished);
            this.render(record, request, controller.signal, markup => {
                if (record.metadata.live !== false || this.authenticateRequest || record.metadata.policy) {
                    // end() deliberately bypasses Express's automatic conditional-GET/ETag handling.
                    response.set('Cache-Control', 'private, no-store').type('html').end(markup);
                    return;
                }
                const etag = `"${createHash('sha256').update(markup).digest('base64url')}"`;
                response.set('Cache-Control', cacheControl(record.metadata.cache)).set('ETag', etag);
                if (matchesIfNoneMatch(request.headers['if-none-match'], etag)) {
                    response.status(304).end();
                    return;
                }
                response.type('html').send(markup);
            }).catch(error => {
                if (this.closing) response.set('Connection', 'close');
                const known = error instanceof AccessDenied || error instanceof AuthenticationFailure;
                if (known || record.metadata.policy) {
                    response.set('Cache-Control', 'private, no-store').status(known ? error.status : 500).json({ error: {
                        code: known ? error.code : 'PAGE_FAILED', message: known ? error.message : 'Page request failed.',
                    } });
                } else next(error);
            }).finally(finished);
        }));
    }

    createLifetime(principal) {
        const lifetime = new PageLifetime(this.renderAbortController.signal);
        lifetime.principal = principal;
        this.lifetimes.add(lifetime);
        return lifetime;
    }

    async render(record, request, signal, onReady) {
        const live = record.metadata.live !== false;
        const sessionsFull = live && this.pending.size + this.active.size + this.liveRendering >= this.maxSessions;
        if (this.closing || this.rendering >= this.maxConcurrentRenders || sessionsFull) {
            const error = new Error('Live HTML session capacity reached.');
            error.status = 503;
            throw error;
        }
        this.rendering += 1;
        if (live) this.liveRendering += 1;
        const ownsPage = record.metadata.scope === 'connection';
        let page;
        let renderer;
        let session;
        const lifetime = this.createLifetime();
        const deliver = markup => { lifetime.check(); onReady?.(markup); return markup; };
        signal?.addEventListener('abort', lifetime.abort, { once: true });
        if (signal?.aborted) lifetime.abort();
        try {
            const snapshot = requestSnapshot(request);
            const principal = await this.identity.resolve(request, lifetime.signal);
            lifetime.principal = principal;
            lifetime.check();
            const context = Object.freeze({ request: snapshot, params: snapshot.params, query: snapshot.query, body: snapshot.body, principal, signal: lifetime.signal });
            await record.metadata.policy?.check(context);
            lifetime.check();
            page = ownsPage ? this.instantiate(record) : record.shared;
            lifetime.page = ownsPage ? page : null;
            this.renderPages.add(page);
            if (live) renderer = new ReactiveRenderer(page, lifetime.signal);
            await lifetime.wait(() => page.loading?.(context));
            await lifetime.wait(() => page._loadComponents(context));
            const render = async () => {
                const source = record.template ?? await page.render?.(context);
                lifetime.check();
                if (source === undefined) throw new Error(`${record.PageClass.name} must provide a template or render().`);
                const content = isHtml(source) ? renderValue(source) : HtmlRenderer.render(source.toString(), page, { live });
                if (!record.metadata.layout) return content;
                const result = synchronous(record.metadata.layout(trustedHtml(content), context), 'Page layouts must render synchronously.');
                if (!isHtml(result)) throw new TypeError('Page layouts must return html.');
                return renderValue(result);
            };
            const withContext = callback => LivePage.withRenderContext(context, callback);
            const markup = await lifetime.wait(() => renderer ? renderer.initialize(render, withContext) : withContext(render));
            if (record.metadata.live === false) {
                const document = HtmlRenderer.document(markup, null, record.stylesheets, record.metadata.head);
                if (ownsPage) await lifetime.wait(() => page.dispose());
                return deliver(document);
            }
            session = this.createSession(page, ownsPage, principal, context, record, lifetime);
            session.renderLifetime = renderer;
            const config = {
                pageId: session.id,
                socketPath: this.paths.socket,
                runtimePath: this.paths.runtime,
                version: PROTOCOL_VERSION,
            };
            if (renderer.enabled) {
                session.renderer = renderer;
                renderer.document = value => HtmlRenderer.document(value, config, record.stylesheets, record.metadata.head);
                renderer.onError = error => this.logger.error?.('Live HTML reactive render failed.', error);
            } else renderer.nodes.clear();
            return deliver(HtmlRenderer.document(markup, config, record.stylesheets, record.metadata.head));
        } catch (error) {
            renderer?.dispose();
            if (ownsPage && page) {
                if (lifetime.signal.aborted) await withinDeadline(Promise.allSettled([page.dispose()]), Date.now() + this.shutdownTimeoutMs);
                else await page.dispose();
            }
            if (this.closing) throw new Error('Live HTML server is shutting down.');
            throw error;
        } finally {
            signal?.removeEventListener('abort', lifetime.abort);
            if (!session) { lifetime.abort(); this.lifetimes.delete(lifetime); }
            if (page) this.renderPages.delete(page);
            this.rendering -= 1;
            if (live) this.liveRendering -= 1;
            if (this.rendering === 0) this.renderWaiters.splice(0).forEach(resolve => resolve());
        }
    }

    createSession(page, ownsPage, principal, context = {}, record, lifetime = this.createLifetime(principal)) {
        const id = randomUUID();
        const session = { id, page, ownsPage, principal, context, record, lifetime, socket: null, timer: null, detaching: null };
        lifetime.session = session;
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
        if (!session || session.socket || session.detaching) return false;
        try {
            const principal = await this.identity.resolve(request, session.lifetime.signal);
            if (!Object.is(principal, session.principal)) return false;
            await session.record?.metadata.policy?.check(session.context);
            return this.available(session) && !session.socket && !session.detaching ? session : false;
        } catch { return false; }
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
        if (!session || !this.available(session) || session.socket || session.detaching) {
            throw new Error('Page session is unavailable.');
        }
        clearTimeout(session.timer);
        this.pending.delete(session.id);
        this.active.set(session.id, session);
        session.socket = socket;
        socket.__redwebPageSession = session;
        session.connection = new PageLifetime(session.lifetime.signal);
        socket.once?.('close', session.connection.abort);
        socket.context?.signal?.addEventListener('abort', session.connection.abort, { once: true });
        if (socket.context?.signal?.aborted || (socket.readyState !== undefined && socket.readyState !== 1)) session.connection.abort();
        if (socket.context?.signal) setMaxListeners(this.maxSessions + 1, socket.context.signal);
        return session.connection.wait(() => session.page._attach(socket, this.connectionContext(session, socket)))
            .then(result => {
                this.checkConnected(session, socket);
                return session.renderer ? session.renderer.attach(socket, LivePage.snapshots(session.page, true)) : result;
            });
    }

    available(session) {
        return !session.lifetime.revoked && !LivePage.isDisposed(session.page) && (this.pending.get(session.id) === session || this.active.get(session.id) === session);
    }

    connectionContext(session, socket) { return Object.freeze({ ...session.context, socket, signal: session.connection.signal, principal: session.principal }); }

    checkConnected(session, socket) {
        if (!this.available(session) || session.socket !== socket) throw new AccessDenied('ACCESS_CANCELLED');
        session.connection.check();
    }

    async authorize(session, socket) {
        this.checkConnected(session, socket);
        await session.record?.metadata.policy?.check(this.connectionContext(session, socket));
        this.checkConnected(session, socket);
    }

    async disconnect(socket) {
        const session = socket.__redwebPageSession;
        if (!session || session.socket !== socket) return false;
        session.connection.abort();
        socket.off?.('close', session.connection.abort);
        socket.context?.signal?.removeEventListener('abort', session.connection.abort);
        session.renderer?.detach();
        const detaching = Promise.resolve(session.page._detach(socket, this.connectionContext(session, socket)))
            .finally(() => { session.detaching = null; });
        session.detaching = detaching;
        session.socket = null;
        if (this.available(session)) this.expire(session);
        await detaching;
        return true;
    }

    async release(session) {
        session.lifetime.revoked = true;
        const cleanup = [];
        if (session.socket) {
            session.socket.terminate?.();
            cleanup.push(this.disconnect(session.socket));
        } else if (session.detaching) cleanup.push(session.detaching);
        session.lifetime.abort();
        this.lifetimes.delete(session.lifetime);
        session.renderLifetime?.dispose();
        clearTimeout(session.timer);
        this.pending.delete(session.id);
        this.active.delete(session.id);
        if (session.ownsPage) cleanup.push(session.page.dispose());
        LivePage._throwLifecycleFailures(await Promise.allSettled(cleanup), 'Page session cleanup failed.');
        return true;
    }

    async revoke(principal) {
        if (!isPrincipal(principal)) throw new TypeError('revoke() requires an authenticated primitive identity.');
        const affected = [...this.lifetimes].filter(lifetime => Object.is(lifetime.principal, principal) || (this.authenticateRequest && lifetime.principal === undefined));
        // Invalidate every publication target before dispatching any application abort listener.
        affected.forEach(lifetime => { lifetime.revoked = true; });
        affected.forEach(lifetime => lifetime.session?.socket?.terminate?.());
        const cleanup = [];
        for (const lifetime of affected) {
            const session = lifetime.session;
            if (session) {
                cleanup.push(this.release(session));
            } else {
                lifetime.abort();
                this.lifetimes.delete(lifetime);
                if (lifetime.page) cleanup.push(lifetime.page.dispose());
            }
        }
        if (!cleanup.length) return affected.length;
        const result = await withinDeadline(Promise.allSettled(cleanup), Date.now() + this.shutdownTimeoutMs);
        if (!result.completed || result.value.some(entry => entry.status === 'rejected')) {
            const error = new Error('Page access revoked; application cleanup did not complete successfully.');
            error.code = 'REVOCATION_CLEANUP_FAILED';
            throw error;
        }
        return affected.length;
    }

    async receive(socket, message) {
        const session = socket.__redwebPageSession;
        if (!session) throw new Error('Page session is not connected.');
        this.checkConnected(session, socket);
        const payload = message.payload;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('Live HTML payload must be an object.');
        const name = boundedName(payload.name, 'Live HTML member name');
        const target = payload.component === undefined || payload.component === null
            ? session.page
            : session.page._component(boundedName(payload.component, 'Live HTML component name'));
        if (!target) throw new Error('Unknown Live HTML component.');
        if (payload.kind === 'action') {
            const result = await LivePage.invoke(target, name, payload.args, this.connectionContext(session, socket), () => this.authorize(session, socket));
            this.checkConnected(session, socket);
            if (message.requestId !== undefined) {
                socket.sendEvent('redweb:result', result ?? null, { requestId: message.requestId });
            }
            return;
        }
        if (payload.kind === 'state') {
            await this.authorize(session, socket);
            this.checkConnected(session, socket);
            LivePage.setFromClient(target, name, payload.value);
            return;
        }
        throw new TypeError('Live HTML message kind must be "action" or "state".');
    }

    route() {
        const manager = this;
        class LiveHtmlHandler extends BaseHandler {
            constructor() { super('redweb:html'); }
            onInitialContact(socket) { return manager.connect(socket.context.principal, socket); }
            async onMessage(socket, message) {
                try { return await manager.receive(socket, message); }
                catch (error) {
                    if (!(error instanceof ActionInputError) && !(error instanceof AccessDenied)) throw error;
                    socket.sendProtocolError(error.code, error.message, { requestId: message.requestId });
                }
            }
        }
        return class LiveHtmlRoute extends SocketRoute {
            constructor() {
                super({
                    path: manager.paths.socket,
                    handlers: [LiveHtmlHandler],
                    allowDuplicateConnections: true,
                    orderedMessages: true,
                    drainHandlers: true,
                    heartbeat: manager.heartbeat,
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
        const deadline = Date.now() + this.shutdownTimeoutMs;
        if (this.rendering > 0) {
            const drained = new Promise(resolve => this.renderWaiters.push(resolve));
            const drain = await withinDeadline(drained, deadline);
            if (!drain.completed) {
                const timeout = new Error('Live HTML render cleanup exceeded shutdownTimeoutMs.');
                timeout.code = 'LIVE_HTML_SHUTDOWN_TIMEOUT';
                errors.push(timeout);
            }
        }
        const cleanup = Promise.allSettled([
            ...[...this.pending.values(), ...this.active.values()].map(session => this.release(session)),
            ...[...this.sharedPages].map(page => page.dispose()),
            ...[...this.renderPages].map(page => page.dispose()),
        ]);
        this.sharedPages.clear();
        this.renderPages.clear();
        const cleanupResult = await withinDeadline(cleanup, deadline);
        if (cleanupResult.completed) {
            errors.push(...cleanupResult.value.filter(result => result.status === 'rejected').map(result => result.reason));
        } else {
            const timeout = new Error('Live HTML page disposal exceeded shutdownTimeoutMs.');
            timeout.code = 'LIVE_HTML_SHUTDOWN_TIMEOUT';
            errors.push(timeout);
        }
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
