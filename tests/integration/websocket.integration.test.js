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
