'use strict';

const { once } = require('node:events');
const { defineApp, SocketRoute, BaseHandler, LivePage, page } = require('../..');
const { openRawWebSocket, withTimeout, waitForCondition } = require('../helpers/network');
const { readLiveHtmlPage } = require('../../scripts/lib/readLiveHtmlPage');

test.each([
    { kind: 'socket', closeTimeout: undefined },
    { kind: 'socket', closeTimeout: 100 },
    { kind: 'page', closeTimeout: undefined },
])('native closing deadline releases a $kind peer that withholds TCP FIN (override=$closeTimeout)', async ({ kind, closeTimeout }) => {
    class Noop extends BaseHandler { constructor() { super('noop'); } }
    class Route extends SocketRoute {
        constructor() {
            super({ path: '/closing', handlers: [Noop], logger: null,
                websocketOptions: closeTimeout === undefined ? {} : { closeTimeout } });
        }
    }
    let disposed = false;
    class Home extends LivePage {
        render() { return '<h1>Closing peer</h1>'; }
        disposed() { disposed = true; }
    }
    page('/')(Home);
    const app = defineApp({
        ...(kind === 'page' ? { pages: [Home], sessionTtlMs: 500 } : { sockets: [Route] }),
        port: 0, bind: '127.0.0.1', logger: null, signals: false,
    });
    let peer;
    try {
        await app.run();
        const route = app.sockets.routes[0];
        expect(route.server.options.closeTimeout).toBe(closeTimeout ?? 5000);
        const port = app.server.address().port;
        const config = kind === 'page' ? await readLiveHtmlPage(port) : null;
        peer = await openRawWebSocket(port, config ? `${config.socketPath}?pageId=${config.pageId}&redwebVersion=${config.version}` : '/closing', {
            allowHalfOpen: true, headers: { Origin: `http://127.0.0.1:${port}` },
        });
        peer.on('error', () => {});
        const socket = [...route.clients.values()][0];
        expect(route.clients.size).toBe(1);
        const closed = once(socket, 'close');
        const halfClosed = once(peer, 'end');
        // A valid masked, empty close frame. The real TCP client deliberately
        // leaves its writable side open after receiving the server's FIN.
        peer.write(Buffer.from([0x88, 0x80, 1, 2, 3, 4]));
        await withTimeout(halfClosed, 'server close frame and FIN', 2000);
        expect(peer.writableEnded).toBe(false);
        await withTimeout(closed, 'native close deadline', (closeTimeout ?? 5000) + 2000);
        expect(route.clients.size).toBe(0);
        expect(app.server.listening).toBe(true);
        if (config) await waitForCondition(() => disposed, 'disconnected page disposal');
    } finally {
        peer?.destroy();
        await app.shutdown();
    }
}, 12000);
