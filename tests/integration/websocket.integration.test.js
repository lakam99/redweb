const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const {
    BaseHandler,
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
    waitForListening,
    waitForOpen,
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
    const socket = new WebSocket(url, options);
    return withTimeout(new Promise((resolve) => {
        socket.once('unexpected-response', (_request, response) => {
            response.resume();
            resolve(response.statusCode);
        });
        socket.once('error', () => resolve('error'));
    }), 'WebSocket connection failure');
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
        const first = await trackedConnect(address(server, '/realtime'));
        expect(await nextJson(first)).toEqual({ type: 'ready' });
        const second = await trackedConnect(address(server, '/realtime'));
        expect(await nextJson(second)).toEqual({ type: 'ready' });

        first.send(JSON.stringify({ type: 'realtime', value: 9 }));
        expect(await nextJson(first)).toEqual({ type: 'ack', value: 9 });
        expect(await nextJson(second)).toEqual({ type: 'peer', value: 9 });

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
        const client = await trackedConnect(address(server, '/initial-failure'));
        expect(await nextJson(client)).toEqual({ error: 'Connection initialization failed' });
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
        const failedOpen = await trackedConnect(address(openServer, '/open-callback'));
        expect(await nextJson(failedOpen)).toEqual({ error: 'Connection initialization failed' });
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
        })).toBe(401);
        expect(await expectConnectionFailure(address(server, '/protected'), {
            headers: { origin: 'https://game.example', authorization: 'Bearer invalid' },
        })).toBe(401);
        expect(initialContacts).toBe(0);

        const client = await trackedConnect(address(server, '/protected'), {
            headers: { origin: 'https://game.example', authorization: 'Bearer valid' },
        });
        const identity = await nextJson(client);
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
        expect(await expectConnectionFailure(address(server, '/timed-admission'))).toBe(401);
        expect(aborted).toBe(true);
        expect(initialContacts).toBe(0);
        expect(server.routes[0].clients.size).toBe(0);
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
        releaseFirst();
        await new Promise(setImmediate);
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
        const first = await trackedConnect(address(server, '/limited'));
        expect(await nextJson(first)).toEqual({ ready: true });
        first.send(JSON.stringify({ type: 'echo', value: 1 }));
        expect(await nextJson(first)).toEqual({ value: 1 });
        first.send(JSON.stringify({ type: 'echo', value: 2 }));
        expect(await nextJson(first)).toEqual({ error: 'Message rate exceeded' });
        expect((await waitForClose(first)).code).toBe(1008);
        clients.delete(first);

        const capacityHolder = await trackedConnect(address(server, '/limited'));
        expect(await nextJson(capacityHolder)).toEqual({ ready: true });
        const rejected = await trackedConnect(address(server, '/limited'));
        expect(await nextJson(rejected)).toEqual({ error: 'Server capacity reached' });
        expect((await waitForClose(rejected)).code).toBe(1013);
        clients.delete(rejected);

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
        expect(server.routes[0].clients.size).toBe(0);
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
