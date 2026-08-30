'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { inspect } = require('node:util');
const { spawnManaged, stopProcessTree } = require('../evaluation/process');
const { withTimeout } = require('../../tests/helpers/network');

class DiagnosticProcess {
    constructor(role, { coverageDirectory = '' } = {}) {
        this.child = spawnManaged(['--expose-gc', path.join(__dirname, 'recovery-split-worker.cjs'), role], {
            // Coverage is explicitly opt-in for behavioral tests, never inherited
            // by measured workers in run().
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, NODE_OPTIONS: '', NODE_V8_COVERAGE: coverageDirectory },
        });
        this.output = '';
        const capture = chunk => {
            this.output += chunk;
            if (this.output.length > 1024 * 1024) {
                this.output = this.output.slice(-1024 * 1024);
                this.outputTruncated = true;
            }
        };
        this.child.stdout.on('data', capture);
        this.child.stderr.on('data', capture);
        this.child.on('error', error => { this.failure = error; });
        // Explicit IPC disconnect on Windows can omit ChildProcess 'close' even
        // after process exit and both pipes close. Observe the owned resources.
        this.closed = Promise.all([
            new Promise(resolve => { this.child.once('exit', resolve); this.child.once('error', resolve); }),
            ...[this.child.stdout, this.child.stderr].map(stream => new Promise(resolve => stream.once('close', resolve))),
        ]);
    }

    async request(command, data = {}, timeoutMs = 15000) {
        if (this.failure) throw this.failure;
        if (!this.child.connected) throw new Error('Diagnostic worker is disconnected');
        assert(!this.pending, 'Diagnostic requests must be sequential per worker');
        this.pending = true;
        try {
            return await new Promise((resolve, reject) => {
                const cleanup = () => {
                    clearTimeout(timer);
                    this.child.off('message', message);
                    this.child.off('exit', exit);
                    this.child.off('error', error);
                };
                const error = failure => { cleanup(); reject(failure); };
                const message = value => {
                    cleanup();
                    if (value.error) reject(new Error(value.error));
                    else resolve(value.result);
                };
                const exit = () => error(new Error(`Diagnostic worker exited during ${command}`));
                const timer = setTimeout(() => error(new Error(`Diagnostic ${command} timed out`)), timeoutMs);
                this.child.once('message', message);
                this.child.once('exit', exit);
                this.child.once('error', error);
                this.child.send({ command, ...data }, failure => { if (failure) error(failure); });
            });
        } catch (error) {
            // Do not reuse a failed RPC channel: a late reply has no request id.
            this.failure = error;
            throw error;
        } finally { this.pending = false; }
    }

    async close() {
        // Kill only our child/process tree; do not depend on responsive IPC.
        try {
            await stopProcessTree(this.child);
            await withTimeout(this.closed, 'diagnostic worker close', 5000);
        } catch (error) {
            const failures = [error];
            // Detach owned local handles if OS cleanup fails, so reporting can
            // finish. This is containment, NOT proof that the child has exited.
            for (const release of [
                () => { if (this.child.connected) this.child.disconnect(); },
                () => this.child.stdout.destroy(), () => this.child.stderr.destroy(),
                () => this.child.unref(),
            ]) {
                try { release(); } catch (failure) { failures.push(failure); }
            }
            throw new AggregateError(failures, `Diagnostic cleanup uncertain for PID ${this.child.pid}`);
        }
    }
}

const phases = Object.freeze([
    ['preconditioning', 1200], ['warm', 200],
    ...Array.from({ length: 5 }, (_, index) => [`storm-${index + 1}`, 1200]),
]);

async function run(report, record = () => {}) {
    let server;
    let client;
    let primary;
    try {
        server = new DiagnosticProcess('server');
        client = new DiagnosticProcess('client');
        const { url } = await server.request('start');
        let start = 0;
        for (const [phase, count] of phases) {
            for (let offset = 0; offset < count; offset += 50) {
                const delivery = await client.request('batch', { url, start: start + offset, count: 50 });
                const barrier = await server.request('barrier');
                assert.equal(delivery.sent, start + offset + 50);
                assert.equal(delivery.received, delivery.sent);
                assert.equal(barrier.received, delivery.sent);
            }
            start += count;
            const [serverSample, clientSample] = await Promise.all([server.request('sample'), client.request('sample')]);
            const sample = { phase, server: serverSample, client: clientSample };
            report.samples.push(sample);
            record(sample);
        }
        assert.equal(start, 7400);
        await Promise.all([server.request('stop'), client.request('stop')]);
    } catch (error) {
        primary = error;
        throw error;
    } finally {
        // Both cleanups are attempted even if one fails. Keep failure evidence.
        const workers = [server, client].filter(Boolean);
        const results = await Promise.allSettled(workers.map(worker => worker.close()));
        report.workerOutput = { server: server?.output, client: client?.output,
            truncated: Boolean(server?.outputTruncated || client?.outputTruncated) };
        const failures = results.filter(result => result.status === 'rejected');
        if (failures.length) throw new AggregateError([...primary ? [primary] : [], ...failures.map(result => result.reason)], 'Diagnostic process cleanup failed');
    }
    report.deliveryAndCleanupPassed = true;
}

function fingerprint() {
    const root = path.resolve(__dirname, '../..');
    const files = ['index.js', 'package.json', 'package-lock.json',
        'scripts/diagnostics/recovery-split.cjs', 'scripts/diagnostics/recovery-split-worker.cjs',
        'scripts/verify-recovery.js', 'scripts/realtime-harness.js'];
    const walk = directory => {
        for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
            const name = path.join(directory, entry.name);
            if (entry.isDirectory()) walk(name);
            else files.push(name);
        }
    };
    walk('src');
    // Capture linked client identity too; the root lockfile cannot identify it.
    for (const name of ['ws/package.json', 'ws', 'redweb-client', 'redweb-client/live-html']) {
        files.push(require.resolve(name));
    }
    return Object.fromEntries(files.sort().map(name => [name,
        createHash('sha256').update(fs.readFileSync(path.resolve(root, name))).digest('hex')]));
}

async function main() {
    const base = path.resolve(__dirname, '../../coverage');
    fs.mkdirSync(base, { recursive: true });
    const directory = fs.mkdtempSync(path.join(base, 'recovery-split-'));
    const report = { diagnosticOnly: true, protocol: 'split-steady-v2', startedAt: new Date().toISOString(),
        platform: process.platform, architecture: process.arch, coordinatorPid: process.pid,
        workload: { preconditioning: 1200, warm: 200, storms: 5, connectionsPerStorm: 1200, batchSize: 50, settleMs: 400 },
        sourceHashes: fingerprint(), wsVersion: require('ws/package.json').version,
        samples: [], deliveryAndCleanupPassed: false };
    process.stdout.write(`Diagnostic evidence: ${directory}\n`);
    let primary;
    try {
        await run(report, sample => {
            fs.appendFileSync(path.join(directory, 'samples.ndjson'), `${JSON.stringify(sample)}\n`);
            process.stdout.write(`${sample.phase}: server ${sample.server.memory.heapUsed}, client ${sample.client.memory.heapUsed}\n`);
        });
        assert.deepEqual(fingerprint(), report.sourceHashes, 'Measured inputs changed during diagnosis');
    } catch (error) {
        primary = error;
        report.error = describeFailure(error);
        report.deliveryAndCleanupPassed = false;
        throw error;
    } finally {
        report.endedAt = new Date().toISOString();
        try {
            fs.writeFileSync(path.join(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
        } catch (error) {
            if (primary) throw new AggregateError([primary, error], 'Diagnosis and report preservation failed');
            throw error;
        }
    }
}

function describeFailure(error) {
    // Error.stack alone omits AggregateError.errors and nested primary causes.
    return inspect(error, { depth: null, customInspect: false });
}

module.exports = { DiagnosticProcess, phases, fingerprint, describeFailure, run };
if (require.main === module) main().catch(error => { process.stderr.write(`${describeFailure(error)}\n`); process.exitCode = 1; });
