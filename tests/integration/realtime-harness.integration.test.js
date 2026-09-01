'use strict';

const net = require('node:net');
const { once, EventEmitter } = require('node:events');
const { WebSocketServer } = require('ws');
const { WebSocket, waitFor, openClient, closeClient, silentLogger } = require('../../scripts/realtime-harness');

test.each([false, true])('real WebSocket close completes before success (unresponsive peer: %s)', async unresponsive => {
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    let client, peer;
    try {
        await once(server, 'listening');
        const connected = once(server, 'connection');
        client = await openClient(`ws://127.0.0.1:${server.address().port}`);
        [peer] = await connected;
        if (unresponsive) peer._socket.pause(); // Cannot read/reply to the close frame.
        await closeClient(client);
        expect(client.readyState).toBe(WebSocket.CLOSED);
        await closeClient(client); // Already-closed real peers are harmless.
    } finally {
        peer?._socket.resume();
        peer?.terminate(); client?.terminate();
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
}, 15000);

test('real failed handshake leaves no retained connecting peer', async () => {
    const peers = new Set();
    const server = net.createServer(peer => {
        peers.add(peer); peer.once('close', () => peers.delete(peer));
        peer.destroy();
    });
    try {
        server.listen(0, '127.0.0.1'); await once(server, 'listening');
        await expect(openClient(`ws://127.0.0.1:${server.address().port}`)).rejects.toThrow();
        await new Promise(resolve => setImmediate(resolve));
        expect(peers.size).toBe(0);
    } finally {
        peers.forEach(peer => peer.destroy());
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
}, 15000);

test('native event waits remove event/error listeners on success, failure and timeout', async () => {
    const emitter = new EventEmitter();
    const success = waitFor(emitter, 'ready');
    emitter.emit('ready', 'first', 2);
    expect(await success).toEqual(['first', 2]);
    const error = new Error('native emitter failure');
    const failure = waitFor(emitter, 'ready');
    emitter.emit('error', error);
    await expect(failure).rejects.toBe(error);
    await expect(waitFor(emitter, 'ready', 10)).rejects.toThrow('Timed out');
    expect(emitter.listenerCount('ready')).toBe(0);
    expect(emitter.listenerCount('error')).toBe(0);
    await closeClient(undefined);
    Object.values(silentLogger).forEach(log => log());
});
