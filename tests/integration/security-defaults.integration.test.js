'use strict';

const WebSocket = require('ws');
const { BaseHandler, HttpServer, LiveHtmlServer, SocketRoute, SocketServer, page } = require('../..');
const {
    closeWebSocket, request, silentLogger, waitForListening,
    waitForOpen, websocketUpgradeStatus,
} = require('../helpers/network');

// These are security regression gates, not mock-based policy tests. Each request
// crosses a real loopback HTTP listener and (where applicable) a real WS upgrade.
describe('secure defaults over real HTTP and WebSocket connections', () => {
    const servers = new Set();
    const clients = new Set();

    afterEach(async () => {
        await Promise.all([...clients].map(closeWebSocket));
        clients.clear();
        await Promise.all([...servers].map(server => server.shutdown()));
        servers.clear();
    });

    class Ping extends BaseHandler {
        constructor() { super('ping'); }
        onMessage(socket) { socket.sendJson({ type: 'pong' }); }
    }

    async function socketServer(routeOptions = {}) {
        class PingRoute extends SocketRoute {
            constructor() {
                super({ path: '/socket', handlers: [Ping], allowDuplicateConnections: true,
                    logger: silentLogger, ...routeOptions });
            }
        }
        const server = new SocketServer({ routes: [PingRoute], port: 0, bind: '127.0.0.1', logger: silentLogger });
        servers.add(server);
        await waitForListening(server.server);
        return `ws://127.0.0.1:${server.server.address().port}/socket`;
    }

    test('a browser from another origin cannot upgrade a default socket route with ambient cookies', async () => {
        const url = await socketServer();
        const status = await websocketUpgradeStatus(url, {
            headers: { Origin: 'https://foreign.example', Cookie: 'session=owner' },
        });
        expect(status).not.toBe(101);
    });

    test('page authorization also protects raw upgrades to its bound socket route', async () => {
        class PrivateRoute extends SocketRoute {
            constructor() {
                super({ path: '/private', handlers: [Ping], protocol: { versions: ['1'] },
                    allowDuplicateConnections: true, logger: silentLogger });
            }
        }
        class PrivatePage { render() { return '<p>private</p>'; } }
        page('/', { socket: PrivateRoute, authorize: request => request.headers.cookie === 'session=owner' })(PrivatePage);
        const server = new LiveHtmlServer({ pages: [PrivatePage], socketRoutes: [PrivateRoute],
            port: 0, bind: '127.0.0.1', logger: silentLogger });
        servers.add(server);
        await waitForListening(server.server);
        const port = server.server.address().port;
        const status = await websocketUpgradeStatus(`ws://127.0.0.1:${port}/private?redwebVersion=1`, {
            headers: { Origin: `http://127.0.0.1:${port}`, Cookie: 'session=outsider' },
        });
        expect(status).not.toBe(101);
    });

    test('the default socket rejects a message above a conservative one-megabyte frame ceiling', async () => {
        const url = await socketServer();
        const socket = new WebSocket(url);
        clients.add(socket);
        await waitForOpen(socket);
        const outcome = new Promise(resolve => {
            socket.once('message', () => resolve('accepted'));
            socket.once('close', code => resolve(code));
        });
        socket.send(JSON.stringify({ type: 'ping', payload: 'x'.repeat(1024 * 1024) }));
        expect(await outcome).toBe(1009);
    });

    test('default HTTP responses do not grant arbitrary browser origins read access', async () => {
        const server = new HttpServer({ port: 0, bind: '127.0.0.1', publicPaths: [],
            services: [{ method: 'get', serviceName: '/private', function: (_request, response) => response.send('private') }],
            logger: silentLogger });
        servers.add(server);
        await waitForListening(server.server);
        const response = await request({ port: server.server.address().port, path: '/private',
            headers: { Origin: 'https://foreign.example' } });
        expect(response.status).toBe(200);
        expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    test('a cross-site cookie-bearing POST cannot mutate a default HTTP service', async () => {
        let mutations = 0;
        const server = new HttpServer({ port: 0, bind: '127.0.0.1', publicPaths: [],
            services: [{ method: 'post', serviceName: '/change', function: (incoming, response) => {
                if (incoming.headers.cookie === 'session=owner') mutations += 1;
                response.sendStatus(204);
            } }], logger: silentLogger });
        servers.add(server);
        await waitForListening(server.server);
        const response = await request({ port: server.server.address().port, path: '/change', method: 'POST',
            headers: { Origin: 'https://foreign.example', Cookie: 'session=owner',
                'Content-Type': 'text/plain', 'Sec-Fetch-Site': 'cross-site' }, body: 'change' });
        expect(response.status).toBe(403);
        expect(mutations).toBe(0);
    });
});
