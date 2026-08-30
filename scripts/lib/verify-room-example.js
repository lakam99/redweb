'use strict';
const assert = require('assert/strict');
const path = require('path');
const { once } = require('events');
const WebSocket = require('ws');
const { compileConsumer } = require('./compile-consumer');
const { waitForListening, waitForOpen, closeWebSocket, websocketUpgradeStatus } = require('../../tests/helpers/network');

async function verifyRoomExample(packageRoot, workspace) {
    for (const experimentalDecorators of [false, true]) {
        const target = path.join(workspace, `room-${experimentalDecorators ? 'legacy' : 'standard'}`);
        const compiled = compileConsumer(packageRoot, target, path.join(packageRoot, 'docs/snippets/room-access.tsx'), { experimentalDecorators });
        const { createApp } = require(compiled);
        const demo = createApp(0);
        let peer;
        try {
            await waitForListening(demo.app.server);
            const origin = `http://127.0.0.1:${demo.app.server.address().port}`;
            const headers = { authorization: `Bearer ${demo.token}` };
            const http = () => fetch(origin, { headers, signal: AbortSignal.timeout(5000) });
            assert.equal((await fetch(origin, { signal: AbortSignal.timeout(5000) })).status, 401);
            const page = await http();
            assert.equal(page.status, 200); assert.match(await page.text(), /<p>alice<\/p>/);
            const url = `${origin.replace('http:', 'ws:')}/team`;
            assert.equal(await websocketUpgradeStatus(url), 401);
            peer = new WebSocket(url, { headers }); await waitForOpen(peer);
            const response = once(peer, 'message', { signal: AbortSignal.timeout(5000) });
            peer.send(JSON.stringify({ type: 'join' }));
            assert.deepEqual(JSON.parse(String((await response)[0])), { joined: true, principal: 'alice' });
            const notice = once(peer, 'message', { signal: AbortSignal.timeout(5000) });
            assert.equal(demo.team.rooms.broadcast('team', { notice: 'private' }), 1);
            assert.deepEqual(JSON.parse(String((await notice)[0])), { notice: 'private' });
            await demo.revoke();
            assert.equal(demo.team.rooms.broadcast('team', { notice: 'revoked' }), 0);
            assert.equal((await http()).status, 401);
            assert.equal(await websocketUpgradeStatus(url, { headers }), 401);
        } finally { await closeWebSocket(peer); await demo.shutdown(); }
    }
}

module.exports = { verifyRoomExample };
