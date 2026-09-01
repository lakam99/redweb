'use strict';

const { DiagnosticProcess, run } = require('../../scripts/diagnostics/recovery-split.cjs');

test('synchronous native IPC serialization failure removes request listeners immediately', async () => {
    const worker = new DiagnosticProcess('client');
    try {
        await worker.request('sample');
        const events = ['message', 'exit', 'error'];
        const counts = () => events.map(event => worker.child.listenerCount(event));
        const before = counts();
        const circular = {}; circular.self = circular;
        await expect(worker.request('sample', { circular })).rejects.toThrow(/circular/i);
        expect(counts()).toEqual(before);
        await expect(worker.request('sample')).rejects.toThrow(/circular/i);
    } finally { await worker.close(); }
}, 15000);

test.each([undefined, null, false, 0, ''])('worker registration rejection is retained after native cleanup: %s', async value => {
    const report = { samples: [], deliveryAndCleanupPassed: false };
    const result = await run(report, undefined, { onWorker() { throw value; } }).catch(error => error);
    expect(result).toBeInstanceOf(Error);
    expect(result.constructor).toBe(Error);
    expect(result).not.toHaveProperty('errors');
    expect(result.message).toBe(String(value));
    expect(result.cause).toBe(value);
    expect(report.deliveryAndCleanupPassed).toBe(false);
    expect(report.samples).toEqual([]);
    expect(report.workerExits).toHaveLength(1);
    const exit = report.workerExits[0];
    expect(exit.role).toBe('server');
    expect(exit.stdoutClosed).toBe(true);
    expect(exit.stderrClosed).toBe(true);
    expect(exit.exitCode !== null || exit.signalCode !== null).toBe(true);
}, 15000);

test('a falsy output callback failure poisons the real worker and remains a cleanup failure', async () => {
    let observed = false;
    const worker = new DiagnosticProcess('client', { mode: 'trace', output: () => {
        observed = true;
        throw 0;
    } });
    let failure;
    let cleanupFailure;
    try {
        try { await worker.request('sample'); } catch (error) { failure = error; }
    } finally {
        try { await worker.close(); } catch (error) { cleanupFailure = error; }
    }
    expect(observed).toBe(true);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.cause).toBe(0);
    expect(worker.failure).toBe(failure);
    expect(cleanupFailure).toBe(failure);
    expect(worker.child.exitCode !== null || worker.child.signalCode !== null).toBe(true);
}, 15000);
