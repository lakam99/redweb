const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { once } = require('node:events');
const WebSocket = require('ws');
const { SocketRoute } = require('redweb');
const { Hello } = require('../dist/app.js');
const { createApp, listen, connect } = require('./network.cjs');

test('an absent PORT binds the documented default or reports that exact port occupied', { timeout: 10000 }, async () => {
    const { spawnSync } = require('node:child_process');
    const env = { ...process.env };
    delete env.PORT;
    const result = spawnSync(process.execPath, ['-e', `
        const assert = require('node:assert/strict');
        const { once } = require('node:events');
        const WebSocket = require('ws');
        const { app } = require('./dist/app.js');
        (async () => {
            let socket;
            try {
                try { await app.run(); }
                catch (error) {
                    assert.equal(error.code, 'EADDRINUSE');
                    assert.equal(error.port, 8181);
                    return; // Never send test traffic to a listener this test does not own.
                }
                assert.equal(app.server.address().port, 8181);
                const response = await fetch('http://127.0.0.1:8181/health', { signal: AbortSignal.timeout(3000) });
                assert.deepEqual(await response.json(), { ok: true });
                socket = new WebSocket('ws://127.0.0.1:8181/chat', { handshakeTimeout: 3000 });
                await once(socket, 'open');
                const reply = once(socket, 'message');
                socket.send(JSON.stringify({ type: 'hello' }));
                assert.equal(JSON.parse((await reply)[0].toString()).type, 'hello');
            } finally { socket?.terminate(); await app.shutdown(); }
        })().catch(error => { console.error(error); process.exitCode = 1; });
    `], { env, encoding: 'utf8', timeout: 7000, windowsHide: true });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stdout + result.stderr);
});

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
        const app = createApp({ port: 0, logger: null, shutdownTimeoutMs: 30 });
        t.after(() => app.shutdown().catch(() => {}));
        await app.run();
        const failure = new Error('Application cleanup failed');
        if (failingRoute) {
            class FailingRoute extends SocketRoute {
                constructor() { super({ path: '/fails', handlers: [Hello] }); }
                async shutdown() { await super.shutdown(); throw failure; }
            }
            app.sockets.addRoute(FailingRoute);
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
        if (failingRoute) await assert.rejects(shutdown, error => error.errors.length === 1 && error.errors[0].errors[0] === failure);
        else await shutdown;
        await closed;
        assert.equal(serverPeer.destroyed, true);
        assert.equal(app.server.listening, false);
        assert.equal(app.server.listenerCount('upgrade'), 0);
    });
}
