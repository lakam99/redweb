'use strict';

const { AccessPolicy, AccessDenied } = require('../access/AccessPolicy');
const { guards } = require('./HandlerGuard');
const { BoundedOperation } = require('../async/BoundedOperation');

/** Deliberately public rejection text; unexpected exceptions remain private. */
class ClientError extends Error {
    constructor(message) {
        if (typeof message !== 'string' || !message || message.length > 512) throw new TypeError('Client error text must contain 1–512 characters.');
        super(message);
    }
}

function assignPageState(page, state) {
    if (Object.keys(state).some(name => ['__proto__', 'prototype', 'constructor'].includes(name))) {
        throw new TypeError('Projected page state contains a reserved property.');
    }
    Object.assign(page, state);
}

class ConnectedClient {
    #owner;
    constructor(owner, socket) {
        this.#owner = owner;
        Object.defineProperty(this, 'socket', { value: socket });
        Object.freeze(this);
    }
    get identity() { this.#owner.assertActive(this.socket); return this.socket.context.principal; }
    get rooms() { return this.#owner.rooms.roomsFor(this.socket); }
    get room() {
        const rooms = this.rooms;
        if (rooms.length !== 1) throw new ClientError('Join a room first.');
        return rooms[0];
    }
    get page() { this.#owner.assertActive(this.socket); return this.socket.page(this.#owner.options.page()); }
    join(room, commit) { return this.#owner.join(this, room, commit); }
    leave(room) { this.#owner.assertActive(this.socket); return this.#owner.rooms.leave(room, this.socket); }
}

/** One route-owned projection layer; RoomRegistry alone owns membership. */
class ConnectedClients {
    #route;
    #clients = new WeakMap();
    #joining = new WeakSet();
    #queued = new Set();
    #generations = new Map();

    constructor(options) {
        if (!options || typeof options !== 'object') throw new TypeError('Connected clients require options.');
        for (const name of ['identity', 'page', 'project']) {
            if (typeof options[name] !== 'function') throw new TypeError(`Connected clients require ${name}.`);
        }
        for (const name of ['reject', 'errorState']) {
            if (options[name] !== undefined && typeof options[name] !== 'function') throw new TypeError(`${name} must be a function.`);
        }
        if (options.raw !== undefined && (!options.raw || typeof options.raw.update !== 'function' ||
            (options.raw.reject !== undefined && typeof options.raw.reject !== 'function'))) {
            throw new TypeError('A raw adapter requires update and an optional reject callback.');
        }
        this.options = Object.freeze({ ...options, raw: options.raw && Object.freeze({ ...options.raw }) });
        this.policy = new AccessPolicy(async context => {
            const identity = await this.options.identity(context);
            return identity !== undefined && identity !== null && identity !== false && Object.is(identity, context.principal);
        }, options.authorizationTimeoutMs);
        this.projection = new BoundedOperation(options.projectionTimeoutMs);
    }

    attach(route, rooms) {
        if (this.#route) throw new TypeError('Connected clients belong to one route instance. Create them inside your application factory.');
        if (!rooms || !route.protocolPolicy) throw new TypeError('Connected clients require rooms and a socket protocol.');
        this.#route = route;
        this.rooms = rooms;
    }

    assertActive(socket) {
        if (!this.#route || this.#route.draining || this.#route.clients.get(socket.clientKey) !== socket ||
            socket.readyState !== 1 || socket.context.signal.aborted) throw new AccessDenied('ACCESS_CANCELLED');
    }

    get(socket) {
        this.assertActive(socket);
        let client = this.#clients.get(socket);
        if (!client) { client = new ConnectedClient(this, socket); this.#clients.set(socket, client); }
        return client;
    }

    async check(socket) {
        this.assertActive(socket);
        await this.policy.check(socket.context);
        const guard = guards.get(socket);
        if (guard) await guard();
        this.assertActive(socket);
        if (!socket.page && !this.options.raw) throw new AccessDenied();
    }

    async join(client, room, commit = () => {}) {
        const socket = client.socket;
        if (typeof commit !== 'function') throw new TypeError('Room commit must be synchronous.');
        if (this.#joining.has(socket)) throw new ClientError('A room join is already pending.');
        const existing = this.rooms.has(room, socket);
        this.#joining.add(socket);
        try {
            await this.check(socket);
            if (!await this.rooms.enter(room, socket)) throw new ClientError('Room capacity or access denied.');
            await this.check(socket);
            if (!this.rooms.has(room, socket)) throw new AccessDenied('ACCESS_CANCELLED');
            const result = commit();
            if (result && typeof result.then === 'function') {
                Promise.resolve(result).catch(() => {});
                throw new TypeError('Room commit must be synchronous.');
            }
        } catch (error) {
            if (!existing) this.rooms.leave(room, socket);
            throw error;
        } finally { this.#joining.delete(socket); this.changed(room); }
    }

    changed(room) {
        if (this.#route.draining) return;
        this.#generations.set(room, Symbol());
        if (this.#queued.has(room)) return;
        this.#queued.add(room);
        queueMicrotask(() => {
            if (!this.#queued.delete(room)) return;
            void this.refresh(room).catch(error => this.#route.logger.error('Connected client refresh failed:', error));
        });
    }

    refresh(room) {
        this.rooms.validateRoomId(room);
        this.#queued.delete(room);
        return this.#route.runtime.run(() => this.project(room));
    }

    async project(room) {
        const generation = Symbol();
        this.#generations.set(room, generation);
        const current = socket => this.#generations.get(room) === generation && this.rooms.has(room, socket) && !this.#joining.has(socket);
        const eligible = [];
        try {
            await Promise.all(this.rooms.members(room).map(async socket => {
                if (!current(socket)) return;
                try {
                    await this.check(socket);
                    if (current(socket)) { const client = this.get(socket); eligible.push({ client, identity: client.identity }); }
                }
                catch (error) { if (current(socket)) this.exclude(socket, error); }
            }));
            const online = Object.freeze([...new Set(eligible.map(entry => entry.identity))]);
            await Promise.all(eligible.map(async ({ client }) => {
                const socket = client.socket;
                try {
                    if (!current(socket)) return;
                    const { state, frame } = await this.projection.run(async () => {
                        const state = await this.options.project(client, room, online);
                        const frame = socket.page ? null : await this.options.raw.update(state);
                        return { state, frame };
                    }, socket.context.signal);
                    await this.check(socket);
                    if (!current(socket)) return;
                    if (socket.page) assignPageState(client.page, state);
                    else socket.sendEvent(frame.type, frame.payload);
                } catch (error) { if (current(socket)) this.exclude(socket, error); }
            }));
        } finally {
            if (this.#generations.get(room) === generation) this.#generations.delete(room);
        }
    }

    exclude(socket, error) {
        this.rooms.leaveAll(socket);
        if (!(error instanceof AccessDenied)) this.#route.handleError(socket, error);
        socket.close(error instanceof AccessDenied ? 1008 : 1011, 'Connection unavailable.');
    }

    bind(contract) {
        return Object.freeze({
            protocol: contract.protocol,
            handler: (type, callback) => {
                if (typeof callback !== 'function') throw new TypeError('A client handler requires a callback.');
                return contract.handler(type, async (socket, payload, message) => {
                    const client = this.get(socket);
                    await this.check(socket);
                    try {
                        const result = await callback(client, payload);
                        if (result === false) return false;
                        await Promise.all(client.rooms.map(room => this.refresh(room)));
                        if (!socket.page && message.requestId !== undefined) {
                            await this.check(socket);
                            socket.sendEvent('redweb:result', null, { requestId: message.requestId });
                        }
                        return result;
                    } catch (error) {
                        const text = error instanceof ClientError ? error.message : this.options.reject?.(error);
                        if (typeof text !== 'string' || !text || text.length > 512) throw error;
                        const metadata = { requestId: message.requestId };
                        const frame = socket.page || !this.options.raw.reject ? null :
                            await this.projection.run(() => this.options.raw.reject(text), socket.context.signal);
                        await this.check(socket);
                        if (socket.page) {
                            if (this.options.errorState) assignPageState(client.page, this.options.errorState(text));
                        } else if (frame) socket.sendEvent(frame.type, frame.payload);
                        socket.sendProtocolError('COMMAND_REJECTED', text, metadata);
                        return false;
                    }
                });
            },
        });
    }
}

const connectedClients = options => new ConnectedClients(options);
module.exports = { connectedClients, ConnectedClients, ConnectedClient, ClientError };
