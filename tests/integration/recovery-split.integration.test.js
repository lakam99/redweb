'use strict';

const { DiagnosticProcess, outputRecorder, workerFlags } = require('../../scripts/diagnostics/recovery-split.cjs');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnManaged, stopProcessTree } = require('../../scripts/evaluation/process');
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
        await client.request('sample');
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

test.each(['trace', 'client-jitless'])('real sockets preserve complete output in %s mode', mode =>
    new VerificationWorkspace().run(async workspace => {
        const output = outputRecorder(workspace.directory);
        const options = { mode, output: output.write, coverageDirectory: process.env.NODE_V8_COVERAGE };
        const server = new DiagnosticProcess('server', options);
        const client = new DiagnosticProcess('client', options);
        try {
            const { url } = await server.request('start');
            expect(await client.request('batch', { url, start: 0, count: 50 })).toEqual({ sent: 50, received: 50, clients: 0 });
            expect(await server.request('barrier')).toEqual({ received: 50 });
            for (const [role, child] of [['server', server], ['client', client]]) {
                const sample = await child.request('sample', { phase: 'test' });
                expect(sample.execArgv).toEqual(workerFlags(role, mode));
                expect(Object.values(sample.registries).every(value => value === 0)).toBe(true);
                await child.request('stop');
            }
        } finally { await Promise.all([disconnect(server), disconnect(client)]); }
        for (const [filename, metadata] of Object.entries(output.summary())) {
            const bytes = fs.readFileSync(path.join(workspace.directory, filename));
            expect(metadata).toEqual({ bytes: bytes.length, complete: true,
                sha256: createHash('sha256').update(bytes).digest('hex') });
        }
        const trace = fs.readFileSync(path.join(workspace.directory, 'server.stdout.log'), 'utf8');
        if (mode === 'trace') {
            expect(trace).toContain('[rw-phase test settle-begin]');
            expect(trace).toContain('[rw-phase test sampled heap=');
            expect(trace).toMatch(/Mark-Compact|Scavenge/);
        } else expect(trace).toBe('');
    }), 30000);

test('output limits invalidate a real traced worker and never silently truncate success', () =>
    new VerificationWorkspace().run(async workspace => {
        const output = outputRecorder(workspace.directory, 1);
        const child = new DiagnosticProcess('server', { mode: 'trace', output: output.write });
        try {
            await expect((async () => {
                await child.request('start');
                await child.request('sample', { phase: 'limited' });
            })()).rejects.toThrow('Diagnostic output');
        }
        finally { await expect(child.close()).rejects.toThrow('Diagnostic output'); }
        expect(Object.values(output.summary()).some(log => !log.complete)).toBe(true);
        expect(child.child.exitCode !== null || child.child.signalCode !== null).toBe(true);
    }), 15000);

test('recorder validates limits, preserves exact bytes and refuses to overwrite prior evidence', () =>
    new VerificationWorkspace().run(async workspace => {
        expect(() => outputRecorder(workspace.directory, 0)).toThrow('Invalid output limit');
        const output = outputRecorder(workspace.directory, 4);
        output.write('server', 'stdout', Buffer.from('test'));
        expect(fs.readFileSync(path.join(workspace.directory, 'server.stdout.log'), 'utf8')).toBe('test');
        expect(() => output.write('wrong', 'stdout', Buffer.from('x'))).toThrow('Unknown diagnostic output');
        expect(() => output.write('server', 'stdout', Buffer.from('x'))).toThrow('exceeded');
        expect(() => output.write('server', 'stdout', Buffer.from('x'))).toThrow('already failed');
        expect(output.summary()['server.stdout.log'].complete).toBe(false);
        expect(() => outputRecorder(workspace.directory)).toThrow();
        expect(fs.readFileSync(path.join(workspace.directory, 'server.stdout.log'), 'utf8')).toBe('test');
    }));

test('successful worker stop drains queued stdout before process exit', () =>
    new VerificationWorkspace().run(async workspace => {
        const output = outputRecorder(workspace.directory);
        const size = 8 * 1024 * 1024;
        const workerPath = path.resolve(__dirname, '../../scripts/diagnostics/recovery-split-worker.cjs');
        // Real worker lifecycle plus a fixture producer: queue output before the
        // async stop reply, then have the coordinator disconnect immediately.
        const fixture = `process.argv[2]='client'; require(${JSON.stringify(workerPath)});
            process.on('message', message => {
                if (message.command === 'stop') process.stdout.write(Buffer.alloc(${size}, 120));
            });`;
        const child = spawnManaged(['--expose-gc', '-e', fixture], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
        const closed = Promise.all([
            new Promise(resolve => child.once('exit', resolve)),
            ...[child.stdout, child.stderr].map(stream => new Promise(resolve => stream.once('close', resolve))),
        ]);
        child.stdout.on('data', chunk => output.write('client', 'stdout', chunk));
        child.stderr.on('data', chunk => output.write('client', 'stderr', chunk));
        try {
            const reply = waitFor(child, 'message');
            child.send({ command: 'stop' });
            expect((await reply)[0]).toEqual({ result: { stopped: true } });
            child.disconnect();
            await withTimeout(closed, 'queued output exit', 5000);
            expect(child.exitCode).toBe(0);
            expect(output.summary()['client.stdout.log']).toEqual({ bytes: size, complete: true,
                sha256: createHash('sha256').update(Buffer.alloc(size, 120)).digest('hex') });
        } finally {
            await stopProcessTree(child);
            await withTimeout(closed, 'queued output cleanup', 5000);
        }
    }), 20000);

test('native client code log brackets real traffic without source text or server instrumentation', () =>
    new VerificationWorkspace().run(async workspace => {
        const output = outputRecorder(workspace.directory);
        const options = { mode: 'client-code', output: output.write, coverageDirectory: process.env.NODE_V8_COVERAGE };
        const server = new DiagnosticProcess('server', options);
        const client = new DiagnosticProcess('client', options);
        let port;
        try {
            const { url } = await server.request('start');
            port = Number(new URL(url).port);
            for (const [start, phase] of [[0, 'warm'], [50, 'storm-5']]) {
                expect(await client.request('batch', { url, start, count: 50 })).toEqual({ sent: start + 50, received: start + 50, clients: 0 });
                expect(await server.request('barrier')).toEqual({ received: start + 50 });
                for (const [role, child] of [['server', server], ['client', client]]) {
                    const sample = await child.request('sample', { phase });
                    expect(sample.execArgv).toEqual(workerFlags(role, 'client-code'));
                    expect(Object.values(sample.registries).every(value => value === 0)).toBe(true);
                }
            }
            await Promise.all([server.request('stop'), client.request('stop')]);
        } finally { await Promise.all([disconnect(server), disconnect(client)]); }
        const bytes = fs.readFileSync(path.join(workspace.directory, 'client.stdout.log'));
        expect(output.summary()['client.stdout.log']).toEqual({ bytes: bytes.length, complete: true,
            sha256: createHash('sha256').update(bytes).digest('hex') });
        expect(bytes.toString()).not.toMatch(/^(script-source|code-source-info|code-disassemble|feedback-vector),/m);
        const summarize = () => require('../../scripts/diagnostics/recovery-code-summary.cjs').summarize(bytes.toString());
        if (process.versions.v8 === '12.4.254.21-node.33') {
            const census = summarize();
            expect(census.retainedSizeProven).toBe(false);
            expect(census.totalCreationRecords).toBeGreaterThan(100);
            expect(census.boundaryTimesUs[1]).toBeGreaterThan(census.boundaryTimesUs[0]);
        } else {
            // CI's other supported Node releases still exercise real traffic and
            // capture, but must not silently decode a different V8 enum/schema.
            expect(summarize).toThrow('Unsupported V8 code-log version');
        }
        expect(fs.readFileSync(path.join(workspace.directory, 'server.stdout.log'), 'utf8')).toBe('');
        expect(fs.readdirSync(workspace.directory).sort()).toEqual(['client.stderr.log', 'client.stdout.log', 'server.stderr.log', 'server.stdout.log']);
        await assertPortReusable(port);
    }), 30000);
