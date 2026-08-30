'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { inspect } = require('node:util');
const { spawnManaged, stopProcessTree } = require('../evaluation/process');
const { withTimeout } = require('../../tests/helpers/network');

function workerFlags(role, mode = 'baseline') {
    assert(['server', 'client'].includes(role), 'Unknown diagnostic role');
    assert(['baseline', 'trace', 'client-jitless', 'client-code', 'client-deopt', 'client-heap'].includes(mode), 'Unknown diagnostic mode');
    return ['--expose-gc', ...(mode === 'trace' ? ['--trace-gc', '--trace-flush-code'] : []),
        ...(mode === 'client-jitless' && role === 'client' ? ['--jitless'] : []),
        ...(['client-code', 'client-deopt'].includes(mode) && role === 'client' ? ['--log-code', '--no-log-source-code',
            '--no-log-source-position', '--no-logfile-per-isolate', '--logfile=-'] : []),
        ...(mode === 'client-deopt' && role === 'client' ? ['--log-deopt'] : [])];
}

// Append synchronously in the coordinator: no unbounded stream buffer or open
// log descriptor can outlive cleanup. A limit/write error invalidates the run.
function outputRecorder(directory, maxBytes = 16 * 1024 * 1024) {
    assert(Number.isSafeInteger(maxBytes) && maxBytes > 0, 'Invalid output limit');
    const logs = {};
    for (const role of ['server', 'client']) {
        for (const stream of ['stdout', 'stderr']) {
            const name = `${role}.${stream}.log`;
            fs.writeFileSync(path.join(directory, name), '', { flag: 'wx' });
            logs[name] = { bytes: 0, complete: true };
        }
    }
    return {
        write(role, stream, chunk) {
            const name = `${role}.${stream}.log`;
            assert(Object.hasOwn(logs, name), 'Unknown diagnostic output stream');
            const log = logs[name];
            try {
                assert(log.complete, 'Diagnostic output already failed');
                assert(log.bytes + chunk.length <= maxBytes, `Diagnostic output exceeded ${maxBytes} bytes: ${name}`);
                fs.appendFileSync(path.join(directory, name), chunk);
                log.bytes += chunk.length;
            } catch (error) {
                log.complete = false;
                throw error;
            }
        },
        summary() {
            return Object.fromEntries(Object.entries(logs).map(([name, log]) => {
                const bytes = fs.readFileSync(path.join(directory, name));
                return [name, { ...log, complete: log.complete && bytes.length === log.bytes,
                    sha256: createHash('sha256').update(bytes).digest('hex') }];
            }));
        },
    };
}

class DiagnosticProcess {
    constructor(role, { coverageDirectory = '', mode = 'baseline', output, snapshotDirectory } = {}) {
        assert(mode !== 'client-heap' || path.isAbsolute(snapshotDirectory), 'Heap mode requires a private absolute directory');
        assert(!snapshotDirectory || mode === 'client-heap', 'Snapshots require explicit heap mode');
        this.child = spawnManaged([...workerFlags(role, mode), path.join(__dirname, 'recovery-split-worker.cjs'), role,
            ...(mode === 'client-heap' && role === 'client' ? [snapshotDirectory] : [])], {
            // Coverage is explicitly opt-in for behavioral tests, never inherited
            // by measured workers in run().
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, NODE_OPTIONS: '', NODE_V8_COVERAGE: coverageDirectory },
        });
        this.output = '';
        const capture = (stream, chunk) => {
            try { if (output) output(role, stream, chunk); }
            catch (error) {
                if (!this.outputFailure) {
                    this.outputFailure = error;
                    this.child.emit('error', error);
                }
            }
            this.output += chunk;
            if (this.output.length > 1024 * 1024) {
                this.output = this.output.slice(-1024 * 1024);
                this.outputTruncated = true;
            }
        };
        this.child.stdout.on('data', chunk => capture('stdout', chunk));
        this.child.stderr.on('data', chunk => capture('stderr', chunk));
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
        if (this.outputFailure) throw this.outputFailure;
    }
}

const phases = Object.freeze([
    ['preconditioning', 1200], ['warm', 200],
    ...Array.from({ length: 5 }, (_, index) => [`storm-${index + 1}`, 1200]),
]);

async function run(report, record = () => {}, { mode = 'baseline', output, snapshotDirectory } = {}) {
    let server;
    let client;
    let primary;
    try {
        server = new DiagnosticProcess('server', { mode, output, snapshotDirectory });
        client = new DiagnosticProcess('client', { mode, output, snapshotDirectory });
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
            const [serverSample, clientSample] = await Promise.all([server.request('sample', { phase }), client.request('sample', { phase })]);
            const sample = { phase, server: serverSample, client: clientSample };
            report.samples.push(sample);
            record(sample);
            if (mode === 'client-heap' && ['warm', 'storm-5'].includes(phase)) {
                const capture = await client.request('snapshot', { phase }, 60000);
                assert.equal(capture.pid, clientSample.pid);
                (report.heapCaptures ??= []).push(capture);
            }
        }
        assert.equal(start, 7400);
        await Promise.all([server.request('stop'), client.request('stop')]);
        for (const worker of [server, client]) worker.child.disconnect();
        await Promise.all([server, client].map(worker => withTimeout(worker.closed, 'diagnostic graceful exit', 5000)));
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
        'scripts/diagnostics/recovery-code-summary.cjs',
        'scripts/diagnostics/DeoptimizationCensus.cjs',
        'scripts/diagnostics/ClientHeapCapture.cjs', 'scripts/diagnostics/HeapSnapshotGraph.cjs',
        'scripts/diagnostics/HeapCodeComparison.cjs', 'scripts/diagnostics/recovery-heap-summary.cjs',
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
    assert(process.argv.length <= 3, 'Usage: node recovery-split.cjs [baseline|trace|client-jitless|client-code|client-deopt|client-heap]');
    const mode = process.argv[2] ?? 'baseline';
    workerFlags('server', mode);
    const base = path.resolve(__dirname, '../../coverage');
    fs.mkdirSync(base, { recursive: true });
    const directory = fs.mkdtempSync(path.join(base, 'recovery-split-'));
    const snapshotDirectory = mode === 'client-heap'
        ? fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'redweb-private-client-heap-')) : undefined;
    if (snapshotDirectory) fs.chmodSync(snapshotDirectory, 0o700);
    const report = { diagnosticOnly: true, mode, protocol: 'split-steady-v2', startedAt: new Date().toISOString(),
        platform: process.platform, architecture: process.arch, coordinatorPid: process.pid,
        workload: { preconditioning: 1200, warm: 200, storms: 5, connectionsPerStorm: 1200, batchSize: 50, settleMs: 400 },
        sourceHashes: fingerprint(), wsVersion: require('ws/package.json').version,
        samples: [], deliveryAndCleanupPassed: false };
    process.stdout.write(`Diagnostic evidence: ${directory}\n`);
    if (snapshotDirectory) process.stdout.write(`Private snapshots (do not upload): ${snapshotDirectory}\n`);
    let primary;
    let output;
    try {
        output = outputRecorder(directory);
        await run(report, sample => {
            fs.appendFileSync(path.join(directory, 'samples.ndjson'), `${JSON.stringify(sample)}\n`);
            process.stdout.write(`${sample.phase}: server ${sample.server.memory.heapUsed}, client ${sample.client.memory.heapUsed}\n`);
        }, { mode, output: output.write, snapshotDirectory });
        assert.deepEqual(fingerprint(), report.sourceHashes, 'Measured inputs changed during diagnosis');
        if (snapshotDirectory) {
            try {
                const comparison = require('./HeapCodeComparison.cjs').compareFiles(snapshotDirectory, report.heapCaptures);
                assert(Buffer.byteLength(JSON.stringify(comparison)) <= 1024 * 1024);
                report.heapComparison = comparison;
            } catch {
                // JSON parse/assertion failures may contain private snapshot strings.
                throw new Error('Private heap comparison failed; raw details withheld');
            }
        }
    } catch (error) {
        primary = error;
        report.error = describeFailure(error);
        report.deliveryAndCleanupPassed = false;
        throw error;
    } finally {
        report.endedAt = new Date().toISOString();
        let outputFailure;
        try {
            if (output) {
                report.outputFiles = output.summary();
                assert(Object.values(report.outputFiles).every(log => log.complete), 'Diagnostic output is incomplete');
                if (['client-code', 'client-deopt'].includes(mode)) {
                    report.codeCensus = require('./recovery-code-summary.cjs').summarize(
                        fs.readFileSync(path.join(directory, 'client.stdout.log'), 'utf8'));
                }
            }
        } catch (error) {
            outputFailure = error;
            report.outputError = describeFailure(error);
            report.deliveryAndCleanupPassed = false;
        }
        try {
            fs.writeFileSync(path.join(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
        } catch (error) {
            throw new AggregateError([primary, outputFailure, error].filter(Boolean), 'Diagnosis or report preservation failed');
        }
        if (outputFailure) throw new AggregateError([primary, outputFailure].filter(Boolean), 'Diagnostic output preservation failed');
    }
}

function describeFailure(error) {
    // Error.stack alone omits AggregateError.errors and nested primary causes.
    return inspect(error, { depth: null, customInspect: false });
}

module.exports = { DiagnosticProcess, phases, fingerprint, describeFailure, workerFlags, outputRecorder, run };
if (require.main === module) main().catch(error => { process.stderr.write(`${describeFailure(error)}\n`); process.exitCode = 1; });
