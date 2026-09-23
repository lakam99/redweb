'use strict';

const { AdmissionPolicy, ADMISSION_CONTEXT } = require('../ws/AdmissionPolicy');
const { AccessDenied } = require('../access/AccessPolicy');
const TransportPolicy = require('../ws/TransportPolicy');
const { guards } = require('../ws/HandlerGuard');
const { scheduleStartupCleanup } = require('../StartupCleanup');

function requirePageSession(session) {
    if (!session) throw new AccessDenied();
    return session;
}

function requireRawClient(socket) {
    if (!socket.__redwebRawClient) throw new AccessDenied();
}

function attachRawClient(socket, request, authorizedRequests) {
    if (!authorizedRequests.has(request)) throw new AccessDenied();
    socket.__redwebRawClient = true;
}

/** Adds page ownership to a route without replacing its admission, handlers or transport. */
function bindRoute(manager, RouteClass, records) {
    const sessions = new WeakMap();
    const rawRequests = new WeakSet();
    const ready = new WeakMap();
    return class PageSocketRoute extends RouteClass {
        constructor() {
            super();
            try {
                if (!this.protocolPolicy?.versions.includes('1') || this.protocolPolicy.queryParameter !== 'redwebVersion') {
                    throw new TypeError('Page socket routes must support protocol version 1 and the default version query parameter.');
                }
                if (this.handlers.some(handler => handler.name.startsWith('redweb:'))) throw new TypeError('Page socket routes reserve redweb:* message types.');
                if (!this.allowDuplicateConnections) throw new TypeError('Page socket routes require allowDuplicateConnections: true for independent browser tabs.');
                this.transportPolicy = new TransportPolicy(this.transportPolicy || {}, true);
                this.runtime.inFlight ||= new Set();
                this.inFlight = this.runtime.inFlight;
                for (const handler of this.handlers) {
                    const initial = handler.onInitialContact;
                    handler.onInitialContact = async (socket, request) => {
                        await ready.get(socket).promise;
                        if (socket.context.signal.aborted) throw new AccessDenied('ACCESS_CANCELLED');
                        return initial?.call(handler, socket, request);
                    };
                }
                this.pageAdmission = new AdmissionPolicy({
                    origins: (origin, request) => manager.acceptsOrigin(origin, request),
                    authenticate: async request => {
                        const session = await manager.authenticate(request, RouteClass);
                        if (!session) return false;
                        sessions.set(request, session);
                        return request[ADMISSION_CONTEXT]?.principal ?? true;
                    },
                });
                this.rawClientsAllowed = Boolean(this.admissionPolicy?.authenticate) && records.every(record => !record.metadata.policy);
                for (const record of records) {
                    record.socketPath = this.path;
                    record.socketHandlers = new Set(this.handlers.map(handler => handler.constructor));
                }
            } catch (error) {
                throw scheduleStartupCleanup(error, () => this.shutdown());
            }
        }

        handleConnection(socket, request) {
            let resolve, reject;
            const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
            promise.catch(() => {});
            ready.set(socket, { promise, resolve, reject });
            return super.handleConnection(socket, request);
        }

        async authorizeUpgrade(request, rawSocket, signal) {
            if (!await super.authorizeUpgrade(request, rawSocket, signal)) return false;
            if (!new URL(request.url, 'http://localhost').searchParams.has('pageId')) {
                if (!this.rawClientsAllowed) return false;
                rawRequests.add(request);
                return true;
            }
            return this.pageAdmission.authorize(request, rawSocket, this, signal);
        }

        async connectionOpenCallback(socket, request) {
            try {
                const session = sessions.get(request);
                if (session) {
                    Object.defineProperty(socket, 'page', { value: PageClass => {
                        manager.checkConnected(session, socket);
                        if (!(session.page instanceof PageClass)) throw new TypeError('This connection does not own the requested page.');
                        return session.page;
                    } });
                    guards.set(socket, () => manager.authorize(session, socket));
                    session.renderer.authorize = () => manager.authorize(session, socket);
                    await manager.connect(session, socket);
                } else attachRawClient(socket, request, rawRequests);
                await super.connectionOpenCallback(socket, request);
                ready.get(socket).resolve();
            } catch (error) { ready.get(socket).reject(error); throw error; }
        }

        async handleMessage(socket, message) {
            try {
                await ready.get(socket).promise;
                const session = socket.__redwebPageSession;
                if (!session) {
                    requireRawClient(socket);
                    return super.handleMessage(socket, message);
                }
                await manager.authorize(session, socket);
                // Only the bound route's registered commands are accepted. Live action/state
                // envelopes cannot bypass its handlers or mutate page fields.
                const accepted = await super.handleMessage(socket, message);
                if (accepted && message.requestId !== undefined) {
                    manager.checkConnected(session, socket);
                    socket.sendEvent('redweb:result', null, { requestId: message.requestId });
                }
                return accepted;
            } catch (error) {
                if (!(error instanceof AccessDenied)) throw error;
                this.sendAccessFailure(socket, error, { requestId: message?.requestId });
                return false;
            }
        }

        async connectionCloseCallback(socket) {
            // Keep the weak guard: validators already in flight must still fail after close.
            try { await manager.disconnect(socket); }
            finally { await super.connectionCloseCallback?.(socket); }
        }

        async handleBinaryMessage(socket, buffer) {
            await ready.get(socket).promise;
            if (socket.__redwebRawClient) return super.handleBinaryMessage(socket, buffer);
            requirePageSession(socket.__redwebPageSession);
            socket.close(1008, 'Page sockets accept JSON commands only');
            return false;
        }
    };
}

function bindRoutes(manager, RouteClasses) {
    const attached = [...manager.records.values()].filter(record => record.metadata.socket);
    for (const record of attached) {
        if (!RouteClasses.includes(record.metadata.socket)) throw new TypeError('Every page socket route must be registered in the application.');
    }
    return RouteClasses.map(RouteClass => {
        const records = attached.filter(record => record.metadata.socket === RouteClass);
        return records.length ? bindRoute(manager, RouteClass, records) : RouteClass;
    });
}

module.exports = { attachRawClient, bindRoutes, requirePageSession, requireRawClient };
