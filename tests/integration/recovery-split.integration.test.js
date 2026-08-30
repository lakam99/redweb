'use strict';

const { DiagnosticProcess } = require('../../scripts/diagnostics/recovery-split.cjs');
const { WebSocketServer } = require('ws');
const { waitFor } = require('../../scripts/realtime-harness');
const net = require('node:net');
const { withTimeout } = require('../helpers/network');
const worker = role => new DiagnosticProcess(role, { coverageDirectory: process.env.NODE_V8_COVERAGE });

async function disconnect(child) {
    try {
        if (child.child.connected) child.child.disconnect();
        await withTimeout(child.closed, 'graceful diagnostic test exit', 5000);
    } finally { await child.close(); }
}

async function assertPortReusable(port) {
    const probe = net.createServer();
    probe.listen(port, '127.0.0.1');
    await waitFor(probe, 'listening');
    await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
}

test('isolated native clients exercise Redweb rooms/sessions and leave no listener', async () => {
    const server = worker('server');
    const client = worker('client');
    let port;
    try {
        const { url } = await server.request('start');
        port = Number(new URL(url).port);
        expect(await client.request('batch', { url, start: 0, count: 50 })).toEqual({ sent: 50, received: 50, clients: 0 });
        expect(await server.request('barrier')).toEqual({ received: 50 });
        const [left, right] = await Promise.all([server.request('sample'), client.request('sample')]);
        expect(new Set([process.pid, left.pid, right.pid]).size).toBe(3);
        expect(left.registries).toEqual({ clients: 0, rooms: 0, sessions: 0 });
        expect(right.registries).toEqual({ clients: 0 });
        for (const sample of [left, right]) {
            expect(sample.received).toBe(50);
            expect(sample.memory.heapUsed).toBeGreaterThan(0);
            expect(sample.code.code_and_metadata_size).toBeGreaterThan(0);
            expect(sample.spaces.length).toBeGreaterThan(0);
            expect(sample.execArgv).toEqual(['--expose-gc']);
        }
        expect(await server.request('stop')).toEqual({ stopped: true });
        expect(await client.request('stop')).toEqual({ stopped: true });
    } finally {
        // Graceful IPC exit also lets native V8 test coverage flush. Forced
        // process-tree cleanup is exercised separately below.
        await Promise.all([disconnect(server), disconnect(client)]);
    }
    await assertPortReusable(port);
}, 30000);

test.each(['wrong reply', 'unreachable'])('rejects %s without successful-delivery evidence', async mode => {
    const native = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await waitFor(native, 'listening');
    const url = `ws://127.0.0.1:${native.address().port}`;
    native.on('connection', socket => socket.on('message', () => socket.send('{"ready":-1}')));
    if (mode === 'unreachable') await new Promise(resolve => native.close(resolve));
    const client = worker('client');
    try {
        await expect(client.request('batch', { url, start: 0, count: 2 })).rejects.toThrow();
        // Poisoned channels cannot turn a late response into subsequent evidence.
        await expect(client.request('sample')).rejects.toThrow();
    } finally {
        await disconnect(client);
        for (const peer of native.clients) peer.terminate();
        if (mode !== 'unreachable') await new Promise(resolve => native.close(resolve));
    }
}, 20000);

test('timeout rejects pending work and forced cleanup closes the real listener', async () => {
    const server = worker('server');
    let port;
    try {
        const { url } = await server.request('start');
        port = Number(new URL(url).port);
        const pending = server.request('sample', {}, 1);
        await expect(server.request('sample')).rejects.toThrow('sequential');
        await expect(pending).rejects.toThrow('timed out');
        await expect(server.request('sample')).rejects.toThrow('timed out');
    } finally { await server.close(); }
    expect(server.child.exitCode !== null || server.child.signalCode !== null).toBe(true);
    expect(server.child.listenerCount('message')).toBe(0);
    await assertPortReusable(port);
});

test('unexpected worker exit rejects a pending command and disconnected requests', async () => {
    const client = worker('client');
    try {
        // Wait for boot before disconnecting during the fixed settling delay.
        await client.request('stop');
        const pending = client.request('sample');
        client.child.disconnect();
        await expect(pending).rejects.toThrow('exited');
    } finally { await client.close(); }
    const stopped = worker('client');
    await stopped.close();
    await expect(stopped.request('sample')).rejects.toThrow('disconnected');
}, 20000);

test.each([
    ['client', 'unknown', {}, 'Unknown diagnostic command'],
    ['client', 'start', {}, 'AssertionError'],
    ['client', 'batch', { count: 51, start: 0 }, 'AssertionError'],
    ['client', 'batch', { count: 1, start: -1 }, 'AssertionError'],
    ['server', 'batch', {}, 'AssertionError'],
    ['client', 'barrier', {}, 'AssertionError'],
])('validates %s %s commands', async (role, command, data, message) => {
    const child = worker(role);
    try { await expect(child.request(command, data)).rejects.toThrow(message); }
    finally { await disconnect(child); }
});
