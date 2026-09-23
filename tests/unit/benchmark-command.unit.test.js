'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { withTimeout } = require('../helpers/network');
const root = path.resolve(__dirname, '../..');

// Explicit unit subprocess/transport boundaries. Native integration separately
// exercises the actual worker, filesystem mutations, sockets and timeout.
test.each(['default', 'pass', 'over-budget', 'invalid-output', 'command-error', 'cleanup-error', 'usage'])
('benchmark coordinator preserves %s and alternating bounded workers', async outcome => {
    const argv = process.argv, environment = process.env, exitCode = process.exitCode;
    let finish;
    const completed = new Promise(resolve => { finish = resolve; });
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => { finish(); return true; });
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => { finish(); return true; });
    const baseline = path.join(root, 'examples');
    const command = jest.fn(async args => {
        if (outcome === 'command-error') throw new Error('unit command failure');
        const moduleRoot = args[1], messages = Number(args[2]), concurrency = Number(args[3]);
        return JSON.stringify({ messages, concurrency, warmupSent: 2000, warmupReceived: 2000, sent: messages, received: messages,
            throughput: outcome === 'over-budget' && moduleRoot === root ? 50 : 100,
            p99Ms: outcome === 'invalid-output' ? null : 100,
            identity: { moduleRoot, moduleEntry: path.join(moduleRoot, 'index.js'), entrySha256: 'a'.repeat(64), manifestSha256: 'b'.repeat(64),
                moduleVersion: '1.0.0', harnessWebSocketResolution: '/ws', rootWebSocketResolution: '/ws', node: process.version, nodePath: '' } });
    });
    const run = jest.fn(async operation => {
        const result = await operation({ command });
        if (outcome === 'cleanup-error') throw new Error('unit cleanup failure');
        return result;
    });
    try {
        process.argv = [process.execPath, 'verify-disabled-overhead.js', ...(outcome === 'usage' ? [] : [baseline]), ...(outcome === 'pass' ? [root] : [])];
        process.env = outcome === 'default' ? {} : { REDWEB_BENCHMARK_TRIALS: '3' };
        process.exitCode = 0;
        jest.isolateModules(() => {
            jest.doMock('../../scripts/lib/VerificationWorkspace', () => ({ VerificationWorkspace: class { run = run; } }));
            require('../../scripts/verify-disabled-overhead');
        });
        await withTimeout(completed, 'unit benchmark coordinator', 1000);
        expect(process.exitCode).toBe(outcome === 'usage' ? 2 : ['pass', 'default'].includes(outcome) ? 0 : 1);
        if (['pass', 'default', 'over-budget'].includes(outcome)) {
            expect(stderr).not.toHaveBeenCalled();
            const summary = JSON.parse(stdout.mock.calls[0][0]);
            expect(summary.trials.baseline).toHaveLength(outcome === 'default' ? 5 : 3);
        } else expect(stdout).not.toHaveBeenCalled();
        const order = [baseline, root, root, baseline, baseline, root, root, baseline, baseline, root];
        expect(command.mock.calls.map(([args]) => args[1])).toEqual(order.slice(0, command.mock.calls.length));
        for (const [args, options] of command.mock.calls) {
            expect(args.slice(2)).toEqual(['20000', '128']);
            expect(options).toEqual({ timeoutMs: 120000, rejectTruncatedOutput: true, environment: { NODE_PATH: path.join(root, 'node_modules') } });
        }
        if (outcome === 'usage') expect(run).not.toHaveBeenCalled();
    } finally {
        process.argv = argv; process.env = environment; process.exitCode = exitCode;
        stdout.mockRestore(); stderr.mockRestore(); jest.dontMock('../../scripts/lib/VerificationWorkspace');
    }
});

test.each(['pass', 'already-listening', 'listen-error', 'open-error', 'warm-error', 'measurement-error', 'close-error', 'shutdown-error',
    'combined-error', 'infinite-throughput', 'zero-throughput', 'missing-p99', 'zero-p99', 'entry-changed', 'manifest-changed', 'identity-read-error'])
('benchmark worker owns cleanup and preserves %s', async outcome => {
    const argv = process.argv, environment = process.env, exitCode = process.exitCode;
    let finish, identityReads = 0;
    const completed = new Promise(resolve => { finish = resolve; });
    const events = [];
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => { events.push('output'); finish(); return true; });
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => { finish(); return true; });
    const closeClient = jest.fn(async () => {
        events.push('close');
        if (['close-error', 'combined-error'].includes(outcome)) throw new Error('unit close');
    });
    const shutdown = jest.fn(async () => {
        events.push('shutdown');
        if (['shutdown-error', 'combined-error'].includes(outcome)) throw new Error('unit shutdown');
    });
    const batch = jest.fn(async (_socket, policy) => {
        if (['warm-error', 'combined-error'].includes(outcome) || (outcome === 'measurement-error' && policy.recordLatency)) throw new Error('unit batch');
        return { sent: policy.count, received: policy.count,
            elapsedMs: outcome === 'infinite-throughput' ? Number.MIN_VALUE : outcome === 'zero-throughput' ? Infinity : 1,
            latencies: outcome === 'missing-p99' ? [] : outcome === 'zero-p99' ? [0, 0] : [2, 1] };
    });
    let read;
    try {
        process.argv = [process.execPath, 'benchmark-worker.js', root];
        process.env = outcome === 'pass' ? { NODE_PATH: '/unit-fallback' } : {};
        process.exitCode = 0;
        const originalRead = fs.readFileSync;
        const changedFile = path.join(root, outcome === 'manifest-changed' ? 'package.json' : 'index.js');
        read = jest.spyOn(fs, 'readFileSync').mockImplementation((file, ...options) => {
            const value = originalRead(file, ...options);
            if (String(file) === changedFile && !options.length && ++identityReads >= 2) {
                if (outcome === 'identity-read-error') throw new Error('unit identity read');
                if (['entry-changed', 'manifest-changed'].includes(outcome)) return Buffer.concat([value, Buffer.from('\n')]);
            }
            return value;
        });
        jest.isolateModules(() => {
            jest.doMock('../..', () => ({ BaseHandler: class {}, SocketRoute: class {
                constructor({ handlers }) { new handlers[0]().onMessage({ sendJson() {} }, { id: 0 }); }
            }, SocketServer: class {
                constructor({ routes }) {
                    new routes[0]();
                    this.server = { listening: outcome === 'already-listening', address: () => ({ port: 1 }) };
                }
                shutdown = shutdown;
            } }));
            jest.doMock('../../scripts/realtime-harness', () => ({ silentLogger: {}, closeClient,
                waitFor: async () => { if (outcome === 'listen-error') throw new Error('unit listen'); },
                openClient: async () => { if (outcome === 'open-error') throw new Error('unit open'); return {}; },
            }));
            jest.doMock('../../scripts/lib/measureBenchmarkBatch', () => ({ measureBenchmarkBatch: batch }));
            require('../../scripts/benchmark-worker');
        });
        await withTimeout(completed, 'unit benchmark worker', 1000);
        expect(closeClient).toHaveBeenCalledTimes(1); expect(shutdown).toHaveBeenCalledTimes(1);
        expect(events.indexOf('shutdown')).toBeGreaterThan(events.indexOf('close'));
        if (['pass', 'already-listening'].includes(outcome)) {
            expect(process.exitCode).toBe(0); expect(stderr).not.toHaveBeenCalled();
            expect(events.at(-1)).toBe('output');
            const output = JSON.parse(stdout.mock.calls[0][0]);
            expect(output).toMatchObject({ messages: 20000, concurrency: 128, warmupSent: 2000, warmupReceived: 2000, sent: 20000, received: 20000 });
            expect(batch.mock.calls.map(([, policy]) => policy.offset)).toEqual([0, 2000]);
        } else {
            expect(stdout).not.toHaveBeenCalled(); expect(process.exitCode).toBe(1);
            if (outcome === 'combined-error') for (const text of ['unit batch', 'unit close', 'unit shutdown']) expect(stderr.mock.calls[0][0]).toContain(text);
        }
    } finally {
        read?.mockRestore(); process.argv = argv; process.env = environment; process.exitCode = exitCode;
        stdout.mockRestore(); stderr.mockRestore();
        jest.dontMock('../..'); jest.dontMock('../../scripts/realtime-harness'); jest.dontMock('../../scripts/lib/measureBenchmarkBatch');
    }
});

test('benchmark worker rejects a missing module directory before creating resources', () => {
    const argv = process.argv;
    try {
        process.argv = [process.execPath, 'benchmark-worker.js'];
        expect(() => jest.isolateModules(() => require('../../scripts/benchmark-worker'))).toThrow('module directory');
    } finally { process.argv = argv; }
});
