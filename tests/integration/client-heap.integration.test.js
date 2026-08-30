'use strict';

const test = (name, body, timeout = 60000) => globalThis.test
    ? globalThis.test(name, body, timeout) : require('node:test').test(name, { timeout }, body);
const expect = globalThis.expect ?? require('expect').expect;

const fs = require('node:fs');
const path = require('node:path');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { DiagnosticProcess, workerFlags } = require('../../scripts/diagnostics/recovery-split.cjs');
const { compareFiles } = require('../../scripts/diagnostics/HeapCodeComparison.cjs');
const { ClientHeapCapture } = require('../../scripts/diagnostics/ClientHeapCapture.cjs');
const { assertPortReusable } = require('../helpers/port-reusable');
const { withTimeout } = require('../helpers/network');

test('real client snapshots bracket exact network delivery and verify identity, hashes and private graph analysis', () =>
    new VerificationWorkspace().run(async workspace => {
        const options = { mode: 'client-heap', snapshotDirectory: workspace.directory, coverageDirectory: process.env.NODE_V8_COVERAGE };
        let server, client, primary;
        const captures = [];
        let port;
        try {
            server = new DiagnosticProcess('server', options);
            client = new DiagnosticProcess('client', options);
            const { url } = await server.request('start');
            port = Number(new URL(url).port);
            for (const [start, phase] of [[0, 'warm'], [50, 'storm-5']]) {
                expect(await client.request('batch', { url, start, count: 50 })).toEqual({ sent: start + 50, received: start + 50, clients: 0 });
                expect(await server.request('barrier')).toEqual({ received: start + 50 });
                const sample = await client.request('sample', { phase });
                expect(sample.execArgv).toEqual(workerFlags('client', 'baseline'));
                const capture = await client.request('snapshot', { phase }, 60000);
                expect(capture.pid).toBe(sample.pid);
                captures.push(capture);
            }
            await Promise.all([server.request('stop'), client.request('stop')]);
            for (const worker of [server, client]) worker.child.disconnect();
            await withTimeout(Promise.all([server.closed, client.closed]), 'heap diagnostic exit', 5000);
        } catch (error) { primary = error; throw error; }
        finally {
            const closed = await Promise.allSettled([server, client].filter(Boolean).map(worker => worker.close()));
            const failures = closed.filter(result => result.status === 'rejected').map(result => result.reason);
            if (failures.length) {
                workspace.cleanupFailure = new AggregateError([primary, ...failures].filter(Boolean), 'Heap test cleanup uncertain');
                throw workspace.cleanupFailure;
            }
        }
        await assertPortReusable(port);
        expect(captures[0].identity).toBe(captures[1].identity);
        expect(fs.readdirSync(workspace.directory).sort()).toEqual(['client-storm-5.heapsnapshot', 'client-warm.heapsnapshot']);
        if (process.version !== 'v22.21.0' || process.versions.v8 !== '12.4.254.21-node.33') {
            expect(() => compareFiles(workspace.directory, captures)).toThrow();
            return;
        }
        const report = compareFiles(workspace.directory, captures);
        expect(report.retainedSizeProven).toBe(false);
        expect(report.codePaths.some(row => row.status === 'root-path')).toBe(true);
        expect(report.categories.some(row => row.category === 'system / FeedbackVector')).toBe(true);
        expect(JSON.stringify(report)).not.toMatch(/ws:\/\/|client-warm|private-token/);
        for (const change of [{ identity: `1:${'a'.repeat(36)}` }, { pid: -1 }, { node: 'v0' }, { v8: '0' },
            { phase: 'warm' }, { filename: '../escape' }, { bytes: 0 }, { bytes: 64 * 1024 * 1024 + 1 },
            { bytes: captures[1].bytes + 1 }, { sha256: '0'.repeat(64) }]) {
            expect(() => compareFiles(workspace.directory, [captures[0], { ...captures[1], ...change }])).toThrow();
        }
        const original = path.join(workspace.directory, 'original.json');
        const result = path.join(workspace.directory, 'summary.json');
        const cli = path.resolve(__dirname, '../../scripts/diagnostics/HeapCodeComparison.cjs');
        const input = JSON.stringify({ deliveryAndCleanupPassed: false, heapCaptures: captures, privateField: 'PRIVATE-SENTINEL' });
        fs.writeFileSync(original, input);
        expect(await workspace.command([cli, original, workspace.directory, result])).toContain('original evidence unchanged');
        const saved = fs.readFileSync(result, 'utf8');
        const summary = JSON.parse(saved);
        expect(summary.originalRunReportedSuccess).toBe(false);
        expect(summary.originalReportSHA256).toBe(require('node:crypto').createHash('sha256').update(input).digest('hex'));
        expect(saved).not.toContain('PRIVATE-SENTINEL');
        await expect(workspace.command([cli, original, workspace.directory, result])).rejects.toThrow('raw details withheld');
        expect(fs.readFileSync(result, 'utf8')).toBe(saved);
        expect(fs.readFileSync(original, 'utf8')).toBe(input);
        fs.writeFileSync(original, 'PRIVATE-SENTINEL');
        await expect(workspace.command([cli, original, workspace.directory, result])).rejects.toThrow('raw details withheld');
        await expect(workspace.command([cli])).rejects.toThrow('raw details withheld');
    }), 300000);

test('actual capture enforces disk limit, poisons failed sessions and never overwrites evidence', () =>
    new VerificationWorkspace().run(async workspace => {
        const capture = new ClientHeapCapture(workspace.directory, 1);
        await expect(capture.capture('warm')).rejects.toThrow('Heap capture output limit exceeded');
        await expect(capture.capture('warm')).rejects.toThrow('Invalid heap capture sequence');
        expect(fs.statSync(path.join(workspace.directory, 'client-warm.heapsnapshot')).size).toBe(0);
        await expect(new ClientHeapCapture(workspace.directory).capture('warm')).rejects.toThrow(/EEXIST/);
        expect(fs.statSync(path.join(workspace.directory, 'client-warm.heapsnapshot')).size).toBe(0);
    }), 30000);

test('ordinary workers cannot capture snapshots and cleanup after rejection', async () => {
    const worker = new DiagnosticProcess('client');
    try { await expect(worker.request('snapshot', { phase: 'warm' })).rejects.toThrow('Private heap capture failed'); }
    finally { await worker.close(); }
    expect(() => new DiagnosticProcess('client', { snapshotDirectory: path.resolve(__dirname) })).toThrow('Snapshots require explicit');
    expect(() => new DiagnosticProcess('client', { mode: 'client-heap', snapshotDirectory: 'relative' })).toThrow('private absolute directory');
});
