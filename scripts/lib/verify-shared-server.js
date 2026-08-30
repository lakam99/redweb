'use strict';

const assert = require('assert/strict');
const path = require('path');
const { once } = require('events');
const { createRequire } = require('module');
const WebSocket = require('ws');

async function verifySharedServer(packageRoot) {
    const load = createRequire(path.join(packageRoot, 'package.json'));
    const { createApp } = load('./docs/snippets/shared-server.cjs');
    const app = createApp(0);
    let socket;
    try {
        if (!app.http.server.listening) await once(app.http.server, 'listening');
        const port = app.http.server.address().port;
        const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(5000) });
        assert.equal(response.status, 200);
        assert.deepEqual(JSON.parse(await response.text()), { ok: true });
        socket = new WebSocket(`ws://127.0.0.1:${port}/chat`, { handshakeTimeout: 5000 });
        await once(socket, 'open');
        const reply = once(socket, 'message', { signal: AbortSignal.timeout(5000) });
        socket.send(JSON.stringify({ type: 'hello' }));
        const [message] = await reply;
        assert.deepEqual(JSON.parse(String(message)), { type: 'hello', message: 'Hello from the server!' });
    } finally {
        if (socket && socket.readyState !== WebSocket.CLOSED) {
            const closed = once(socket, 'close');
            socket.terminate();
            await closed;
        }
        await app.shutdown();
    }
}

module.exports = { verifySharedServer };
