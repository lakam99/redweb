const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { once } = require('node:events');
const WebSocket = require('ws');
const { SocketRoute } = require('redweb');
const { createApp, Hello } = require('../dist/app.js');
const { listen, connect } = require('./network.cjs');

test('HTTP and separate message handlers share one port, with strict socket paths', { timeout: 10000 }, async t => {
    const origin = await listen(t);
    const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal((await fetch(`${origin}/missing`, { signal: AbortSignal.timeout(3000) })).status, 404);
    for (let index = 0; index < 2; index++) {
        const client = await connect(t, `${origin.replace('http:', 'ws:')}/chat`, origin);
        client.send({ type: 'hello' });
        assert.deepEqual(await client.receive(message => message.type === 'hello'),
            { type: 'hello', message: 'Hello from the server!' });
    }
    const unknown = new WebSocket(`${origin.replace('http:', 'ws:')}/missing`, { handshakeTimeout: 3000 });
    t.after(() => unknown.terminate());
    await once(unknown, 'error');
});

for (const failingRoute of [false, true]) {
    test(`shutdown closes incomplete HTTP peers${failingRoute ? ' despite a route failure' : ' idempotently'}`, { timeout: 10000 }, async t => {
        const app = createApp({ port: 0, logger: null });
        t.after(() => app.shutdown().catch(() => {}));
        if (!app.server.listening) await once(app.server, 'listening');
        assert.equal(app.closeServerOnShutdown, true);
        const failure = new Error('Application cleanup failed');
        if (failingRoute) {
            class FailingRoute extends SocketRoute {
                constructor() { super({ path: '/fails', handlers: [Hello] }); }
                async shutdown() { await super.shutdown(); throw failure; }
            }
            app.addRoute(FailingRoute);
        }
        const accepted = once(app.server, 'connection');
        const peer = net.connect(app.server.address().port, '127.0.0.1');
        t.after(() => peer.destroy());
        peer.on('error', () => {});
        await once(peer, 'connect');
        const [serverPeer] = await accepted;
        peer.write('POST /health HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100\r\n\r\nx');
        const closed = once(serverPeer, 'close');
        const shutdown = app.shutdown();
        assert.equal(app.shutdown(), shutdown);
        if (failingRoute) await assert.rejects(shutdown, error => error.errors.length === 1 && error.errors[0] === failure);
        else await shutdown;
        await closed;
        assert.equal(serverPeer.destroyed, true);
        assert.equal(app.server.listening, false);
        assert.equal(app.server.listenerCount('upgrade'), 0);
    });
}
