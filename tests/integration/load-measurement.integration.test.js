'use strict';

const path = require('node:path');
const { once } = require('node:events');
const { WebSocketServer } = require('ws');
const { openClient, closeClient } = require('../../scripts/realtime-harness');
const { LoadMeasurement } = require('../../scripts/lib/LoadMeasurement');
const { measureLoadTraffic } = require('../../scripts/lib/measureLoadTraffic');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { withTimeout } = require('../helpers/network');

async function withPeers(respond, exercise) {
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    const peers = [], clients = [];
    const failures = [];
    let result;
    server.on('connection', peer => {
        const index = peers.length; peers.push(peer);
        peer.on('message', raw => respond(peer, JSON.parse(String(raw)), index));
    });
    try {
        await once(server, 'listening');
        for (let index = 0; index < 2; index++) clients.push(await openClient(`ws://127.0.0.1:${server.address().port}`));
        result = await exercise(clients, peers);
    } catch (error) { failures.push(error); }
    const closed = await Promise.allSettled(clients.map(closeClient));
    for (const outcome of closed) if (outcome.status === 'rejected') failures.push(outcome.reason);
    for (const peer of peers) {
        try { peer.terminate(); } catch (error) { failures.push(error); }
    }
    try { await withTimeout(new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())), 'load fixture close', 5000); }
    catch (error) { failures.push(error); }
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, 'Load fixture and cleanup failed', { cause: failures[0] });
    return result;
}

const configuration = { REDWEB_LOAD_CLIENTS: '2', REDWEB_LOAD_MESSAGES: '2' };
const echo = (peer, message) => peer.send(JSON.stringify({ id: message.id }));

test('real traffic accounts for every client and removes only its own listeners', () => withPeers(echo, async clients => {
    const external = () => {};
    clients[0].on('message', external);
    const result = await measureLoadTraffic(clients, new LoadMeasurement(configuration), async () => clients.every(client => client.readyState === client.OPEN));
    expect(result.clients).toBe(2); expect(result.messages).toBe(4);
    expect(Number.isFinite(result.p99Ms)).toBe(true);
    expect(Number.isFinite(result.messagesPerSecond)).toBe(true);
    expect(clients[0].listeners('message')).toEqual([external]);
    expect(clients[1].listenerCount('message')).toBe(0);
    expect(clients.every(client => client.listenerCount('error') === 0)).toBe(true);
    clients[0].off('message', external);
}), 25000);

test.each(['malformed', 'unknown', 'duplicate', 'foreign', 'disconnect', 'invalid-frame'])
('real %s replies cannot become successful load evidence', mode => withPeers((peer, message, index) => {
    if (mode === 'malformed') peer.send('{');
    else if (mode === 'unknown') peer.send('{"id":"unknown"}');
    else if (mode === 'foreign') peer.send(JSON.stringify({ id: `${1 - index}:0` }));
    else if (mode === 'disconnect') peer.close();
    else if (mode === 'invalid-frame') peer._socket.write(Buffer.from([0x83, 0])); // Reserved opcode on the real TCP stream.
    else { echo(peer, message); echo(peer, message); }
}, async clients => {
    const measurement = new LoadMeasurement(configuration);
    await expect(measureLoadTraffic(clients, measurement, async () => clients.every(client => client.readyState === client.OPEN))).rejects.toThrow();
    expect(measurement.received).toBeLessThan(measurement.expectedMessages);
    expect(clients.every(client => client.listenerCount('message') === 0)).toBe(true);
}), 25000);

test('a real duplicate during the post-message probe cannot hide behind a resolved promise', () => withPeers(echo, async (clients, peers) => {
    await expect(measureLoadTraffic(clients, new LoadMeasurement(configuration), async () => {
        const received = once(clients[0], 'message');
        peers[0].send('{"id":"0:1"}');
        await received;
        return clients.every(client => client.readyState === client.OPEN);
    })).rejects.toThrow('duplicate');
}), 25000);

test('the unchanged real 30-second response deadline rejects a silent peer and removes listeners', () => withPeers(() => {}, async clients => {
    await expect(measureLoadTraffic(clients, new LoadMeasurement(configuration), async () => clients.every(client => client.readyState === client.OPEN)))
        .rejects.toThrow('load responses timed out');
    expect(clients.every(client => client.listenerCount('message') === 0 && client.listenerCount('error') === 0)).toBe(true);
}), 50000);

test('real load CLI rejects malformed limits and keeps small valid workload results finite', () => new VerificationWorkspace().run(async owner => {
    const script = path.resolve(__dirname, '../../scripts/verify-load.js');
    for (const key of ['REDWEB_LOAD_MAX_P99_MS', 'REDWEB_LOAD_MIN_MPS']) {
        for (const value of ['NaN', 'Infinity', '0', '-1']) {
            await expect(owner.command([script], { timeoutMs: 5000, environment: { ...configuration, [key]: value } })).rejects.toThrow('positive and finite');
        }
    }
    const output = await owner.command([script], { timeoutMs: 65000, environment: { ...configuration,
        REDWEB_LOAD_MAX_P99_MS: '1000000', REDWEB_LOAD_MIN_MPS: '0.001' } });
    const result = JSON.parse(output);
    expect(result.messages).toBe(4);
    expect(result.slowConsumerContained).toBe(true);
    expect(Number.isFinite(result.p99Ms)).toBe(true);
    expect(Number.isFinite(result.messagesPerSecond)).toBe(true);
}), 135000); // Eight rejected commands plus the unchanged response and cleanup budgets.
