const { test } = require('node:test');
const { once } = require('node:events');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { connect } = require('./network.cjs');

test('fixture cleanup does not wait for an uncooperative WebSocket peer', { timeout: 5000 }, async t => {
    const server = new WebSocket.Server({ port: 0, host: '127.0.0.1' });
    let fallback, client;
    let forcedPeerRelease = false;
    t.after(async () => {
        clearTimeout(fallback);
        for (const socket of server.clients) socket.terminate();
        await new Promise(resolve => server.close(resolve));
    });
    server.once('connection', socket => {
        // A real connected peer deliberately stops reading, including close frames.
        socket.pause();
    });
    await once(server, 'listening');
    await t.test('the generated helper owns the client', async child => {
        // Start the fallback at teardown, not during connection establishment.
        child.after(() => {
            fallback = setTimeout(() => {
                forcedPeerRelease = true;
                for (const socket of server.clients) socket.terminate();
            }, 1500);
        });
        const origin = `http://127.0.0.1:${server.address().port}`;
        ({ socket: client } = await connect(child, origin.replace('http:', 'ws:'), origin));
        assert.equal(client.readyState, WebSocket.OPEN);
    });
    assert.equal(client.readyState, WebSocket.CLOSED, 'Cleanup must actually close its owned client');
    assert.equal(forcedPeerRelease, false, 'Client cleanup depended on the peer being forcibly released');
});
