const { randomUUID } = require('crypto');
const { ADMISSION_CONTEXT } = require('./AdmissionPolicy');
const { PROTOCOL_CONTEXT } = require('./ProtocolPolicy');
const HeartbeatMonitor = require('./HeartbeatMonitor');
const RoomRegistry = require('./RoomRegistry');
const SessionRegistry = require('./SessionRegistry');
const DistributionBridge = require('./DistributionBridge');

function joinRoom(roomId) { return this.__redwebRuntimeOwner.rooms.join(roomId, this); }
function leaveRoom(roomId) { return this.__redwebRuntimeOwner.rooms.leave(roomId, this); }
function roomBroadcast(roomId, data, options) { return this.__redwebRuntimeOwner.rooms.broadcast(roomId, data, options); }
function createSession(sessionId, data) {
    this.__redwebRuntimeOwner.ensureContext(this);
    return this.__redwebRuntimeOwner.sessions.create(sessionId, data, this);
}
function resumeSession(sessionId) {
    this.__redwebRuntimeOwner.ensureContext(this);
    return this.__redwebRuntimeOwner.sessions.resume(sessionId, this);
}
function publishEvent(type, payload) { return this.__redwebRuntimeOwner.route.publish(type, payload); }

class RouteRuntime {
    constructor(route, { heartbeat, rooms, sessions, distribution, drainHandlers }) {
        this.route = route;
        this.inFlight = drainHandlers ? new Set() : null;
        this.abortController = drainHandlers ? new AbortController() : null;
        try {
            this.heartbeat = heartbeat === undefined ? null : new HeartbeatMonitor(heartbeat, route.logger);
            this.rooms = rooms === undefined || rooms === false
                ? null
                : new RoomRegistry(rooms === true ? {} : rooms, {
                    hasConnection: socket => route.clients.get(socket.clientKey) === socket,
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
        if (request?.[ADMISSION_CONTEXT] || request?.[PROTOCOL_CONTEXT] || this.abortController) this.ensureContext(socket, request);
        if (this.rooms || this.sessions || this.distribution) socket.__redwebRuntimeOwner = this;
        if (this.rooms) {
            socket.joinRoom = joinRoom;
            socket.leaveRoom = leaveRoom;
            socket.roomBroadcast = roomBroadcast;
        }
        if (this.sessions) {
            socket.createSession = createSession;
            socket.resumeSession = resumeSession;
        }
        if (this.distribution) socket.publishEvent = publishEvent;
    }

    ensureContext(socket, request) {
        if (socket.context) return socket.context;
        socket.context = {
            connectionId: randomUUID(),
            principal: request?.[ADMISSION_CONTEXT]?.principal,
            session: null,
            metadata: Object.create(null),
            signal: this.abortController?.signal,
            protocol: request?.[PROTOCOL_CONTEXT],
        };
        return socket.context;
    }

    attach(socket) {
        this.heartbeat?.attach(socket);
    }

    detach(socket) {
        this.rooms?.leaveAll(socket);
        this.sessions?.release(socket);
        this.heartbeat?.detach(socket);
    }

    run(task) {
        if (!this.inFlight) return task();
        const promise = Promise.resolve().then(task);
        this.inFlight.add(promise);
        const cleanup = () => this.inFlight.delete(promise);
        void promise.then(cleanup, cleanup);
        return promise;
    }

    beginDrain() {
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
        this.inFlight?.clear();
        this.rooms?.close();
        this.sessions?.stop();
    }
}

module.exports = RouteRuntime;
