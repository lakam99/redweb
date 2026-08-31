'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { RecoveryCoordinatorBoundary } = require('../helpers/RecoveryCoordinatorBoundary');

async function boundary(options, assertion) {
    await new VerificationWorkspace().run(async owner => {
        const probe = new RecoveryCoordinatorBoundary(owner.directory, options);
        try { await assertion(probe, owner.directory); } finally { probe.collect(); }
    });
}

test.each([{}, { largeOutput: true }])('complete synthetic workload reconciles every batch and independently closes workers: %j', options =>
    boundary(options, async probe => {
        const report = { samples: [] };
        await probe.api.run(report);
        expect(report.deliveryAndCleanupPassed).toBe(true);
        expect(probe.sent).toBe(7400);
        expect(probe.requests.filter(item => item.command === 'batch').map(({ start, count }) => [start, count]))
            .toEqual(Array.from({ length: 148 }, (_, index) => [index * 50, 50]));
        expect(probe.requests.filter(item => item.command === 'barrier')).toHaveLength(148);
        expect(report.samples.map(sample => sample.phase)).toEqual(probe.api.phases.map(([phase]) => phase));
        expect(report.workerExits.map(exit => exit.role)).toEqual(['server', 'client']);
        expect(report.workerExits.every(exit => exit.stdoutClosed && exit.stderrClosed)).toBe(true);
        expect(probe.stops).toEqual(['server', 'client']);
        expect(probe.timers.size).toBe(0);
        expect(report.workerOutput.truncated).toBe(Boolean(options.largeOutput));
        for (const child of probe.children) expect(child.settings.env).toMatchObject({ NODE_OPTIONS: '', NODE_V8_COVERAGE: '' });
    }));

test.each(['badSent', 'badReply', 'badBarrier'])('wrong delivery counters fail before sampling: %s', setting =>
    boundary({ [setting]: true }, async probe => {
        const report = { samples: [] };
        await expect(probe.api.run(report)).rejects.toThrow('Expected values to be strictly equal');
        expect(report.deliveryAndCleanupPassed).not.toBe(true);
        expect(report.samples).toEqual([]); expect(probe.stops).toEqual(['server', 'client']);
    }));

test.each([0, 1])('partial acquisition failure at worker %s preserves failure and releases every acquired worker', spawnFailureAt =>
    boundary({ spawnFailureAt, signalExit: true }, async probe => {
        const report = { samples: [] };
        const failure = await probe.api.run(report).catch(error => error);
        expect(failure.cause).toBe(0);
        expect(report.workerExits).toHaveLength(spawnFailureAt);
        for (const exit of report.workerExits) expect(exit).toMatchObject({ exitCode: null, signalCode: 'SIGTERM' });
        expect(probe.stops).toEqual(spawnFailureAt ? ['server'] : []);
        expect(report.deliveryAndCleanupPassed).not.toBe(true);
    }));

test.each([false, true])('independent cleanup aggregates preserve the optional primary failure: %s', primary =>
    boundary({ closeFailure: 'both' }, async probe => {
        const report = { samples: [] };
        const failure = await probe.api.run(report, () => { if (primary) throw 0; }).catch(error => error);
        expect(failure.message).toBe('Diagnostic process cleanup failed');
        expect(failure.errors).toHaveLength(primary ? 3 : 2);
        if (primary) expect(failure.errors[0].cause).toBe(0);
        expect(probe.stops).toEqual(['server', 'client']);
        expect(probe.children.every(child => child.releases.includes('unref'))).toBe(true);
        expect(report.deliveryAndCleanupPassed).not.toBe(true);
    }));

test('graceful-exit timeout cannot produce a successful run', () =>
    boundary({ timeoutLabel: 'diagnostic graceful exit', hangExit: true }, async probe => {
        const report = { samples: [] };
        await expect(probe.api.run(report)).rejects.toBe(probe.primary);
        expect(probe.stops).toEqual(['server', 'client']);
        expect(report.workerExits.every(exit => exit.forcedCleanupNeeded)).toBe(true);
        expect(report.deliveryAndCleanupPassed).not.toBe(true);
    }));

test('heap mode checks snapshot worker identity at both phases', () =>
    boundary({}, async (probe, directory) => {
        const report = { samples: [] };
        await probe.api.run(report, undefined, { mode: 'client-heap', snapshotDirectory: directory });
        expect(report.heapCaptures.map(capture => capture.phase)).toEqual(['warm', 'storm-5']);
        expect(probe.children[0].args).not.toContain(directory);
        expect(probe.children[1].args.at(-1)).toBe(directory);
        expect(() => new probe.api.DiagnosticProcess('client', { mode: 'client-heap', snapshotDirectory: 'relative' })).toThrow('absolute directory');
        expect(() => new probe.api.DiagnosticProcess('client', { snapshotDirectory: directory })).toThrow('explicit heap mode');
    }));

test('snapshot from another worker cannot pass the coordinator', () =>
    boundary({ badSnapshotPid: true }, async (probe, directory) => {
        const report = { samples: [] };
        await expect(probe.api.run(report, undefined, { mode: 'client-heap', snapshotDirectory: directory })).rejects.toThrow('Expected values to be strictly equal');
        expect(report.heapCaptures).toBeUndefined();
        expect(probe.stops).toEqual(['server', 'client']);
    }));

test.each(['sendThrows', 'callbackFailure', 'errorCommand', 'exitCommand', 'rejectCommand'])('RPC %s rejects, clears listeners/deadlines and poisons reuse', mode =>
    boundary({ [mode]: mode.endsWith('Command') ? 'sample' : true }, async probe => {
        const worker = new probe.api.DiagnosticProcess('client');
        const failure = await worker.request('sample').catch(error => error);
        expect(failure.message).toContain(mode === 'exitCommand' ? 'exited during sample'
            : mode === 'rejectCommand' ? 'Unit rejected command' : 'Unit coordinator failure');
        expect(probe.timers.size).toBe(0); expect(worker.child.listenerCount('message')).toBe(0);
        await expect(worker.request('sample')).rejects.toBe(failure);
        await worker.close();
    }));

test('pending requests are sequential and their explicit timer rejects without channel reuse', () =>
    boundary({ dropReplies: true }, async probe => {
        const worker = new probe.api.DiagnosticProcess('client', { coverageDirectory: 'unit-explicit-coverage' });
        expect(worker.child.settings.env.NODE_V8_COVERAGE).toBe('unit-explicit-coverage');
        const pending = worker.request('sample', {}, 10);
        await expect(worker.request('sample')).rejects.toThrow('sequential');
        probe.fireTimers(); await expect(pending).rejects.toThrow('timed out');
        expect(probe.timers.size).toBe(0); expect(worker.pending).toBe(false);
        await worker.close();
        const other = new probe.api.DiagnosticProcess('client'); other.child.connected = false;
        await expect(other.request('sample')).rejects.toThrow('disconnected'); await other.close();
    }));

test('falsy repeated output failures stay poisoned and cannot disappear after local cleanup', () =>
    boundary({}, async probe => {
        const worker = new probe.api.DiagnosticProcess('server', { output() { throw 0; } });
        const failure = await worker.request('start').catch(error => error);
        expect(failure.cause).toBe(0); expect(worker.outputFailure).toBe(failure);
        expect(worker.output).toBe('unit stdoutunit stderr');
        await expect(worker.close()).rejects.toBe(failure);
    }));

test.each([true, false])('uncertain cleanup attempts every local release (connected=%s)', connected =>
    boundary({ closeFailure: 'client', releaseFailures: true }, async probe => {
        const worker = new probe.api.DiagnosticProcess('client'); worker.child.connected = connected;
        const failure = await worker.close().catch(error => error);
        expect(failure.message).toContain('Diagnostic cleanup uncertain');
        expect(failure.errors).toHaveLength(connected ? 5 : 4);
        expect(worker.child.releases).toEqual([...(connected ? ['disconnect'] : []), 'stdout', 'stderr', 'unref']);
    }));

test('closed-pipe deadline failure still releases owned local handles', () =>
    boundary({ timeoutLabel: 'diagnostic worker close' }, async probe => {
        const worker = new probe.api.DiagnosticProcess('client');
        await expect(worker.close()).rejects.toThrow('cleanup uncertain');
        expect(worker.child.releases).toEqual(['disconnect', 'stdout', 'stderr', 'unref']);
    }));

test.each([undefined, 'trace', 'client-jitless', 'client-code', 'client-deopt', 'client-heap'])('synthetic CLI %s preserves its actual owned files and final report', mode =>
    boundary({ cli: true, args: mode ? [mode] : [] }, async (probe, directory) => {
        await probe.completed();
        expect(probe.stderr).toBe(''); expect(probe.context.process.exitCode).toBeUndefined();
        const report = probe.report();
        expect(report.deliveryAndCleanupPassed).toBe(true); expect(report.samples).toHaveLength(7);
        expect(report.workload).toEqual({ preconditioning: 1200, warm: 200, storms: 5, connectionsPerStorm: 1200, batchSize: 50, settleMs: 400 });
        expect(Object.values(report.outputFiles).every(log => log.complete)).toBe(true);
        expect(probe.allocations.every(target => path.dirname(target) === directory)).toBe(true);
        expect(probe.stdout).toContain('storm-5: server 1000, client 1000');
        if (mode === 'client-heap') {
            expect(report.heapComparison).toEqual({ diagnosticOnly: true });
            expect(probe.stdout).toContain('Private snapshots (do not upload)');
        }
        if (['client-code', 'client-deopt'].includes(mode)) expect(report.codeCensus).toEqual({ diagnosticOnly: true });
    }));

test.each([
    [{ args: ['baseline', 'extra'] }, 'Usage:'],
    [{ args: ['unknown'] }, 'Unknown diagnostic mode'],
    [{ outputAcquisitionFailure: true }, 'EEXIST'],
    [{ changedInput: true }, 'Measured inputs changed'],
    [{ sampleWriteFailure: true }, 'Error: 0'],
    [{ args: ['client-heap'], comparisonFailure: true }, 'Private heap comparison failed; raw details withheld'],
    [{ args: ['client-heap'], oversizedComparison: true }, 'Private heap comparison failed; raw details withheld'],
    [{ summaryFailure: true }, 'Diagnostic output preservation failed'],
    [{ tamperOutput: true }, 'Diagnostic output is incomplete'],
    [{ args: ['client-code'], censusFailure: true }, 'Diagnostic output preservation failed'],
    [{ reportWriteFailure: true }, 'Diagnosis or report preservation failed'],
])('synthetic CLI reports failure, not success: %j', (options, message) =>
    boundary({ ...options, cli: true }, async probe => {
        await probe.completed();
        expect(probe.context.process.exitCode).toBe(1); expect(probe.stderr).toContain(message);
        expect(probe.stderr).not.toContain('Private unit data must not escape');
        if (probe.reportDirectory && !options.reportWriteFailure) expect(probe.report().deliveryAndCleanupPassed).toBe(false);
        if (options.outputAcquisitionFailure) expect(fs.readFileSync(path.join(probe.reportDirectory, 'server.stdout.log'), 'utf8')).toBe('existing');
    }));

test.each([false, true])('main retains primary, output and optional report failures in order (report fails=%s)', reportWriteFailure =>
    boundary({ sampleWriteFailure: true, summaryFailure: true, reportWriteFailure }, async probe => {
        // main is the original VM function, not a new production export. Calling
        // it directly exposes the final Error while other cases cover the CLI catch.
        const failure = await probe.context.main().catch(error => error);
        expect(failure.message).toBe(reportWriteFailure ? 'Diagnosis or report preservation failed' : 'Diagnostic output preservation failed');
        expect(failure.errors).toHaveLength(reportWriteFailure ? 3 : 2);
        expect(failure.errors[0]).toMatchObject({ message: '0', cause: 0 });
        expect(failure.errors[1]).toBe(probe.primary);
        if (reportWriteFailure) {
            expect(failure.errors[2]).toMatchObject({ message: '0', cause: 0 });
            expect(failure.errors[2]).not.toBe(failure.errors[0]);
            expect(fs.existsSync(path.join(probe.reportDirectory, 'report.json'))).toBe(false);
        } else {
            expect(probe.report()).toMatchObject({ deliveryAndCleanupPassed: false });
            expect(probe.report().error).toContain('Error: 0');
            expect(probe.report().outputError).toContain('Unit coordinator failure');
        }
    }));
