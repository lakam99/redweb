const { randomUUID } = require('crypto');
const { ADMISSION_CONTEXT } = require('./AdmissionPolicy');
const { PROTOCOL_CONTEXT } = require('./ProtocolPolicy');
const HeartbeatMonitor = require('./HeartbeatMonitor');
const RoomRegistry = require('./RoomRegistry');
const SessionRegistry = require('./SessionRegistry');
const DistributionBridge = require('./DistributionBridge');
const requestSnapshot = require('../context/RequestSnapshot');

function joinRoom(roomId) { return this.__redwebRuntimeOwner.rooms.join(roomId, this); }
function enterRoom(roomId) { return this.__redwebRuntimeOwner.rooms.enter(roomId, this); }
function leaveRoom(roomId) { return this.__redwebRuntimeOwner.rooms.leave(roomId, this); }
function roomBroadcast(roomId, data, options) { return this.__redwebRuntimeOwner.rooms.broadcastFrom(this, roomId, data, options); }
function createSession(sessionId, data) {
    this.__redwebRuntimeOwner.ensureContext(this);
    return this.__redwebRuntimeOwner.sessions.create(sessionId, data, this);
}
function resumeSession(sessionId) {
    this.__redwebRuntimeOwner.ensureContext(this);
    return this.__redwebRuntimeOwner.sessions.resume(sessionId, this);
}
function publishEvent(type, payload) { return this.__redwebRuntimeOwner.route.publish(type, payload); }
function connectionContext() { return this.__redwebRuntimeOwner.ensureContext(this); }

class RouteRuntime {
    constructor(route, { heartbeat, rooms, sessions, distribution, drainHandlers }) {
        this.route = route;
        this.inFlight = drainHandlers ? new Set() : null;
        this.abortController = drainHandlers ? new AbortController() : null;
        this.acceptingWork = true;
        this.contexts = new WeakMap();
        this.requests = new WeakMap();
        this.needsContext = Boolean(route.admissionPolicy || route.protocolPolicy || rooms || sessions || drainHandlers);
        try {
            this.heartbeat = heartbeat === undefined ? null : new HeartbeatMonitor(heartbeat, route.logger);
            this.rooms = rooms === undefined || rooms === false
                ? null
                : new RoomRegistry(rooms === true ? {} : rooms, {
                    hasConnection: socket => !route.draining && route.clients.get(socket.clientKey) === socket &&
                        socket.readyState === 1 && this.contexts.get(socket)?.active !== false,
                    contextFor: socket => this.ensureContext(socket),
                    policy: route.transportPolicy,
                    onChange: action => {
                        route.metrics?.increment(`redweb.room.${action}`);
                        route.metrics?.gauge('redweb.rooms.active', this.rooms.size);
                    },
                });
            this.sessions = sessions === undefined || sessions === false
                ? null
                : new SessionRegistry(sessions === true ? {} : sessions, route.logger);
            if (distribution !== undefined && distribution !== false && typeof distribution?.onEvent !== 'function') {
                throw new TypeError('`distribution.onEvent` must be a function.');
            }
            this.distribution = distribution === undefined || distribution === false
                ? null
                : new DistributionBridge(distribution, event => distribution.onEvent(event, route), route.logger);
        } catch (error) {
            this.heartbeat?.stop();
            this.sessions?.stop();
            throw error;
        }
    }

    expose() {
        return {
            heartbeatMonitor: this.heartbeat,
            rooms: this.rooms,
            sessions: this.sessions,
            distribution: this.distribution,
            inFlight: this.inFlight,
            abortController: this.abortController,
        };
    }

    decorate(socket, request) {
        if (this.needsContext) this.prepareContext(socket, request);
        if (this.rooms || this.sessions || this.distribution) socket.__redwebRuntimeOwner = this;
        if (this.rooms) {
            socket.joinRoom = joinRoom;
            socket.enterRoom = enterRoom;
            socket.leaveRoom = leaveRoom;
            socket.roomBroadcast = roomBroadcast;
        }
        if (this.sessions) {
            socket.createSession = createSession;
            socket.resumeSession = resumeSession;
        }
        if (this.distribution) socket.publishEvent = publishEvent;
    }

    prepareContext(socket, request) {
        const existing = this.contexts.get(socket);
        if (existing) return existing;
        const record = {
            snapshot: this.requests.get(request) || requestSnapshot(request || {}),
            principal: request?.[ADMISSION_CONTEXT]?.principal,
            protocol: request?.[PROTOCOL_CONTEXT],
            active: !this.route.draining, context: null, controller: null,
        };
        this.contexts.set(socket, record);
        socket.__redwebRuntimeOwner = this;
        Object.defineProperty(socket, 'context', { get: connectionContext, enumerable: true });
        return record;
    }

    ensureContext(socket, request) {
        const record = this.prepareContext(socket, request);
        if (record.context) return record.context;
        const controller = new AbortController();
        const snapshot = record.snapshot;
        const context = {
            session: null,
            metadata: Object.create(null),
        };
        const stable = {
            connectionId: randomUUID(),
            principal: record.principal,
            request: snapshot, params: snapshot.params, query: snapshot.query, body: snapshot.body,
            signal: controller.signal,
            protocol: record.protocol,
        };
        for (const [name, value] of Object.entries(stable)) Object.defineProperty(context, name, { value, enumerable: true });
        record.context = context;
        record.controller = controller;
        if (!record.active) controller.abort();
        return context;
    }

    prepareRequest(request) {
        if (this.needsContext) this.requests.set(request, requestSnapshot(request));
    }

    attach(socket) {
        this.heartbeat?.attach(socket);
    }

    detach(socket) {
        const record = this.contexts.get(socket);
        if (record) record.active = false;
        this.rooms?.leaveAll(socket);
        record?.controller?.abort();
        this.sessions?.release(socket);
        this.heartbeat?.detach(socket);
    }

    run(task) {
        if (!this.acceptingWork) return Promise.resolve(false);
        if (!this.inFlight) return task();
        const promise = Promise.resolve().then(task);
        this.inFlight.add(promise);
        const cleanup = () => this.inFlight.delete(promise);
        void promise.then(cleanup, cleanup);
        return promise;
    }

    beginDrain() {
        this.rooms?.close();
        this.route.clients.forEach(socket => {
            const record = this.contexts.get(socket);
            if (record) { record.active = false; record.controller?.abort(); }
        });
        this.abortController?.abort();
        this.route.clients.forEach(socket => socket.__redwebRuntime?.queue?.close());
    }

    isReady() {
        return !this.distribution?.required || this.distribution.isReady();
    }

    stopHeartbeat() {
        this.heartbeat?.stop();
    }

    closeDistribution() {
        return this.distribution?.close();
    }

    closeState() {
        this.rooms?.close();
        this.sessions?.stop();
    }

    clearInFlight() {
        this.inFlight?.clear();
    }

    stopAcceptingWork() {
        this.acceptingWork = false;
    }
}

module.exports = RouteRuntime;
