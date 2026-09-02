'use strict';

const http = require('node:http');
const WebSocket = require('ws');
const { RedwebClient } = require('redweb-client');
const { defineApp, page, SocketRoute, BaseHandler } = require('../..');
const { request, waitForOpen, nextMessage, closeWebSocket, waitForListening, websocketUpgradeStatus, withTimeout, waitForClose } = require('../helpers/network');

class Home { render() { return '<h1>Home</h1>'; } }
class About { render() { return '<h1>About</h1>'; } }
page('/')(Home);
page('/about', { live: false })(About);
class Join extends BaseHandler {
    constructor() { super('join'); }
    onMessage(socket) { socket.sendJson({ type: 'joined' }); }
}
class Move extends BaseHandler {
    constructor() { super('move'); }
    onMessage(socket) { socket.sendJson({ type: 'moved' }); }
}
class Match extends SocketRoute {
    constructor() { super({ path: '/match', handlers: [Join, Move] }); }
}
const config = { port: 0, bind: '127.0.0.1', logger: null, signals: false };

test('unified app exposes live-page revocation and opt-in metadata inspection', async () => {
    const app = defineApp({ ...config, pages: [Home], authenticate: () => 'alice',
        origins: (origin, request) => origin === `http://${request.headers.host}`, development: { inspect: true } });
    expect(app.inspect()).toBeNull();
    expect(await app.revoke('alice')).toBe(0);
    try {
        await app.run();
        const port = app.server.address().port;
        const response = await request({ port });
        expect(response.status).toBe(200);
        const live = JSON.parse(response.body.match(/id="__redweb_page">([^<]+)/)[1]);
        expect(app.inspect()).not.toBeNull();
        expect(await app.revoke('alice')).toBe(1);
        expect(await app.revoke('alice')).toBe(0);
        expect(await websocketUpgradeStatus(`ws://127.0.0.1:${port}${live.socketPath}?pageId=${live.pageId}`,
            { headers: { Origin: `http://127.0.0.1:${port}` } })).not.toBe(101);
    } finally { await app.shutdown(); }
});

test('one listener serves multiple pages, live updates and independent message handlers', async () => {
    const events = [];
    class Simulation {
        async onInit(app, signal) {
            expect(app.server.listening).toBe(false);
            expect(signal.aborted).toBe(false);
            app.app.get('/health', (_req, res) => res.json({ ready: true }));
            events.push('init');
        }
        async onShutdown() { events.push('shutdown'); }
    }
    const app = defineApp({ ...config, pages: [Home, About], sockets: [Match], services: [Simulation] });
    expect(events).toEqual([]);
    expect(app.server).toBeNull();
    const peers = [];
    const livePeers = [];
    try {
        const running = app.run();
        expect(app.run()).toBe(running);
        expect(await running).toBe(app);
        const port = app.server.address().port;
        expect(app.server.listenerCount('upgrade')).toBe(1);
        const home = await request({ port });
        expect(home.body).toContain('<h1>Home</h1>');
        expect((await request({ port, path: '/about' })).body).toContain('<h1>About</h1>');
        expect(JSON.parse((await request({ port, path: '/health' })).body)).toEqual({ ready: true });
        const live = JSON.parse(home.body.match(/id="__redweb_page">([^<]+)/)[1]);
        const pagePeer = new RedwebClient(`ws://127.0.0.1:${port}${live.socketPath}?pageId=${live.pageId}`, {
            version: live.version,
            webSocketFactory: url => new WebSocket(url, { origin: `http://127.0.0.1:${port}` }),
        });
        livePeers.push(pagePeer);
        await pagePeer.connect();
        const match = new WebSocket(`ws://127.0.0.1:${port}/match`);
        peers.push(match);
        await waitForOpen(match);
        for (const [type, expected] of [['join', 'joined'], ['move', 'moved']]) {
            const reply = nextMessage(match);
            match.send(JSON.stringify({ type }));
            expect(JSON.parse((await reply).data.toString()).type).toBe(expected);
        }
        expect(await websocketUpgradeStatus(`ws://127.0.0.1:${port}/missing`)).not.toBe(101);
    } finally {
        for (const peer of livePeers) peer.close();
        for (const peer of peers) await closeWebSocket(peer);
        const closing = app.shutdown();
        expect(app.shutdown()).toBe(closing);
        await closing;
    }
    expect(events).toEqual(['init', 'shutdown']);
    expect(app.server.listening).toBe(false);
    await expect(app.run()).rejects.toThrow('cannot run after shutdown');
});

test.each([
    ['http', [], []], ['socket', [Match], []], ['static-page', [], [About]],
    ['static-page-and-socket', [Match], [About]],
])('%s definitions run without a second listener', async (_kind, sockets, pages) => {
    const app = defineApp({ ...config, sockets, pages,
        httpServices: [{ serviceName: '/health', method: 'get', function: (_req, res) => res.send('healthy') }] });
    try {
        await app.run();
        expect(app.server.listenerCount('upgrade')).toBe(sockets.length ? 1 : 0);
        expect((await request({ port: app.server.address().port, path: '/health' })).body).toBe('healthy');
        if (pages.length) expect((await request({ port: app.server.address().port, path: '/about' })).body).toContain('<h1>About</h1>');
        if (sockets.length) expect(await websocketUpgradeStatus(`ws://127.0.0.1:${app.server.address().port}/match`)).toBe(101);
    } finally { await app.shutdown(); }
});

test('HTTPS and WSS share the same TLS listener', async () => {
    const path = require('node:path');
    const app = defineApp({ ...config, sockets: [Match],
        ssl: { key: path.join(__dirname, '../fixtures/localhost.key'), cert: path.join(__dirname, '../fixtures/localhost.crt') },
        httpServices: [{ serviceName: '/health', method: 'get', function: (_req, res) => res.send('secure') }] });
    let peer;
    try {
        await app.run();
        const port = app.server.address().port;
        expect((await request({ protocol: 'https:', port, path: '/health' })).body).toBe('secure');
        peer = new WebSocket(`wss://127.0.0.1:${port}/match`, { rejectUnauthorized: false });
        await waitForOpen(peer);
        const reply = nextMessage(peer);
        peer.send(JSON.stringify({ type: 'join' }));
        expect(JSON.parse((await reply).data.toString())).toEqual({ type: 'joined' });
        expect(app.server.listenerCount('upgrade')).toBe(1);
    } finally {
        if (peer) await closeWebSocket(peer);
        await app.shutdown();
    }
});

test('occupied-port failure unwinds initialized services in reverse order', async () => {
    const occupied = http.createServer();
    occupied.listen(0, '127.0.0.1');
    await waitForListening(occupied);
    const events = [];
    class First { onInit() { events.push('first'); } onShutdown() { events.push('close-first'); } }
    class Second { onInit() { events.push('second'); } onShutdown() { events.push('close-second'); } }
    const app = defineApp({ ...config, port: occupied.address().port, services: [First, Second] });
    try {
        await expect(app.run()).rejects.toMatchObject({ code: 'EADDRINUSE' });
        expect(events).toEqual(['first', 'second', 'close-second', 'close-first']);
        expect(app.server.listening).toBe(false);
        await app.shutdown();
    } finally { await new Promise(resolve => occupied.close(resolve)); }
});

test('failed service initialization closes that service and already-created routes', async () => {
    const events = [];
    class Fails { async onInit() { throw new Error('initialization failed'); } onShutdown() { events.push('closed'); } }
    const app = defineApp({ ...config, pages: [Home], sockets: [Match], services: [Fails] });
    await expect(app.run()).rejects.toThrow('initialization failed');
    expect(events).toEqual(['closed']);
    expect(app.server.listening).toBe(false);
    expect(app.server.listenerCount('upgrade')).toBe(0);
});

test('shutdown during initialization cancels binding and cleans the partial service', async () => {
    let initialized, finish;
    const entered = new Promise(resolve => { initialized = resolve; });
    class Pending {
        async onInit() { initialized(); await new Promise(resolve => { finish = resolve; }); }
        onShutdown() {}
    }
    const app = defineApp({ ...config, services: [Pending] });
    const started = app.run();
    const rejected = expect(started).rejects.toThrow('cancelled');
    await entered;
    const closing = app.shutdown();
    finish();
    await rejected;
    await closing;
    expect(app.server.listening).toBe(false);
});

test.each(['route-constructor', 'route-collision', 'later-page', 'http-options'])
('startup rollback disposes shared pages after %s failure', async mode => {
    let created = 0, disposed = 0;
    class Shared {
        constructor() { created++; }
        render() { return '<h1>Shared</h1>'; }
        async disposed() { await Promise.resolve(); disposed++; }
    }
    page('/', { shared: true })(Shared);
    class Fails { constructor() { throw new Error('route construction failed'); } }
    class Collision extends SocketRoute {
        constructor() { super({ path: '/__redweb/live', handlers: [Join] }); }
    }
    const app = defineApp({ ...config,
        pages: mode === 'later-page' ? [Shared, class Undecorated {}] : [Shared],
        sockets: mode === 'route-constructor' ? [Fails] : mode === 'route-collision' ? [Collision] : [],
        ...(mode === 'http-options' ? { encoding: 'invalid' } : {}),
    });
    await expect(app.run()).rejects.toThrow(mode === 'route-collision' ? 'WebSocket route paths must be unique' : undefined);
    await app.shutdown();
    expect(created).toBe(1);
    expect(disposed).toBe(1);
});

test('a stalled construction rollback still disposes independently owned shared pages', async () => {
    let disposed = 0, release;
    const stalled = new Promise(resolve => { release = resolve; });
    class Shared {
        render() { return '<h1>Shared</h1>'; }
        disposed() { disposed++; }
    }
    page('/', { shared: true })(Shared);
    class Slow extends Match { async shutdown() { await stalled; await super.shutdown(); } }
    class Bad { constructor() { throw new Error('route construction failed'); } }
    const app = defineApp({ ...config, pages: [Shared], sockets: [Slow, Bad], shutdownTimeoutMs: 30 });
    let failure;
    try {
        failure = await app.run().catch(error => error);
        expect(failure.cause.message).toBe('route construction failed');
        expect(failure.errors[1].errors[0].message).toContain('Construction rollback exceeded');
        expect(disposed).toBe(1);
    } finally {
        release();
        await require('../../src/StartupCleanup').awaitStartupCleanup(failure?.cause);
        await app.shutdown();
    }
});

test('one shutdown deadline rejects a stalled route, closes admission and peers, and attempts service cleanup', async () => {
    let release, entered;
    const stalled = new Promise(resolve => { release = resolve; });
    const stopping = new Promise(resolve => { entered = resolve; });
    class Stalled extends Match {
        async shutdown() { entered(); await stalled; await super.shutdown(); }
    }
    let serviceClosed = false;
    class Resource { onInit() {} onShutdown() { serviceClosed = true; } }
    const app = defineApp({ ...config, sockets: [Stalled], services: [Resource], shutdownTimeoutMs: 30 });
    let peer;
    try {
        await app.run();
        peer = new WebSocket(`ws://127.0.0.1:${app.server.address().port}/match`);
        await waitForOpen(peer);
        const closed = waitForClose(peer);
        const result = app.shutdown().catch(error => error);
        await withTimeout(stopping, 'route shutdown entry');
        expect(app.server.listening).toBe(false);
        const error = await withTimeout(result, 'bounded application shutdown', 1000);
        expect(error).toBeInstanceOf(AggregateError);
        expect(error.errors.some(error => error.message.includes('Socket shutdown exceeded'))).toBe(true);
        await closed;
        expect(serviceClosed).toBe(true);
    } finally {
        release();
        if (peer) await closeWebSocket(peer);
        await app.sockets.shutdown();
        await app.shutdown().catch(() => {});
    }
});

test('shutdown cancels a pending initializer without waiting for its startup deadline', async () => {
    let entered, signal, disposed = false;
    const initializing = new Promise(resolve => { entered = resolve; });
    class Pending {
        onInit(_app, input) { signal = input; entered(); return new Promise(() => {}); }
        onShutdown() { disposed = true; }
    }
    const app = defineApp({ ...config, services: [Pending], startupTimeoutMs: 5000, shutdownTimeoutMs: 30 });
    const run = app.run();
    const rejected = expect(run).rejects.toThrow('cancelled');
    await initializing;
    await withTimeout(app.shutdown(), 'cancel pending initialization', 1000);
    await rejected;
    expect(signal.aborted).toBe(true);
    expect(disposed).toBe(true);
    expect(app.server.listening).toBe(false);
});
