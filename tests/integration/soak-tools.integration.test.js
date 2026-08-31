'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('ws');
const { SoakClients } = require('../../scripts/lib/SoakClients');
const { waitFor } = require('../../scripts/realtime-harness');
const { waitForCondition, withTimeout } = require('../helpers/network');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');

async function withPeers(exercise, accept = () => true) {
    let connections = 0, clients;
    const failures = [];
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1', verifyClient: (_info, done) => done(accept(++connections), 503) });
    try {
        await waitFor(server, 'listening');
        clients = new SoakClients(`ws://127.0.0.1:${server.address().port}`, 2, () => {});
        await exercise(clients, server);
    } catch (error) { failures.push(error); }
    try { await clients?.closeAll(); } catch (error) { failures.push(error); }
    for (const peer of server.clients) peer.terminate();
    try { await withTimeout(new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())), 'soak peer shutdown', 5000); }
    catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'Native soak fixture failed', { cause: failures[0] });
}

test('native soak clients match ticks, rotate and close every owned socket', () => withPeers(async (clients, server) => {
    server.on('connection', peer => peer.on('message', raw => peer.send(JSON.stringify({ tick: JSON.parse(String(raw)).tick }))));
    await clients.openInitial();
    clients.sendTick(0);
    await waitForCondition(() => clients.received === 2, 'initial exact soak replies');
    await clients.rotate(0, () => false);
    clients.sendTick(1);
    await waitForCondition(() => clients.received === 4, 'rotated exact soak replies');
    expect(clients.sent).toBe(4); expect(clients.generations).toEqual([1, 0]); clients.check();
    const sockets = [...clients.records].map(record => record.socket);
    await clients.closeAll(); await clients.closeAll();
    expect(sockets.every(socket => socket.readyState === socket.CLOSED)).toBe(true);
    expect(clients.records.size).toBe(0);
}), 80000);

test.each(['malformed', 'duplicate', 'unsent', 'server-error', 'disconnect'])
('native soak rejects %s instead of counting arbitrary frames or fewer clients', mode => withPeers(async (clients, server) => {
    server.on('connection', peer => peer.on('message', raw => {
        const { tick } = JSON.parse(String(raw));
        if (mode === 'disconnect') peer.close();
        else if (mode === 'malformed') peer.send('{');
        else if (mode === 'server-error') peer.send(JSON.stringify({ type: 'error' }));
        else {
            peer.send(JSON.stringify({ tick: mode === 'unsent' ? tick + 1 : tick }));
            if (mode === 'duplicate') peer.send(JSON.stringify({ tick }));
        }
    }));
    await clients.openInitial(); clients.sendTick(0);
    await waitForCondition(() => clients.failure !== null, 'latched native soak failure');
    expect(() => clients.check()).toThrow(clients.failure);
    expect(clients.received).toBeLessThanOrEqual(clients.sent);
}), 40000);

test.each(['partial-acquisition', 'rotation'])('native %s failure retains sockets for complete cleanup', mode => withPeers(async clients => {
    if (mode === 'partial-acquisition') await expect(clients.openInitial()).rejects.toThrow();
    else { await clients.openInitial(); await expect(clients.rotate(0, () => false)).rejects.toThrow(); }
    const sockets = [...clients.records].map(record => record.socket);
    expect(sockets.length).toBeGreaterThan(0);
    await clients.closeAll();
    expect(sockets.every(socket => socket.readyState === socket.CLOSED)).toBe(true);
    expect(clients.records.size).toBe(0);
}, attempt => mode === 'partial-acquisition' ? attempt !== 2 : attempt <= 2), 55000);

test('native soak command rejects vacuous sampling and reports actual short-run evidence', () => new VerificationWorkspace().run(async owner => {
    const script = path.resolve(__dirname, '../../scripts/verify-soak.js');
    const environment = { REDWEB_SOAK_SECONDS: '10', REDWEB_SOAK_CLIENTS: '2', REDWEB_SOAK_SAMPLE_SECONDS: '1' };
    await expect(owner.command([script], { environment, timeoutMs: 10000 })).rejects.toThrow('--expose-gc');
    await expect(owner.command(['--expose-gc', script], { environment: { ...environment, REDWEB_SOAK_SAMPLE_SECONDS: '20' }, timeoutMs: 10000 })).rejects.toThrow('two active-phase');
    const destination = path.join(owner.directory, 'soak.json');
    const output = await owner.command(['--expose-gc', script, destination], { environment, timeoutMs: 45000, rejectTruncatedOutput: true });
    expect(fs.readFileSync(destination, 'utf8')).toBe(output);
    const result = JSON.parse(output);
    expect(result.samples).toBeGreaterThanOrEqual(4);
    expect(result.messagesSent).toBeGreaterThan(0);
    expect(result.messagesMissing).toBe(result.messagesSent - result.messagesReceived);
    expect(result.deliveryPercent).toBeGreaterThanOrEqual(99);
    expect(result.deliveryPercent).toBeLessThanOrEqual(100);
    expect(Object.values(result.trends).every(trend => trend.passed)).toBe(true);
    expect(result.finalRegistries).toEqual({ clients: 0, rooms: 0, sessions: 0, inFlight: 0 });
}), 110000);
