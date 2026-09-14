const http = require('http');
const net = require('net');
const path = require('path');
const WebSocket = require('ws');
const {
    BaseHandler,
    FixedStepService,
    SecureSocketServer,
    SocketRoute,
    SocketServer,
    SocketService,
} = require('../..');
const {
    closeWebSocket,
    nextMessage,
    openRawWebSocket,
    silentLogger,
    waitForClose,
    waitForCondition,
    waitForListening,
    waitForOpen,
    websocketUpgradeResponse,
    websocketUpgradeStatus,
    withTimeout,
} = require('../helpers/network');

const fixture = name => path.join(__dirname, '..', 'fixtures', name);

function address(socketServer, route = '/', secure = false) {
    const protocol = secure ? 'wss' : 'ws';
    return `${protocol}://127.0.0.1:${socketServer.server.address().port}${route}`;
}

async function connect(url, options) {
    const socket = new WebSocket(url, options);
    await waitForOpen(socket);
    return socket;
}

async function nextJson(socket) {
    const { data, isBinary } = await nextMessage(socket);
    expect(isBinary).toBe(false);
    return JSON.parse(data.toString());
}

async function expectConnectionFailure(url, options) {
    return websocketUpgradeStatus(url, options);
}

describe('WebSocket integration without mocks', () => {
    const socketServers = new Set();
    const clients = new Set();
    const borrowedServers = new Set();

    afterEach(async () => {
        await Promise.all([...clients].map(closeWebSocket));
        clients.clear();
        await Promise.all([...socketServers].map(server => server.shutdown()));
        socketServers.clear();
        await Promise.all([...borrowedServers].map(server => new Promise(resolve => {
            if (!server.listening) return resolve();
            server.close(resolve);
        })));
        borrowedServers.clear();
    });

    async function start(options = {}, ServerClass = SocketServer) {
        const server = new ServerClass({
            port: 0,
            bind: '127.0.0.1',
            logger: silentLogger,
            ...options,
        });
        socketServers.add(server);
        await waitForListening(server.server);
        return server;
    }

    async function trackedConnect(url, options) {
        const socket = await connect(url, options);
        clients.add(socket);
        return socket;
    }

    async function trackedConnectWithFirstJson(url, options) {
        const socket = new WebSocket(url, options);
        clients.add(socket);
        const firstMessage = nextJson(socket);
        await waitForOpen(socket);
        return { socket, firstMessage };
    }

    test('the default route handles a real message', async () => {
        const server = await start();
        const client = await trackedConnect(address(server));
        client.send(JSON.stringify({ type: 'DefaultHandler', value: 7 }));

        const response = await nextJson(client);
        expect(response.message).toContain('"value":7');
    });

    test('routes text and binary messages, broadcasts to peers, and runs initial-contact hooks', async () => {
        class RealtimeHandler extends BaseHandler {
            constructor() { super('realtime'); }
            onInitialContact(socket) { socket.sendJson({ type: 'ready' }); }
            onMessage(socket, message) {
                socket.sendJson({ type: 'ack', value: message.value });
                socket.broadcast({ type: 'peer', value: message.value });
            }
            acceptsBinary(_socket, buffer) { return buffer.length > 0; }
            onBinaryMessage(socket, buffer) { socket.sendJson({ type: 'binary', bytes: buffer.length }); }
        }
        class RealtimeRoute extends SocketRoute {
            constructor() {
                super({
                    path: '/realtime',
                    handlers: [RealtimeHandler],
                    allowDuplicateConnections: true,
                    logger: silentLogger,
                });
            }
        }

        const server = await start({ routes: [RealtimeRoute] });
        const firstConnection = await trackedConnectWithFirstJson(address(server, '/realtime'));
        const first = firstConnection.socket;
        expect(await firstConnection.firstMessage).toEqual({ type: 'ready' });
        const secondConnection = await trackedConnectWithFirstJson(address(server, '/realtime'));
        const second = secondConnection.socket;
        expect(await secondConnection.firstMessage).toEqual({ type: 'ready' });

        const acknowledged = nextJson(first);
        const broadcasted = nextJson(second);
        first.send(JSON.stringify({ type: 'realtime', value: 9 }));
        expect(await acknowledged).toEqual({ type: 'ack', value: 9 });
        expect(await broadcasted).toEqual({ type: 'peer', value: 9 });

        first.send(Buffer.from([1, 2, 3]));
        expect(await nextJson(first)).toEqual({ type: 'binary', bytes: 3 });
    });

    test('rejects malformed messages and safely handles async failures', async () => {
        class FailureHandler extends BaseHandler {
            constructor() { super('fail'); }
            async onMessage() {
                await Promise.resolve();
                throw new Error('private failure detail');
            }
        }
        class FailureRoute extends SocketRoute {
            constructor() { super({ path: '/fail', handlers: [FailureHandler], logger: silentLogger }); }
        }

        const malformedServer = await start({ routes: [FailureRoute] });
        const malformed = await trackedConnect(address(malformedServer, '/fail'));
        malformed.send('{bad json');
        expect(await nextJson(malformed)).toEqual({ error: 'Invalid JSON format' });
        expect((await waitForClose(malformed)).code).toBe(1003);
        clients.delete(malformed);

        const unknown = await trackedConnect(address(malformedServer, '/fail'));
        unknown.send(JSON.stringify({ type: 'missing' }));
        expect(await nextJson(unknown)).toEqual({ error: 'No such handler missing' });
        expect((await waitForClose(unknown)).code).toBe(1008);
        clients.delete(unknown);

        const invalidShape = await trackedConnect(address(malformedServer, '/fail'));
        invalidShape.send(JSON.stringify({ value: 1 }));
        expect(await nextJson(invalidShape)).toEqual({ error: 'Message must be an object with a non-empty string `type`' });
        expect((await waitForClose(invalidShape)).code).toBe(1008);
        clients.delete(invalidShape);

        const failed = await trackedConnect(address(malformedServer, '/fail'));
        failed.send(JSON.stringify({ type: 'fail' }));
        expect(await nextJson(failed)).toEqual({ error: 'Handler failed' });
        expect((await waitForClose(failed)).code).toBe(1011);
        clients.delete(failed);
    });

    test('contains synchronous initial-contact failures and closes the client safely', async () => {
        class InitialFailureHandler extends BaseHandler {
            constructor() { super('initial-failure'); }
            onMessage() {}
            onInitialContact() { throw new Error('synchronous initial failure'); }
        }
        class InitialFailureRoute extends SocketRoute {
            constructor() { super({ path: '/initial-failure', handlers: [InitialFailureHandler], logger: silentLogger }); }
        }
        const server = await start({ routes: [InitialFailureRoute] });
        const { socket: client, firstMessage } = await trackedConnectWithFirstJson(address(server, '/initial-failure'));
        expect(await firstMessage).toEqual({ error: 'Connection initialization failed' });
        expect((await waitForClose(client)).code).toBe(1011);
        clients.delete(client);
    });

    test('contains throwing route open and close callbacks on real connections', async () => {
        let closeFailures = 0;
        let observeCloseCallback;
        const closeCallbackRan = withTimeout(new Promise(resolve => {
            observeCloseCallback = resolve;
        }), 'route close callback');
        const callbackLogger = {
            ...silentLogger,
            error(_message, error) {
                if (error?.message === 'close callback failed') closeFailures += 1;
            },
        };
        class NoopHandler extends BaseHandler {
            constructor() { super('noop'); }
            onMessage() {}
        }
        class OpenFailureRoute extends SocketRoute {
            constructor() { super({ path: '/open-callback', handlers: [NoopHandler], logger: silentLogger }); }
            connectionOpenCallback() { throw new Error('open callback failed'); }
        }
        class CloseFailureRoute extends SocketRoute {
            constructor() { super({ path: '/close-callback', handlers: [NoopHandler], logger: callbackLogger }); }
            connectionCloseCallback() {
                observeCloseCallback();
                throw new Error('close callback failed');
            }
        }

        const openServer = await start({ routes: [OpenFailureRoute] });
        const { socket: failedOpen, firstMessage } = await trackedConnectWithFirstJson(address(openServer, '/open-callback'));
        expect(await firstMessage).toEqual({ error: 'Connection initialization failed' });
        expect((await waitForClose(failedOpen)).code).toBe(1011);
        clients.delete(failedOpen);

        const closeServer = await start({ routes: [CloseFailureRoute] });
        const closingClient = await trackedConnect(address(closeServer, '/close-callback'));
        await closeWebSocket(closingClient);
        clients.delete(closingClient);
        await closeCallbackRan;
        await new Promise(setImmediate);
        expect(closeFailures).toBe(1);

        const healthyClient = await trackedConnect(address(closeServer, '/close-callback'));
        expect(healthyClient.readyState).toBe(WebSocket.OPEN);
    });

    test('authenticates before upgrade and exposes separate connection and principal identities', async () => {
        let initialContacts = 0;
        class IdentityHandler extends BaseHandler {
            constructor() { super('identity'); }
            onInitialContact(socket) {
                initialContacts += 1;
                socket.sendJson({
                    connectionId: socket.context.connectionId,
                    playerId: socket.context.principal.playerId,
                    clientKey: socket.clientKey,
                });
            }
            onMessage() {}
        }
        class ProtectedRoute extends SocketRoute {
            constructor() {
                super({
                    path: '/protected',
                    handlers: [IdentityHandler],
                    allowDuplicateConnections: true,
                    logger: silentLogger,
                    admission: {
                        origins: ['https://game.example'],
                        async authenticate(request) {
                            await Promise.resolve();
                            return request.headers.authorization === 'Bearer valid'
                                ? { playerId: 'player-7' }
                                : false;
                        },
                    },
                });
            }
        }

        const server = await start({ routes: [ProtectedRoute] });
        expect(await expectConnectionFailure(address(server, '/protected'), {
            headers: { origin: 'https://evil.example', authorization: 'Bearer valid' },
        })).toBe(403);
        expect(await expectConnectionFailure(address(server, '/protected'), {
            headers: { origin: 'https://game.example', authorization: 'Bearer invalid' },
        })).toBe(401);
        expect(initialContacts).toBe(0);

        const { socket: client, firstMessage } = await trackedConnectWithFirstJson(address(server, '/protected'), {
            headers: { origin: 'https://game.example', authorization: 'Bearer valid' },
        });
        const identity = await firstMessage;
        expect(identity).toMatchObject({ playerId: 'player-7' });
        expect(identity.connectionId).not.toBe(identity.clientKey);
        expect(initialContacts).toBe(1);
    });

    test('bounds admission time and rejects generically without running application hooks', async () => {
        let initialContacts = 0;
        let aborted = false;
        class NoopHandler extends BaseHandler {
            constructor() { super('noop'); }
            onMessage() {}
            onInitialContact() { initialContacts += 1; }
        }
        class TimedAdmissionRoute extends SocketRoute {
            constructor() {
                super({
                    path: '/timed-admission',
                    handlers: [NoopHandler],
                    logger: silentLogger,
                    admission: {
                        timeoutMs: 10,
                        authenticate(_request, { signal }) {
                            signal.addEventListener('abort', () => { aborted = true; }, { once: true });
                            return new Promise(() => {});
                        },
                    },
                });
            }
        }
        const server = await start({ routes: [TimedAdmissionRoute] });
        expect(await expectConnectionFailure(address(server, '/timed-admission'))).toBe(503);
        expect(aborted).toBe(true);
        expect(initialContacts).toBe(0);
        expect(server.routes[0].clients.size).toBe(0);
    });

    test('bounds pending admission and cancels every pending hook before drain', async () => {
        const signals = [];
        class NoopHandler extends BaseHandler {
            constructor() { super('noop'); }
            onMessage() {}
        }
        class BoundedAdmissionRoute extends SocketRoute {
            constructor() {
                super({
                    path: '/bounded-admission',
                    handlers: [NoopHandler],
                    logger: silentLogger,
                    maxPendingUpgrades: 2,
                    admission: {
                        timeoutMs: 5000,
                        authenticate(_request, { signal }) {
                            signals.push(signal);
                            return new Promise(resolve => signal.addEventListener('abort', () => resolve(false), { once: true }));
                        },
                    },
                });
            }
        }
        const server = await start({ routes: [BoundedAdmissionRoute] });
        const first = expectConnectionFailure(address(server, '/bounded-admission'));
        const second = expectConnectionFailure(address(server, '/bounded-admission'));
        while (signals.length < 2) await new Promise(resolve => setImmediate(resolve));
        expect(await expectConnectionFailure(address(server, '/bounded-admission'))).toBe(503);
        expect(server.routes[0].pendingUpgrades).toBe(2);

        expect(server.beginDrain()).toBe(true);
        expect(await first).toBe(503);
        expect(await second).toBe(503);
        expect(signals.every(signal => signal.aborted)).toBe(true);
        await new Promise(setImmediate);
        expect(server.routes[0].pendingUpgrades).toBe(0);
    });

    test('retains admission capacity until a timed-out non-cooperating hook settles', async () => {
        let finishAuthentication;
        class NonCooperatingRoute extends SocketRoute {
            constructor() {
                super({
                    path: '/non-cooperating-admission',
                    handlers: [class extends BaseHandler {
                        constructor() { super('noop'); }
                        onMessage() {}
                    }],
                    logger: silentLogger,
                    maxPendingUpgrades: 1,
                    admission: {
                        timeoutMs: 5,
                        authenticate: () => new Promise(resolve => { finishAuthentication = resolve; }),
                    },
                });
            }
        }
        const server = await start({ routes: [NonCooperatingRoute] });
        expect(await expectConnectionFailure(address(server, '/non-cooperating-admission'))).toBe(503);
        expect(server.routes[0].pendingUpgrades).toBe(1);
        expect(await expectConnectionFailure(address(server, '/non-cooperating-admission'))).toBe(503);
        finishAuthentication(false);
        while (server.routes[0].pendingUpgrades) await new Promise(resolve => setImmediate(resolve));
        expect(server.routes[0].pendingUpgrades).toBe(0);
    });

    test('serializes messages only when opted in and bounds the pending queue', async () => {
        const completions = [];
        let releaseFirst;
        const firstBlocked = new Promise(resolve => { releaseFirst = resolve; });
        class WorkHandler extends BaseHandler {
            constructor() { super('work'); }
            async onMessage(socket, message) {
                if (message.value === 1) await firstBlocked;
                completions.push(message.value);
                socket.sendJson({ value: message.value });
            }
        }
        class OrderedRoute extends SocketRoute {
            constructor() {
                super({
                    path: '/ordered',
                    handlers: [WorkHandler],
                    orderedMessages: true,
                    limits: { maxPendingMessages: 1 },
                    logger: silentLogger,
                });
            }
        }
        const server = await start({ routes: [OrderedRoute] });
        const client = await trackedConnect(address(server, '/ordered'));
        client.send(JSON.stringify({ type: 'work', value: 1 }));
        client.send(JSON.stringify({ type: 'work', value: 2 }));
        client.send(JSON.stringify({ type: 'work', value: 3 }));
        expect(await nextJson(client)).toEqual({ error: 'Message queue full' });
        expect((await waitForClose(client)).code).toBe(1013);
        clients.delete(client);
        await waitForCondition(() => server.routes[0].clients.size === 0, 'ordered route cleanup');
        releaseFirst();
        await waitForCondition(() => completions.length === 1, 'active ordered message completion');
        expect(completions).toEqual([1]);
    });

    test('enforces message rate, connection capacity, and slow-consumer limits on real sockets', async () => {
        class EchoHandler extends BaseHandler {
            constructor() { super('echo'); }
            onInitialContact(socket) { socket.sendJson({ ready: true }); }
            onMessage(socket, message) { socket.sendJson({ value: message.value }); }
        }
        class LimitedRoute extends SocketRoute {
            constructor() {
                super({
                    path: '/limited',
                    handlers: [EchoHandler],
                    allowDuplicateConnections: true,
                    limits: {
                        maxConnections: 1,
                        messageRate: { capacity: 1, refillPerSecond: 0 },
                    },
                    logger: silentLogger,
                });
            }
        }
        class BackpressuredRoute extends SocketRoute {
            constructor() {
                super({
                    path: '/backpressured',
                    handlers: [EchoHandler],
                    limits: { maxBufferedBytes: 0 },
                    logger: silentLogger,
                });
            }
        }
        const server = await start({ routes: [LimitedRoute, BackpressuredRoute] });
        const { socket: first, firstMessage } = await trackedConnectWithFirstJson(address(server, '/limited'));
        expect(await firstMessage).toEqual({ ready: true });
        first.send(JSON.stringify({ type: 'echo', value: 1 }));
        expect(await nextJson(first)).toEqual({ value: 1 });
        first.send(JSON.stringify({ type: 'echo', value: 2 }));
        expect(await nextJson(first)).toEqual({ error: 'Message rate exceeded' });
        expect((await waitForClose(first)).code).toBe(1008);
        clients.delete(first);

        await waitForCondition(() => server.routes[0].clients.size === 0, 'rate-limited client cleanup');
        const { socket: capacityHolder, firstMessage: capacityReady } = await trackedConnectWithFirstJson(address(server, '/limited'));
        expect(await capacityReady).toEqual({ ready: true });
        expect(await expectConnectionFailure(address(server, '/limited'))).toBe(503);

        const backpressured = await trackedConnect(address(server, '/backpressured'));
        expect((await waitForClose(backpressured)).code).toBe(1013);
        clients.delete(backpressured);
    });

    test('terminates a real half-open peer with one route heartbeat scheduler', async () => {
        class NoopHandler extends BaseHandler {
            constructor() { super('noop'); }
            onMessage() {}
        }
        class HeartbeatRoute extends SocketRoute {
            constructor() {
                super({
                    path: '/heartbeat',
                    handlers: [NoopHandler],
                    heartbeat: { intervalMs: 10, timeoutMs: 10 },
                    logger: silentLogger,
                });
            }
        }
        const server = await start({ routes: [HeartbeatRoute] });
        const rawClient = await openRawWebSocket(server.server.address().port, '/heartbeat');
        await withTimeout(new Promise(resolve => rawClient.once('close', resolve)), 'heartbeat termination');
        await waitForCondition(() => server.routes[0].clients.size === 0, 'heartbeat route cleanup');
        expect(server.routes[0].clients.size).toBe(0);
    });

    test('does not blame a responsive peer for a delayed server heartbeat tick', async () => {
        class NoopHandler extends BaseHandler {
            constructor() { super('noop'); }
            onMessage() {}
        }
        class HeartbeatRoute extends SocketRoute {
            constructor() {
                super({ path: '/heartbeat-delay', handlers: [NoopHandler],
                    heartbeat: { intervalMs: 50, timeoutMs: 50 }, logger: silentLogger });
            }
        }
        const server = await start({ routes: [HeartbeatRoute] });
        const client = await trackedConnect(address(server, '/heartbeat-delay'));
        const peer = [...server.routes[0].clients.values()][0];
        const ping = peer.ping.bind(peer);
        let delayed = false, pings = 0;
        peer.ping = (...args) => {
            pings++;
            ping(...args);
            if (!delayed) { delayed = true; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120); }
        };
        await waitForCondition(() => pings >= 2, 'responsive peer pong recovery', 1000);
        expect(delayed).toBe(true);
        expect(client.readyState).toBe(WebSocket.OPEN);
    });

    test.each([0, 50])('manages real room membership, atomic session takeover, expiry, metrics, and fixed ticks (observer delay=%sms)', async observerDelayMs => {
        const metricEvents = [];
        const closeSnapshots = [];
        let ticks = 0;
        class GameLoop extends FixedStepService {
            constructor() { super('game-loop', 5, 2); }
            onTick() { ticks += 1; }
        }
        class MultiplayerHandler extends BaseHandler {
            constructor() { super('multiplayer'); }
            onMessage(socket, message) {
                if (message.action === 'join') {
                    socket.sendJson({ joined: socket.joinRoom(message.roomId) });
                } else if (message.action === 'leave') {
                    socket.sendJson({ left: socket.leaveRoom(message.roomId) });
                } else if (message.action === 'broadcast') {
                    const recipients = socket.roomBroadcast(
                        message.roomId,
                        { roomEvent: message.value },
                        { except: socket }
                    );
                    socket.sendJson({ recipients });
                } else if (message.action === 'create-session') {
                    socket.sendJson({ created: socket.createSession(message.sessionId, message.data) });
                } else if (message.action === 'resume-session') {
                    socket.sendJson({ resumed: socket.resumeSession(message.sessionId) });
                }
            }
        }
        class MultiplayerRoute extends SocketRoute {
            constructor() {
                super({
                    path: '/multiplayer',
                    handlers: [MultiplayerHandler],
                    services: [GameLoop],
                    allowDuplicateConnections: true,
                    rooms: { maxRooms: 4, maxMembersPerRoom: 4 },
                    sessions: { ttlMs: 20, maxSessions: 4, sweepIntervalMs: 5 },
                    metrics: {
                        increment(name, value, attributes) { metricEvents.push(['increment', name, value, attributes]); },
                        gauge(name, value, attributes) { metricEvents.push(['gauge', name, value, attributes]); },
                    },
                    logger: silentLogger,
                });
            }
            connectionCloseCallback() {
                // Observe release in its lifecycle callback, before a later
                // timer turn can legitimately expire the disconnected session.
                closeSnapshots.push({ clients: this.clients.size, rooms: this.rooms.size,
                    sessions: this.sessions.size, data: this.sessions.get('opaque-1') });
            }
        }
        const server = await start({ routes: [MultiplayerRoute] });
        const route = server.routes[0];
        const first = await trackedConnect(address(server, '/multiplayer'));
        const second = await trackedConnect(address(server, '/multiplayer'));

        first.send(JSON.stringify({ type: 'multiplayer', action: 'join', roomId: 'match-1' }));
        expect(await nextJson(first)).toEqual({ joined: true });
        second.send(JSON.stringify({ type: 'multiplayer', action: 'join', roomId: 'match-1' }));
        expect(await nextJson(second)).toEqual({ joined: true });
        expect(route.rooms.members('match-1')).toHaveLength(2);

        const senderAck = nextJson(first);
        const peerEvent = nextJson(second);
        first.send(JSON.stringify({ type: 'multiplayer', action: 'broadcast', roomId: 'match-1', value: 7 }));
        expect(await senderAck).toEqual({ recipients: 1 });
        expect(await peerEvent).toEqual({ roomEvent: 7 });

        second.send(JSON.stringify({ type: 'multiplayer', action: 'leave', roomId: 'match-1' }));
        expect(await nextJson(second)).toEqual({ left: true });
        second.send(JSON.stringify({ type: 'multiplayer', action: 'join', roomId: 'match-1' }));
        expect(await nextJson(second)).toEqual({ joined: true });

        first.send(JSON.stringify({
            type: 'multiplayer',
            action: 'create-session',
            sessionId: 'opaque-1',
            data: { score: 9 },
        }));
        expect(await nextJson(first)).toEqual({ created: true });
        const firstClosed = waitForClose(first);
        second.send(JSON.stringify({ type: 'multiplayer', action: 'resume-session', sessionId: 'opaque-1' }));
        expect(await nextJson(second)).toEqual({ resumed: { score: 9 } });
        expect((await firstClosed).code).toBe(4000);
        clients.delete(first);
        await waitForCondition(() => route.rooms.members('match-1').length === 1, 'session takeover cleanup');
        expect(route.rooms.members('match-1')).toHaveLength(1);
        expect(route.sessions.size).toBe(1);

        await closeWebSocket(second);
        clients.delete(second);
        if (observerDelayMs) await new Promise(resolve => setTimeout(resolve, observerDelayMs));
        await waitForCondition(() => route.rooms.size === 0, 'room cleanup');
        await waitForCondition(() => closeSnapshots.length === 2, 'session release callbacks');
        expect(closeSnapshots).toEqual([
            { clients: 1, rooms: 1, sessions: 1, data: { score: 9 } },
            { clients: 0, rooms: 0, sessions: 1, data: { score: 9 } },
        ]);
        await waitForCondition(() => route.sessions.size === 0, 'session expiry');
        expect(route.sessions.size).toBe(0);
        expect(route.rooms.size).toBe(0);
        expect(ticks).toBeGreaterThan(0);
        expect(metricEvents).toEqual(expect.arrayContaining([
            ['increment', 'redweb.connections.accepted', 1, { route: '/multiplayer' }],
            ['increment', 'redweb.room.join', 1, { route: '/multiplayer' }],
            ['gauge', 'redweb.rooms.active', 0, { route: '/multiplayer' }],
        ]));
        expect(metricEvents.every(event => Object.keys(event[3]).join() === 'route')).toBe(true);
    });

    test('enforces strict paths by default and supports an explicit root fallback', async () => {
        const strict = await start();
        expect(await expectConnectionFailure(address(strict, '/unknown'))).toBe('error');

        const fallback = await start({ fallbackToRoot: true });
        const client = await trackedConnect(address(fallback, '/legacy-path'));
        client.send(JSON.stringify({ type: 'DefaultHandler' }));
        expect((await nextJson(client)).message).toContain('I got your message');
    });

    test('replaces duplicate client identities and supports trusted proxy or custom keys', async () => {
        class NoopHandler extends BaseHandler {
            constructor() { super('noop'); }
            onMessage() {}
        }
        class ProxyRoute extends SocketRoute {
            constructor() {
                super({ path: '/proxy', handlers: [NoopHandler], trustProxy: true, logger: silentLogger });
            }
        }
        const server = await start({ routes: [ProxyRoute] });
        const first = await trackedConnect(address(server, '/proxy'), { headers: { 'x-forwarded-for': '198.51.100.1' } });
        const second = await trackedConnect(address(server, '/proxy'), { headers: { 'x-forwarded-for': '198.51.100.2, 10.0.0.1' } });
        expect(server.routes[0].clients.size).toBe(2);

        const firstClosed = waitForClose(first);
        const replacement = await trackedConnect(address(server, '/proxy'), { headers: { 'x-forwarded-for': '198.51.100.1' } });
        expect((await firstClosed).code).toBe(1000);
        clients.delete(first);
        expect(server.routes[0].clients.size).toBe(2);
        expect(replacement.readyState).toBe(WebSocket.OPEN);
        expect(second.readyState).toBe(WebSocket.OPEN);
    });

    test('runs route services and shuts them down', async () => {
        let initialized = 0;
        let ticks = 0;
        let stopped = 0;
        class CountingService extends SocketService {
            constructor() { super('counter', 10); }
            onInit(route) {
                initialized += 1;
                super.onInit(route);
            }
            onTick() { ticks += 1; }
            onShutdown() {
                stopped += 1;
                super.onShutdown();
            }
        }
        class NoopHandler extends BaseHandler {
            constructor() { super('noop'); }
            onMessage() {}
        }
        class ServiceRoute extends SocketRoute {
            constructor() { super({ path: '/service', handlers: [NoopHandler], services: [CountingService], logger: silentLogger }); }
        }

        const server = await start({ routes: [ServiceRoute] });
        await new Promise(resolve => setTimeout(resolve, 35));
        expect(initialized).toBe(1);
        expect(ticks).toBeGreaterThan(0);
        await server.shutdown();
        socketServers.delete(server);
        expect(stopped).toBe(1);
    });

    test('finishes all cleanup and closes the owned listener when a service rejects shutdown', async () => {
        class RejectingService extends SocketService {
            constructor() { super('rejecting'); }
            onShutdown() { return Promise.reject(new Error('service cleanup failed')); }
        }
        class NoopHandler extends BaseHandler {
            constructor() { super('noop'); }
            onMessage() {}
        }
        class RejectingRoute extends SocketRoute {
            constructor() {
                super({
                    path: '/rejecting-shutdown',
                    handlers: [NoopHandler],
                    services: [RejectingService],
                    logger: silentLogger,
                    shutdownTimeoutMs: 50,
                });
            }
        }
        const server = await start({ routes: [RejectingRoute] });
        const client = await trackedConnect(address(server, '/rejecting-shutdown'));
        const clientClosed = waitForClose(client);

        await expect(server.shutdown()).rejects.toMatchObject({
            message: 'One or more WebSocket server cleanup operations failed.',
        });
        await clientClosed;
        clients.delete(client);
        socketServers.delete(server);
        expect(server.server.listening).toBe(false);
        expect(server.routes[0].clients.size).toBe(0);
    });

    test('terminates a non-cooperating raw WebSocket peer after the shutdown grace period', async () => {
        class NoopHandler extends BaseHandler {
            constructor() { super('noop'); }
            onMessage() {}
        }
        class TimedRoute extends SocketRoute {
            constructor() {
                super({
                    path: '/raw-peer',
                    handlers: [NoopHandler],
                    logger: silentLogger,
                    shutdownTimeoutMs: 25,
                });
            }
        }
        const server = await start({ routes: [TimedRoute] });
        const rawClient = await openRawWebSocket(server.server.address().port, '/raw-peer');
        const rawClosed = withTimeout(new Promise(resolve => rawClient.once('close', resolve)), 'raw peer close');
        const startedAt = Date.now();

        await server.shutdown();
        await rawClosed;
        socketServers.delete(server);
        expect(Date.now() - startedAt).toBeLessThan(1000);
        expect(server.server.listening).toBe(false);
    });

    test('does not close a borrowed HTTP server and removes its upgrade listener', async () => {
        class NoopHandler extends BaseHandler {
            constructor() { super('noop'); }
            onMessage() {}
        }
        class BorrowedRoute extends SocketRoute {
            constructor() { super({ path: '/borrowed', handlers: [NoopHandler], logger: silentLogger }); }
        }
        const borrowed = http.createServer((_req, res) => res.end('still alive'));
        borrowedServers.add(borrowed);
        const server = new SocketServer({ server: borrowed, routes: [BorrowedRoute], logger: silentLogger });
        socketServers.add(server);
        borrowed.listen(0, '127.0.0.1');
        await waitForListening(borrowed);
        const client = await trackedConnect(address(server, '/borrowed'));
        await closeWebSocket(client);
        clients.delete(client);

        await server.shutdown();
        socketServers.delete(server);
        expect(borrowed.listening).toBe(true);
        expect(borrowed.listenerCount('upgrade')).toBe(0);
    });

    test('bounds owned-server shutdown with an incomplete HTTP peer', async () => {
        class ShortRoute extends SocketRoute {
            constructor() {
                super({ path: '/', handlers: [class extends BaseHandler {
                    constructor() { super('noop'); }
                    onMessage() {}
                }], logger: silentLogger, shutdownTimeoutMs: 25 });
            }
        }
        const server = await start({ routes: [ShortRoute] });
        const peer = net.connect(server.server.address().port, '127.0.0.1');
        await new Promise((resolve, reject) => {
            peer.once('connect', resolve);
            peer.once('error', reject);
        });
        peer.write('GET / HTTP/1.1\r\nHost: localhost\r\n');
        const peerClosed = new Promise(resolve => peer.once('close', resolve));
        const started = Date.now();
        await server.shutdown();
        await peerClosed;
        socketServers.delete(server);
        expect(Date.now() - started).toBeLessThan(250);
        expect(peer.destroyed).toBe(true);
    });

    test('bounds explicitly authorized borrowed-server shutdown with an incomplete HTTP peer', async () => {
        class ShortBorrowedRoute extends SocketRoute {
            constructor() {
                super({ path: '/', handlers: [class extends BaseHandler {
                    constructor() { super('noop'); }
                    onMessage() {}
                }], logger: silentLogger, shutdownTimeoutMs: 25 });
            }
        }
        const listener = http.createServer();
        const server = await start({
            server: listener,
            listen: true,
            closeServerOnShutdown: true,
            routes: [ShortBorrowedRoute],
        });
        const peer = net.connect(listener.address().port, '127.0.0.1');
        await new Promise((resolve, reject) => {
            peer.once('connect', resolve);
            peer.once('error', reject);
        });
        peer.write('GET / HTTP/1.1\r\nHost: localhost\r\n');
        const peerClosed = new Promise(resolve => peer.once('close', resolve));
        await server.shutdown();
        socketServers.delete(server);
        await peerClosed;
        expect(peer.destroyed).toBe(true);
    });

    test('tracks connection lifecycle hooks within the drain deadline', async () => {
        let initialFinished = false;
        let closeFinished = false;
        class LifecycleHandler extends BaseHandler {
            constructor() { super('lifecycle'); }
            onMessage() {}
            async onInitialContact(socket) {
                await new Promise(resolve => socket.context.signal.addEventListener('abort', resolve, { once: true }));
                initialFinished = true;
                expect(socket.joinRoom('late')).toBe(false);
            }
        }
        class LifecycleRoute extends SocketRoute {
            constructor() {
                super({
                    path: '/lifecycle', handlers: [LifecycleHandler], logger: silentLogger,
                    rooms: true, drainHandlers: true, shutdownTimeoutMs: 100,
                });
            }
            async connectionCloseCallback() {
                await new Promise(resolve => setTimeout(resolve, 10));
                closeFinished = true;
            }
        }
        const server = await start({ routes: [LifecycleRoute] });
        await trackedConnect(address(server, '/lifecycle'));
        await server.shutdown();
        socketServers.delete(server);
        expect(initialFinished).toBe(true);
        expect(closeFinished).toBe(true);
    });

    test('invokes a forced late-close callback exactly once before shutdown returns', async () => {
        let closeCallbacks = 0;
        class LateCloseRoute extends SocketRoute {
            constructor() {
                super({
                    path: '/late-close', handlers: [class extends BaseHandler {
                        constructor() { super('noop'); }
                        onMessage() {}
                    }], logger: silentLogger, drainHandlers: true, shutdownTimeoutMs: 20,
                });
            }
            connectionCloseCallback() { closeCallbacks += 1; }
        }
        const server = await start({ routes: [LateCloseRoute] });
        const client = await trackedConnect(address(server, '/late-close'));
        client._socket.pause();
        await server.shutdown();
        socketServers.delete(server);
        expect(closeCallbacks).toBe(1);
        client._socket.resume();
        await new Promise(resolve => setTimeout(resolve, 30));
        expect(closeCallbacks).toBe(1);
    });

    test('redirects placement before upgrade and follows the redirect to the selected node', async () => {
        class NoopHandler extends BaseHandler {
            constructor() { super('noop'); }
            onMessage(socket) { socket.sendJson({ node: 'target' }); }
        }
        class TargetRoute extends SocketRoute {
            constructor() { super({ path: '/placed', handlers: [NoopHandler], logger: silentLogger }); }
        }
        const target = await start({ routes: [TargetRoute] });
        const location = address(target, '/placed');
        class SourceRoute extends SocketRoute {
            constructor() {
                super({
                    path: '/placed',
                    handlers: [NoopHandler],
                    logger: silentLogger,
                    admission: { place: () => location, allowInsecurePlacement: true },
                });
            }
        }
        const source = await start({ routes: [SourceRoute] });

        const client = new WebSocket(address(source, '/placed'), { followRedirects: true });
        clients.add(client);
        const redirects = [];
        client.on('redirect', redirectedUrl => redirects.push(redirectedUrl));
        await waitForOpen(client);
        expect(redirects).toEqual([location]);
        client.send(JSON.stringify({ type: 'noop' }));
        expect(await nextJson(client)).toEqual({ node: 'target' });
        expect(source.routes[0].clients.size).toBe(0);
        expect(target.routes[0].clients.size).toBe(1);
    });

    test('distributes bounded events between real servers without reflecting them to the source', async () => {
        class MemoryBus {
            constructor() { this.channels = new Map(); }
            adapter() {
                let subscription;
                return {
                    publish: (channel, event) => {
                        for (const listener of this.channels.get(channel) || []) listener(event);
                    },
                    subscribe: (channel, listener) => {
                        const listeners = this.channels.get(channel) || new Set();
                        listeners.add(listener);
                        this.channels.set(channel, listeners);
                        subscription = { channel, listener };
                        return () => listeners.delete(listener);
                    },
                    close: () => { subscription = undefined; },
                };
            }
        }
        const bus = new MemoryBus();
        const routeClass = (nodeId) => class DistributedRoute extends SocketRoute {
            constructor() {
                super({
                    path: '/distributed',
                    handlers: [class PublishHandler extends BaseHandler {
                        constructor() { super('publish'); }
                        onInitialContact(socket) {
                            socket.joinRoom('match');
                        }
                        async onMessage(socket, message) {
                            socket.sendJson({ published: await socket.publishEvent('state', message.value) });
                        }
                    }],
                    allowDuplicateConnections: true,
                    logger: silentLogger,
                    rooms: true,
                    distribution: {
                        adapter: bus.adapter(),
                        channel: 'matches',
                        nodeId,
                        onEvent: event => this.rooms.broadcast('match', {
                            type: event.type,
                            value: event.payload,
                            source: event.source,
                        }),
                    },
                });
            }
        };
        const firstServer = await start({ routes: [routeClass('node-a')] });
        const secondServer = await start({ routes: [routeClass('node-b')] });
        expect(await firstServer.routes[0].distribution.ready).toBe(true);
        expect(await secondServer.routes[0].distribution.ready).toBe(true);
        const first = await trackedConnect(address(firstServer, '/distributed'));
        const second = await trackedConnect(address(secondServer, '/distributed'));
        await new Promise(resolve => setImmediate(resolve));
        expect(firstServer.routes[0].rooms.members('match')).toHaveLength(1);
        expect(secondServer.routes[0].rooms.members('match')).toHaveLength(1);

        const published = nextJson(first);
        const replicated = nextJson(second);
        first.send(JSON.stringify({ type: 'publish', value: { tick: 42 } }));
        expect(await published).toEqual({ published: true });
        expect(await replicated).toEqual({ type: 'state', value: { tick: 42 }, source: 'node-a' });
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(firstServer.routes[0].distribution.seen.size).toBe(0);
        expect(secondServer.routes[0].distribution.seen.size).toBe(1);
    });

    test('becomes unready, rejects new upgrades, and lets tracked handlers finish cooperatively', async () => {
        let handlerStarted;
        const started = new Promise(resolve => { handlerStarted = resolve; });
        class CooperativeHandler extends BaseHandler {
            constructor() { super('work'); }
            async onMessage(socket) {
                handlerStarted();
                if (!socket.context.signal.aborted) {
                    await new Promise(resolve => socket.context.signal.addEventListener('abort', resolve, { once: true }));
                }
                socket.joinRoom('late-room');
                socket.createSession('late-session', { drained: true });
            }
        }
        class DrainingRoute extends SocketRoute {
            constructor() {
                super({
                    path: '/drain',
                    handlers: [CooperativeHandler],
                    allowDuplicateConnections: true,
                    drainHandlers: true,
                    rooms: true,
                    sessions: true,
                    logger: silentLogger,
                });
            }
        }
        const server = await start({ routes: [DrainingRoute] });
        const client = await trackedConnect(address(server, '/drain'));
        const serverSocket = [...server.routes[0].clients.values()][0];
        client.send(JSON.stringify({ type: 'work' }));
        await started;

        expect(server.isReady()).toBe(true);
        expect(server.beginDrain()).toBe(true);
        expect(server.isReady()).toBe(false);
        expect(await expectConnectionFailure(address(server, '/drain'))).toBe(503);
        const shutdown = server.shutdown();
        await shutdown;
        socketServers.delete(server);
        clients.delete(client);
        expect(server.routes[0].inFlight.size).toBe(0);
        expect(server.routes[0].rooms.size).toBe(0);
        expect(server.routes[0].sessions.size).toBe(0);
        expect(serverSocket.joinRoom('after-shutdown')).toBe(false);
        expect(serverSocket.createSession('after-shutdown', {})).toBe(false);
    });

    test('bounds shutdown when a handler ignores its drain signal', async () => {
        let startedHandler;
        const started = new Promise(resolve => { startedHandler = resolve; });
        class StuckHandler extends BaseHandler {
            constructor() { super('stuck'); }
            onMessage() {
                startedHandler();
                return new Promise(() => {});
            }
        }
        class StuckRoute extends SocketRoute {
            constructor() {
                super({
                    path: '/stuck',
                    handlers: [StuckHandler],
                    allowDuplicateConnections: true,
                    drainHandlers: true,
                    shutdownTimeoutMs: 30,
                    logger: silentLogger,
                });
            }
        }
        const server = await start({ routes: [StuckRoute] });
        const client = await trackedConnect(address(server, '/stuck'));
        client.send(JSON.stringify({ type: 'stuck' }));
        await started;
        const startedAt = Date.now();
        await expect(server.shutdown()).rejects.toMatchObject({
            message: 'One or more WebSocket server cleanup operations failed.',
        });
        expect(Date.now() - startedAt).toBeLessThan(500);
        expect(server.routes[0].inFlight.size).toBe(0);
        socketServers.delete(server);
        clients.delete(client);
    });

    test('negotiates an opt-in protocol and exchanges stable text and binary envelopes', async () => {
        class ProtocolHandler extends BaseHandler {
            constructor() { super('move'); }
            async onMessage(socket, message) {
                if (message.payload.binary) {
                    await socket.sendBinaryEvent({
                        v: socket.context.protocol.version,
                        type: 'state',
                        payload: { x: message.payload.x },
                        requestId: message.requestId,
                    });
                    return;
                }
                socket.sendEvent('state', { x: message.payload.x }, {
                    requestId: message.requestId,
                    sequence: message.sequence,
                });
            }
        }
        const binary = {
            maxBytes: 1024,
            encode: value => Buffer.from(JSON.stringify(value)),
            decode: buffer => JSON.parse(buffer.toString()),
        };
        class ProtocolRoute extends SocketRoute {
            constructor() {
                super({
                    path: '/protocol',
                    handlers: [ProtocolHandler],
                    allowDuplicateConnections: true,
                    logger: silentLogger,
                    protocol: { versions: ['2', '1'], binary },
                });
            }
        }
        const server = await start({ routes: [ProtocolRoute] });

        const rejected = await websocketUpgradeResponse(address(server, '/protocol'));
        expect({ status: rejected.status, versions: rejected.headers['redweb-versions'] })
            .toEqual({ status: 426, versions: '2, 1' });
        expect(await expectConnectionFailure(address(server, '/protocol?redwebVersion=3'))).toBe(426);

        const client = await trackedConnect(address(server, '/protocol?redwebVersion=1'));
        client.send(JSON.stringify({ v: '1', type: 'move', payload: { x: 7 }, requestId: 'r1', sequence: 4 }));
        expect(await nextJson(client)).toEqual({
            v: '1', type: 'state', payload: { x: 7 }, requestId: 'r1', sequence: 4,
        });

        client.send(JSON.stringify({ v: '1', type: 'missing', payload: {}, requestId: 'r2' }));
        expect(await nextJson(client)).toEqual({
            v: '1', type: 'error', error: { code: 'UNKNOWN_HANDLER', message: 'No such handler missing' }, requestId: 'r2',
        });
        await waitForClose(client);
        clients.delete(client);

        const binaryClient = await trackedConnect(address(server, '/protocol?redwebVersion=2'));
        const binaryReply = nextMessage(binaryClient);
        binaryClient.send(Buffer.from(JSON.stringify({
            v: '2', type: 'move', payload: { x: 9, binary: true }, requestId: 'binary-1',
        })));
        const reply = await binaryReply;
        expect(reply.isBinary).toBe(true);
        expect(JSON.parse(reply.data.toString())).toEqual({
            v: '2', type: 'state', payload: { x: 9 }, requestId: 'binary-1',
        });
    });

    test('supports TLS WebSockets with real certificates', async () => {
        const server = await start({
            ssl: { key: fixture('localhost.key'), cert: fixture('localhost.crt') },
        }, SecureSocketServer);
        const client = await trackedConnect(address(server, '/', true), { rejectUnauthorized: false });
        client.send(JSON.stringify({ type: 'DefaultHandler', secure: true }));
        expect((await nextJson(client)).message).toContain('"secure":true');
    });

    test('applies real ws options during the handshake and payload processing', async () => {
        class NoopHandler extends BaseHandler {
            constructor() { super('noop'); }
            onMessage() {}
        }
        class GuardedRoute extends SocketRoute {
            constructor() {
                super({
                    path: '/guarded',
                    handlers: [NoopHandler],
                    logger: silentLogger,
                    websocketOptions: {
                        maxPayload: 8,
                        verifyClient: info => info.req.headers.authorization === 'Bearer allowed',
                    },
                });
            }
        }
        const server = await start({ routes: [GuardedRoute] });
        const deniedStatus = await expectConnectionFailure(address(server, '/guarded'));
        expect(deniedStatus).toBe(401);

        const client = await trackedConnect(address(server, '/guarded'), { headers: { authorization: 'Bearer allowed' } });
        const closed = waitForClose(client);
        client.send('0123456789');
        expect((await closed).code).toBe(1009);
        clients.delete(client);
    });
});
