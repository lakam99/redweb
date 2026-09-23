'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const { BaseHandler, HttpServer, LiveHtmlServer, SocketRoute, SocketServer, page, upload } = require('../..');
const {
    closeWebSocket, nextMessage, request, silentLogger, waitForCondition, waitForListening,
    waitForOpen, websocketUpgradeStatus, withTimeout,
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

    test('an HTTP service failure does not disclose its internal exception text', async () => {
        const server = new HttpServer({ port: 0, bind: '127.0.0.1', publicPaths: [],
            services: [{ method: 'get', serviceName: '/failure', function: () => {
                throw new Error('database-password-is-private');
            } }], logger: silentLogger });
        servers.add(server);
        await waitForListening(server.server);
        const response = await request({ port: server.server.address().port, path: '/failure' });
        expect(response.status).toBe(500);
        expect(response.body).not.toContain('database-password-is-private');
    });

    test('a failing HTTP logger cannot turn a service exception into a leaked or stalled response', async () => {
        const server = new HttpServer({ port: 0, bind: '127.0.0.1', publicPaths: [],
            services: [{ method: 'get', serviceName: '/failure', function: () => {
                throw new Error('private-service-detail');
            } }], logger: { error() { throw new Error('private-logger-detail'); } } });
        servers.add(server);
        await waitForListening(server.server);
        const response = await request({ port: server.server.address().port, path: '/failure' });
        expect(response.status).toBe(500);
        expect(response.body).not.toMatch(/private-(?:service|logger)-detail/);
    });

    test('a public asset symlink cannot disclose a file outside the public directory', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-public-boundary-'));
        const publicDir = path.join(root, 'public');
        const privateDir = path.join(root, 'private');
        const privateFile = path.join(privateDir, 'leak.txt');
        const link = path.join(publicDir, 'linked');
        fs.mkdirSync(publicDir);
        fs.mkdirSync(privateDir);
        fs.writeFileSync(privateFile, 'private-asset-marker');
        try {
            fs.symlinkSync(privateDir, link, 'junction');
            const server = new HttpServer({ port: 0, bind: '127.0.0.1', publicPaths: [publicDir], logger: silentLogger });
            servers.add(server);
            await waitForListening(server.server);
            const response = await request({ port: server.server.address().port, path: '/linked/leak.txt' });
            expect(response.status).not.toBe(200);
            expect(response.body).not.toContain('private-asset-marker');
        } finally {
            if (fs.existsSync(link)) {
                if (process.platform === 'win32') fs.rmdirSync(link);
                else fs.unlinkSync(link);
            }
            fs.unlinkSync(privateFile);
            fs.rmdirSync(privateDir);
            fs.rmdirSync(publicDir);
            fs.rmdirSync(root);
        }
    });

    test('an authenticated interactive page cannot be framed by another site', async () => {
        class AccountPage { render() { return '<button>Transfer</button>'; } }
        page('/account', { authorize: context => context.principal === 'owner' })(AccountPage);
        const server = new LiveHtmlServer({ pages: [AccountPage], port: 0, bind: '127.0.0.1',
            authenticate: incoming => incoming.headers.cookie === 'session=owner' ? 'owner' : false,
            logger: silentLogger });
        servers.add(server);
        await waitForListening(server.server);
        const response = await request({ port: server.server.address().port, path: '/account',
            headers: { Cookie: 'session=owner' } });
        expect(response.status).toBe(200);
        const policy = response.headers['content-security-policy'] || '';
        const frameAncestors = /(?:^|;)\s*frame-ancestors\s+(?:'none'|'self')(?:\s|;|$)/i.test(policy);
        const frameOptions = /^(?:deny|sameorigin)$/i.test(response.headers['x-frame-options'] || '');
        expect(frameAncestors || frameOptions).toBe(true);
    });

    test('explicitly revoked protected-room membership cannot send or receive private broadcasts', async () => {
        let allowed = true;
        class Enter extends BaseHandler {
            constructor() { super('enter'); }
            async onMessage(socket) { socket.sendJson({ joined: await socket.enterRoom('private') }); }
        }
        class Broadcast extends BaseHandler {
            constructor() { super('broadcast'); }
            onMessage(socket) { socket.sendJson({ sent: socket.roomBroadcast('private', { secret: 'private-update' }) }); }
        }
        class PrivateRoom extends SocketRoute {
            constructor() {
                super({ path: '/room', handlers: [Enter, Broadcast], allowDuplicateConnections: true,
                    admission: { authenticate: () => 'owner' }, rooms: { authorize: () => allowed }, logger: silentLogger });
            }
        }
        const server = new SocketServer({ routes: [PrivateRoom], port: 0, bind: '127.0.0.1', logger: silentLogger });
        servers.add(server);
        await waitForListening(server.server);
        const socket = new WebSocket(`ws://127.0.0.1:${server.server.address().port}/room`);
        clients.add(socket);
        const messages = [];
        socket.on('message', data => messages.push(JSON.parse(data.toString())));
        await waitForOpen(socket);
        socket.send(JSON.stringify({ type: 'enter' }));
        await waitForCondition(() => messages.some(message => message.joined === true), 'private-room entry');
        allowed = false;
        server.routes[0].rooms.leaveAll([...server.routes[0].clients.values()][0]);
        socket.send(JSON.stringify({ type: 'broadcast' }));
        await waitForCondition(() => messages.some(message => Object.hasOwn(message, 'sent')), 'revoked broadcast result');
        expect(messages.find(message => Object.hasOwn(message, 'sent')).sent).toBe(0);
        expect(messages.some(message => message.secret === 'private-update')).toBe(false);
    });

    test('a second unauthenticated peer on the same address cannot evict an existing connection', async () => {
        const url = await socketServer({ allowDuplicateConnections: false });
        const first = new WebSocket(url);
        clients.add(first);
        await waitForOpen(first);
        const second = new WebSocket(url);
        clients.add(second);
        const outcome = await new Promise(resolve => {
            second.once('open', () => resolve('open'));
            second.once('error', () => resolve('rejected'));
        });
        if (outcome === 'open') {
            const reply = nextMessage(second);
            second.send(JSON.stringify({ type: 'ping' }));
            expect(JSON.parse((await reply).data.toString())).toEqual({ type: 'pong' });
        }
        expect(first.readyState).toBe(WebSocket.OPEN);
    });

    test('an uploaded client filename cannot contain a path that escapes the target directory', async () => {
        let receivedName;
        class UploadPage {
            async save(file) {
                receivedName = file.name;
                for await (const _chunk of file.stream) { /* Consume the real request body. */ }
            }
            render() { return '<p>Upload</p>'; }
        }
        page('/upload')(UploadPage);
        upload({ maxBytes: 16, accept: 'text/plain' })(UploadPage.prototype, 'save',
            Object.getOwnPropertyDescriptor(UploadPage.prototype, 'save'));
        const server = new LiveHtmlServer({ pages: [UploadPage], port: 0, bind: '127.0.0.1', logger: silentLogger });
        servers.add(server);
        await waitForListening(server.server);
        const port = server.server.address().port;
        const document = await request({ port, path: '/upload' });
        const config = JSON.parse(document.body.match(/<script[^>]+id="__redweb_page"[^>]*>(.*?)<\/script>/s)[1]);
        const target = `/__redweb/upload?pageId=${config.pageId}&action=save`;
        const response = await request({ port, path: target, method: 'POST', body: 'data',
            headers: { 'Content-Type': 'text/plain', 'X-Redweb-Upload-Name': encodeURIComponent('../../secrets.txt') } });
        expect(response.status).toBe(204);
        expect(receivedName).not.toContain('..');
        expect(receivedName).not.toMatch(/[\\/]/);
    });

    test('an authentication hook returning no identity cannot admit a socket client', async () => {
        let missingIdentity;
        const url = await socketServer({ admission: { authenticate: incoming =>
            incoming.headers.cookie === 'session=owner' ? 'owner' : missingIdentity } });
        for (const value of [undefined, null]) {
            missingIdentity = value;
            expect(await websocketUpgradeStatus(url)).not.toBe(101);
        }
        expect(await websocketUpgradeStatus(url, { headers: { Cookie: 'session=owner' } })).toBe(101);
    });

    test('a socket server with no registered routes does not expose a public echo endpoint', async () => {
        const server = new SocketServer({ routes: [], port: 0, bind: '127.0.0.1', logger: silentLogger });
        servers.add(server);
        await waitForListening(server.server);
        expect(await websocketUpgradeStatus(`ws://127.0.0.1:${server.server.address().port}/`)).not.toBe(101);
    });

    test('a rejecting async HTTP service returns a safe error without terminating its server', async () => {
        const script = `
            const { HttpServer } = require(process.argv[1]);
            const server = new HttpServer({ port: 0, bind: '127.0.0.1', publicPaths: [],
                services: [{ method: 'get', serviceName: '/failure', function: async () => {
                    throw new Error('async-service-private-error');
                } }], logger: { log() {}, warn() {}, error() {} } });
            server.server.on('listening', () => process.stdout.write('PORT:' + server.server.address().port + '\\n'));
        `;
        const child = spawn(process.execPath, ['--unhandled-rejections=strict', '-e', script, path.join(__dirname, '..', '..')],
            { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        let stdout = '';
        try {
            const port = await withTimeout(new Promise((resolve, reject) => {
                child.stdout.on('data', chunk => {
                    stdout += chunk.toString();
                    const match = /PORT:(\d+)/.exec(stdout);
                    if (match) resolve(Number(match[1]));
                });
                child.once('error', reject);
                child.once('exit', code => reject(new Error(`HTTP child exited before listening: ${code}`)));
            }), 'disposable HTTP server', 5000);
            const response = await request({ port, path: '/failure' }).catch(error => ({ transportError: error.code }));
            expect(response.status).toBe(500);
            expect(response.body).not.toContain('async-service-private-error');
            expect(child.exitCode).toBeNull();
        } finally {
            if (child.exitCode === null) {
                const stopped = new Promise(resolve => child.once('exit', resolve));
                child.kill();
                await withTimeout(stopped, 'disposable HTTP server shutdown', 5000);
            }
        }
    });
});
