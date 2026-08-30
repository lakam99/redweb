'use strict';

const { phases, fingerprint, describeFailure, workerFlags } = require('../../scripts/diagnostics/recovery-split.cjs');

test.each(['server', 'client'])('diagnostic flags are explicit and isolated for %s', role => {
    expect(workerFlags(role)).toEqual(['--expose-gc']);
    expect(workerFlags(role, 'baseline')).toEqual(['--expose-gc']);
    expect(workerFlags(role, 'trace')).toEqual(['--expose-gc', '--trace-gc', '--trace-flush-code']);
    expect(workerFlags(role, 'client-jitless')).toEqual(role === 'server' ? ['--expose-gc'] : ['--expose-gc', '--jitless']);
    expect(workerFlags(role, 'client-code')).toEqual(role === 'server' ? ['--expose-gc'] : ['--expose-gc',
        '--log-code', '--no-log-source-code', '--no-log-source-position', '--no-logfile-per-isolate', '--logfile=-']);
    expect(workerFlags(role, 'client-deopt')).toEqual(role === 'server' ? ['--expose-gc'] : [...workerFlags(role, 'client-code'), '--log-deopt']);
    expect(() => workerFlags(role, '--arbitrary-flag')).toThrow('Unknown diagnostic mode');
});

test('unknown roles cannot launch a diagnostic worker', () => {
    expect(() => workerFlags('unknown')).toThrow('Unknown diagnostic role');
});

test('split diagnosis retains the fixed seven-phase 7400-connection workload', () => {
    expect(phases).toEqual([['preconditioning', 1200], ['warm', 200],
        ['storm-1', 1200], ['storm-2', 1200], ['storm-3', 1200], ['storm-4', 1200], ['storm-5', 1200]]);
    expect(phases.reduce((sum, [, count]) => sum + count, 0)).toBe(7400);
});

test('fingerprints the runtime, reference gate, lockfile and linked client reproducibly', () => {
    const actual = fingerprint();
    expect(actual).toEqual(fingerprint());
    expect(actual['scripts/verify-recovery.js']).toMatch(/^[a-f0-9]{64}$/);
    expect(actual['package-lock.json']).toMatch(/^[a-f0-9]{64}$/);
    expect(actual['scripts/diagnostics/recovery-code-summary.cjs']).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(actual).some(name => name.includes('BaseSocketServer.js'))).toBe(true);
    expect(actual[require.resolve('redweb-client/live-html')]).toMatch(/^[a-f0-9]{64}$/);
});

test('failure evidence retains nested primary and cleanup errors', () => {
    const error = new AggregateError([new AggregateError([new Error('original failure'),
        new Error('kill failure')], 'cleanup uncertain'), new Error('report write failure')], 'diagnosis failed');
    const description = describeFailure(error);
    for (const message of ['original failure', 'kill failure', 'cleanup uncertain', 'report write failure', 'diagnosis failed']) {
        expect(description).toContain(message);
    }
});

test.each([false, true])('uncertain OS cleanup releases every local handle (disconnect throws: %s)', async throws => {
    const { EventEmitter } = require('node:events');
    const child = Object.assign(new EventEmitter(), { pid: 12345, connected: true,
        stdout: Object.assign(new EventEmitter(), { destroy: jest.fn() }),
        stderr: Object.assign(new EventEmitter(), { destroy: jest.fn() }),
        disconnect: jest.fn(() => { if (throws) throw new Error('disconnect failure'); }), unref: jest.fn() });
    let DiagnosticProcess;
    jest.isolateModules(() => {
        jest.doMock('../../scripts/evaluation/process', () => ({ spawnManaged: () => child,
            stopProcessTree: async () => { throw new Error('OS kill failure'); } }));
        ({ DiagnosticProcess } = require('../../scripts/diagnostics/recovery-split.cjs'));
    });
    try {
        const worker = new DiagnosticProcess('server');
        const error = await worker.close().catch(failure => failure);
        expect(error).toBeInstanceOf(AggregateError);
        expect(error.message).toContain('uncertain for PID 12345');
        expect(describeFailure(error)).toContain('OS kill failure');
        if (throws) expect(describeFailure(error)).toContain('disconnect failure');
        expect(child.disconnect).toHaveBeenCalledTimes(1);
        expect(child.stdout.destroy).toHaveBeenCalledTimes(1);
        expect(child.stderr.destroy).toHaveBeenCalledTimes(1);
        expect(child.unref).toHaveBeenCalledTimes(1);
    } finally { jest.dontMock('../../scripts/evaluation/process'); }
});
