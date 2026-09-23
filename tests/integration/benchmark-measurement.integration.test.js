'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { once } = require('node:events');
const { WebSocketServer } = require('ws');
const { openClient, closeClient } = require('../../scripts/realtime-harness');
const { BenchmarkBatch } = require('../../scripts/lib/BenchmarkBatch');
const { BenchmarkComparison } = require('../../scripts/lib/BenchmarkComparison');
const { measureBenchmarkBatch } = require('../../scripts/lib/measureBenchmarkBatch');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { withTimeout } = require('../helpers/network');

async function withPeer(respond, exercise) {
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    const peers = [], failures = [];
    let client, result;
    server.on('connection', peer => {
        peers.push(peer);
        peer.on('message', raw => respond(peer, JSON.parse(String(raw))));
    });
    try {
        await once(server, 'listening');
        client = await openClient(`ws://127.0.0.1:${server.address().port}`);
        result = await exercise(client);
    } catch (error) { failures.push(error); }
    try { await closeClient(client); } catch (error) { failures.push(error); }
    for (const peer of peers) { try { peer.terminate(); } catch (error) { failures.push(error); } }
    try { await withTimeout(new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())), 'benchmark fixture cleanup', 5000); }
    catch (error) { failures.push(error); }
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, 'Benchmark fixture failed', { cause: failures[0] });
    return result;
}

const echo = (peer, message) => peer.send(JSON.stringify({ id: message.id }));

test('real benchmark windows verify warm-up and measured delivery on one socket', () => withPeer(echo, async client => {
    const external = () => {};
    client.on('message', external);
    const warmup = await measureBenchmarkBatch(client, new BenchmarkBatch(8, 3, false));
    const measured = await measureBenchmarkBatch(client, new BenchmarkBatch(12, 3, true, 8));
    expect(warmup).toMatchObject({ sent: 8, received: 8, latencies: [] });
    expect(measured).toMatchObject({ sent: 12, received: 12 });
    expect(measured.latencies).toHaveLength(12);
    expect(measured.latencies.every(value => Number.isFinite(value) && value >= 0)).toBe(true);
    expect(client.listeners('message')).toEqual([external]);
    expect(client.listenerCount('error')).toBe(0); expect(client.listenerCount('close')).toBe(0);
    client.off('message', external);
}), 25000);

test.each([false, true].flatMap(measured => ['unknown', 'duplicate', 'malformed', 'disconnect', 'invalid-frame'].map(mode => [measured, mode])))
('real benchmark replies fail closed (measured=%s, mode=%s)', (measured, mode) => withPeer((peer, message) => {
    if (mode === 'unknown') peer.send('{"id":999}');
    else if (mode === 'malformed') peer.send('{');
    else if (mode === 'disconnect') peer.close();
    else if (mode === 'invalid-frame') peer._socket.write(Buffer.from([0x83, 0]));
    else { echo(peer, message); echo(peer, message); }
}, async client => {
    const batch = new BenchmarkBatch(10, 3, measured, measured ? 200 : 0);
    await expect(measureBenchmarkBatch(client, batch)).rejects.toThrow();
    expect(batch.received).toBeLessThan(10);
    expect(client.listenerCount('message')).toBe(0);
}), 25000);

test('a late real warm-up ID is rejected during the measured phase', () => withPeer((peer, message) => {
    peer.send(JSON.stringify({ id: message.id >= 4 ? 0 : message.id }));
}, async client => {
    await measureBenchmarkBatch(client, new BenchmarkBatch(4, 2, false));
    await expect(measureBenchmarkBatch(client, new BenchmarkBatch(4, 2, true, 4))).rejects.toThrow('reply');
}), 25000);

test.each([false, true])('real silent benchmark peer respects the 30s deadline (measured=%s)', measured => withPeer(() => {}, async client => {
    await expect(measureBenchmarkBatch(client, new BenchmarkBatch(2, 2, measured))).rejects.toThrow('timed out');
    expect(client.listenerCount('message')).toBe(0);
    expect(client.listenerCount('error')).toBe(0);
}), 50000);

test('actual benchmark worker validates counts, exact delivery, identities and normal cleanup', () => new VerificationWorkspace().run(async owner => {
    const worker = path.resolve(__dirname, '../../scripts/benchmark-worker.js');
    const root = path.resolve(__dirname, '../..');
    const policy = new BenchmarkComparison({ REDWEB_BENCHMARK_MESSAGES: '1000', REDWEB_BENCHMARK_CONCURRENCY: '16', REDWEB_BENCHMARK_TRIALS: '3' });
    for (const args of [[], [root, '0', '16'], [root, '1000', 'NaN'], [root, String(Number.MAX_SAFE_INTEGER), '16']]) {
        await expect(owner.command([worker, ...args], { timeoutMs: 5000 })).rejects.toThrow();
    }
    const output = await owner.command([worker, root, '1000', '16'], { timeoutMs: 120000, rejectTruncatedOutput: true });
    const result = policy.decode(output, root);
    expect(result).toMatchObject({ warmupSent: 200, warmupReceived: 200, sent: 1000, received: 1000 });
    expect(result.identity.node).toBe(process.version);
    expect(result.identity.entrySha256).toMatch(/^[a-f0-9]{64}$/);
}), 175000);

test.each(['index.js', 'package.json'])('real mutation of %s after module loading cannot produce benchmark success', changed => new VerificationWorkspace().run(async owner => {
    const root = path.resolve(__dirname, '../..');
    const manifest = path.join(owner.directory, 'package.json');
    const entry = path.join(owner.directory, 'index.js');
    fs.writeFileSync(manifest, JSON.stringify({ name: 'benchmark-owned-fixture', version: '1.0.0', main: 'index.js' }));
    // An actual module uses the real Redweb implementation, then mutates its
    // own owned input file. No server, network or filesystem API is replaced.
    fs.writeFileSync(entry, `module.exports = require(${JSON.stringify(root)});\nrequire('node:fs').appendFileSync(${JSON.stringify(path.join(owner.directory, changed))}, '\\n');\n`);
    await expect(owner.command([path.join(root, 'scripts/benchmark-worker.js'), owner.directory, '1000', '16'], {
        timeoutMs: 120000, environment: { NODE_PATH: path.join(root, 'node_modules') },
    })).rejects.toThrow('changed during measurement');
}), 150000);

test('actual paired benchmark coordinator retains all trials without treating same-tree noise as a performance promise', () => new VerificationWorkspace().run(async owner => {
    const root = path.resolve(__dirname, '../..');
    const environment = { REDWEB_BENCHMARK_MESSAGES: '1000', REDWEB_BENCHMARK_CONCURRENCY: '16', REDWEB_BENCHMARK_TRIALS: '3' };
    const policy = new BenchmarkComparison(environment);
    let output, exitCode = 0;
    try {
        output = await owner.command([path.join(root, 'scripts/verify-disabled-overhead.js'), root], { timeoutMs: 750000, environment, rejectTruncatedOutput: true });
    } catch (error) {
        // A valid same-tree trial can exceed an unchanged performance limit.
        // Only its exact nonzero result envelope is accepted; malformed output,
        // stderr, timeout, launch and cleanup errors still fail this test.
        const prefix = 'Package verification command failed (1): \n';
        if (!error.message.startsWith(prefix)) throw error;
        output = error.message.slice(prefix.length); exitCode = 1;
    }
    const summary = JSON.parse(output);
    expect(summary.trials.baseline).toHaveLength(3);
    expect(summary.trials.candidate).toHaveLength(3);
    for (const values of Object.values(summary.trials)) for (const value of values) {
        expect(policy.decode(JSON.stringify(value), root).received).toBe(1000);
        expect(value.identity.nodePath).toBe(path.join(root, 'node_modules'));
    }
    const recomputed = policy.summarize(summary.trials);
    expect(summary).toMatchObject(recomputed);
    expect(exitCode).toBe(policy.passed(recomputed) ? 0 : 1);
}), 775000); // Six bounded120s workers plus their cleanup and supervisor margin.
