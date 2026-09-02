'use strict';

const http = require('node:http');
const WebSocket = require('ws');
const { RedwebClient } = require('redweb-client');
const { defineApp, page, SocketRoute, BaseHandler } = require('../..');
const { request, waitForOpen, nextMessage, closeWebSocket, waitForListening, websocketUpgradeStatus } = require('../helpers/network');

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
});

test.each(['http', 'socket', 'static-page'])('%s-only definitions run without a second listener', async kind => {
    const app = defineApp({ ...config, sockets: kind === 'socket' ? [Match] : [], pages: kind === 'static-page' ? [About] : [],
        httpServices: [{ serviceName: '/health', method: 'get', function: (_req, res) => res.send('healthy') }] });
    try {
        await app.run();
        expect(app.server.listenerCount('upgrade')).toBe(kind === 'socket' ? 1 : 0);
        expect((await request({ port: app.server.address().port, path: '/health' })).body).toBe('healthy');
    } finally { await app.shutdown(); }
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
        constructor() { super({ path: '/__redweb/live', handlers: [] }); }
    }
    const app = defineApp({ ...config,
        pages: mode === 'later-page' ? [Shared, class Undecorated {}] : [Shared],
        sockets: mode === 'route-constructor' ? [Fails] : mode === 'route-collision' ? [Collision] : [],
        ...(mode === 'http-options' ? { encoding: 'invalid' } : {}),
    });
    await expect(app.run()).rejects.toThrow();
    await app.shutdown();
    expect(created).toBe(1);
    expect(disposed).toBe(1);
});
