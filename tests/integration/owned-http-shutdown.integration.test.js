'use strict';

const net = require('net');
const http = require('http');
const path = require('path');
const { once } = require('events');
const WebSocket = require('ws');
const { start, page, SocketServer, SocketRoute } = require('../..');
const DefaultHandler = require('../../src/ws/DefaultHandler');
const { request, waitForListening, waitForOpen, waitForCondition, withTimeout, silentLogger } = require('../helpers/network');

class Route extends SocketRoute {
    constructor() { super({ path: '/owned', shutdownTimeoutMs: 25, handlers: [DefaultHandler] }); }
}

test.each([false, true])('Live HTML closes incomplete HTTP peers even when page cleanup succeeds (live=%s)', async live => {
    class Page { render() { return '<p>ready</p>'; } }
    page('/', { live })(Page);
    const app = start(Page, { port: 0, bind: '127.0.0.1', logger: silentLogger, shutdownTimeoutMs: 25 });
    let peer, socket;
    try {
        await waitForListening(app.server);
        const port = app.server.address().port;
        const response = await request({ port });
        expect(response.status).toBe(200);
        let socketClosed;
        if (live) {
            const config = JSON.parse(response.body.match(/id="__redweb_page">([^<]+)/)[1]);
            socket = new WebSocket(`ws://127.0.0.1:${port}${config.socketPath}?pageId=${config.pageId}&redwebVersion=${config.version}`, { origin: `http://127.0.0.1:${port}` });
            socket.on('error', () => {});
            socketClosed = new Promise(resolve => socket.once('close', resolve));
            await waitForOpen(socket);
        }
        const accepted = once(app.server, 'connection');
        peer = net.connect({ host: '127.0.0.1', port });
        peer.on('error', () => {});
        const [connection] = await accepted;
        connection.on('error', () => {});
        const received = once(connection, 'data');
        peer.write('POST /incomplete HTTP/1.1\r\nHost: localhost\r\nContent-Length: 1000\r\n\r\nx');
        await received;
        const closed = new Promise(resolve => connection.once('close', resolve));
        const closing = app.shutdown();
        expect(app.shutdown()).toBe(closing);
        await withTimeout(closing, 'incomplete HTTP shutdown', 500);
        await withTimeout(closed, 'owned peer close', 500);
        if (socketClosed) await withTimeout(socketClosed, 'live WebSocket shutdown', 500);
        expect(app.server.listening).toBe(false);
        expect(connection.destroyed).toBe(true);
    } finally {
        peer?.destroy();
        socket?.terminate();
        await app.shutdown();
    }
});

test.each(['html', 'socket'])('an already-closing owned %s listener still destroys retained peers', async kind => {
    class Page { render() { return '<p>ready</p>'; } }
    page('/', { live: false })(Page);
    const options = { port: 0, bind: '127.0.0.1', logger: silentLogger };
    const app = kind === 'html' ? start(Page, { ...options, shutdownTimeoutMs: 25 }) : new SocketServer({ ...options, routes: [Route] });
    let peer;
    try {
        await waitForListening(app.server);
        const accepted = once(app.server, 'connection');
        peer = net.connect({ host: '127.0.0.1', port: app.server.address().port });
        peer.on('error', () => {});
        const [connection] = await accepted;
        connection.on('error', () => {});
        const received = once(connection, 'data');
        peer.write('GET / HTTP/1.1\r\nHost: localhost\r\n');
        await received;
        const closed = new Promise(resolve => connection.once('close', resolve));
        app.server.close();
        expect(app.server.listening).toBe(false);
        await withTimeout(app.shutdown(), 'already-closing listener', 500);
        await withTimeout(closed, 'retained peer', 500);
        await waitForCondition(() => app._ownedServer.connections.size === 0, 'empty owned registry');
        expect(app.server.listeners('connection')).not.toContain(app._ownedServer.onConnection);
    } finally { peer?.destroy(); await app.shutdown(); }
});

test('borrowed listener and incomplete peer survive socket shutdown', async () => {
    const server = http.createServer((_request, response) => response.end('owner alive'));
    server.listen(0, '127.0.0.1');
    await waitForListening(server);
    let peer, app;
    try {
        app = new SocketServer({ server, routes: [Route], logger: silentLogger });
        const accepted = once(server, 'connection');
        peer = net.connect({ host: '127.0.0.1', port: server.address().port });
        const [connection] = await accepted;
        connection.on('error', () => {});
        const received = once(connection, 'data');
        peer.write('GET / HTTP/1.1\r\nHost: localhost\r\n');
        await received;
        await app.shutdown();
        expect(app.rawConnections).toBe(null);
        expect(app._ownedServer).toBe(null);
        expect(connection.destroyed).toBe(false);
        expect((await request({ port: server.address().port })).body).toBe('owner alive');
    } finally {
        peer?.destroy();
        await app?.shutdown();
        await new Promise(resolve => server.close(resolve));
    }
});

test.each([false, true])('failed construction removes owned tracking without closing the supplied listener (owns=%s)', async closeServerOnShutdown => {
    const server = http.createServer((_request, response) => response.end('still here'));
    server.listen(0, '127.0.0.1');
    await waitForListening(server);
    const connections = server.listeners('connection');
    const upgrades = server.listeners('upgrade');
    try {
        expect(() => new SocketServer({ server, listen: true, closeServerOnShutdown, routes: [Route], logger: silentLogger })).toThrow('Listen method has been called more than once');
        await waitForCondition(() => server.listenerCount('upgrade') === upgrades.length, 'failed constructor upgrade cleanup');
        expect(server.listeners('connection')).toEqual(connections);
        expect((await request({ port: server.address().port })).body).toBe('still here');
    } finally { await new Promise(resolve => server.close(resolve)); }
});

test('Live HTTPS closes a TCP peer that never completes its TLS handshake', async () => {
    class Page { render() { return '<p>secure</p>'; } }
    page('/', { live: false })(Page);
    const app = start(Page, { port: 0, bind: '127.0.0.1', logger: silentLogger, shutdownTimeoutMs: 25,
        ssl: { key: path.join(__dirname, '../fixtures/localhost.key'), cert: path.join(__dirname, '../fixtures/localhost.crt') } });
    let peer;
    try {
        await waitForListening(app.server);
        const accepted = once(app.server, 'connection');
        peer = net.connect({ host: '127.0.0.1', port: app.server.address().port });
        peer.on('error', () => {});
        const [connection] = await accepted;
        connection.on('error', () => {});
        const closed = new Promise(resolve => connection.once('close', resolve));
        await withTimeout(app.shutdown(), 'incomplete TLS shutdown', 500);
        await withTimeout(closed, 'owned TLS peer close', 500);
        expect(connection.destroyed).toBe(true);
        expect(app.server.listening).toBe(false);
    } finally {
        peer?.destroy();
        await app.shutdown();
    }
});
