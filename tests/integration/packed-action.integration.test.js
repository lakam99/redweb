'use strict';

const { WebSocketServer } = require('ws');
const { openClient, closeClient, waitFor } = require('../../scripts/realtime-harness');
const { performProbeAction } = require('../../scripts/lib/performProbeAction');

test.each(['success', 'malformed', 'incorrect', 'close', 'silent'])('packed action with actual websocket peer: %s', async mode => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    const accepted = [], requests = [];
    const failures = [];
    let socket;
    server.on('connection', peer => {
        accepted.push(peer);
        peer.on('message', wire => {
            requests.push(JSON.parse(String(wire)));
            if (mode === 'silent') return;
            if (mode === 'close') return peer.close();
            if (mode === 'malformed') return peer.send('{');
            peer.send(JSON.stringify({ type: 'state' }));
            peer.send(JSON.stringify({ v: 'native', requestId: 'probe', type: 'redweb:result', payload: mode === 'success' }));
        });
    });
    try {
        if (!server.address()) await waitFor(server, 'listening');
        socket = await openClient(`ws://127.0.0.1:${server.address().port}`);
        if (mode === 'success') await expect(performProbeAction(socket, 'native')).resolves.toBeUndefined();
        else await expect(performProbeAction(socket, 'native')).rejects.toThrow();
        expect(requests).toHaveLength(1);
        expect(requests[0].payload.args).toEqual([{ name: 'Packed visitor' }]);
        for (const event of ['message', 'error', 'close']) expect(socket.listenerCount(event)).toBe(0);
    } catch (error) { failures.push(error); }
    for (const cleanup of [() => closeClient(socket), async () => {
        const results = await Promise.allSettled(accepted.map(closeClient));
        for (const result of results) if (result.status === 'rejected') failures.push(result.reason);
    }, () => waitFor(server, 'close', 5000, () => server.close())]) {
        try { await cleanup(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'Packed action fixture failed', { cause: failures[0] });
}, 50000); // Listen/open/action plus every independent bounded close.
