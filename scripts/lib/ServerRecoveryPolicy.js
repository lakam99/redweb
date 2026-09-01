'use strict';

const assert = require('node:assert/strict');

// Versioned acceptance proposal, deliberately independent of mutable diagnostic
// defaults. A changed workload requires a new protocol and explicit review.
const protocol = 'server-steady-v1';
const workload = Object.freeze({ preconditioning: 1200, warm: 200, storms: 5,
    connectionsPerStorm: 1200, batchSize: 50, settleMs: 400 });
const phases = Object.freeze([['preconditioning', 1200], ['warm', 200],
    ...Array.from({ length: 5 }, (_, index) => [`storm-${index + 1}`, 1200])]);
const positive = value => Number.isSafeInteger(value) && value > 0;
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** Validate evidence before interpreting it; no sampling, retries or tuning. */
function evaluate(report) {
    // IPC and saved reports are JSON data. Normalize native IPC object prototypes
    // before strict shape checks when a test coordinator lives in a Node VM.
    report = JSON.parse(JSON.stringify(report));
    assert.equal(report.protocol, protocol);
    assert.equal(report.candidateOnly, true);
    assert.deepEqual(report.workload, workload);
    assert(positive(report.coordinatorPid), 'Invalid coordinator identity');
    assert.equal(report.deliveryAndCleanupPassed, true);
    assert.equal(report.fingerprintPassed, true);
    assert(Object.keys(report.sourceHashes).length > 0, 'Missing input identities');
    assert(Object.values(report.sourceHashes).every(digest), 'Invalid input digest');
    assert.deepEqual(report.finalSourceHashes, report.sourceHashes, 'Measured inputs changed');
    assert.equal(report.workerOutput.truncated, false);
    const logs = ['client.stderr.log', 'client.stdout.log', 'server.stderr.log', 'server.stdout.log'];
    assert.deepEqual(Object.keys(report.outputFiles).sort(), logs);
    for (const log of Object.values(report.outputFiles)) {
        assert.equal(log.complete, true);
        assert(Number.isSafeInteger(log.bytes) && log.bytes >= 0, 'Invalid output size');
        assert(digest(log.sha256), 'Invalid output digest');
    }
    assert.equal(report.samples.length, phases.length);
    assert.equal(report.workerExits.length, 2);
    const identities = report.samples[0];
    assert.equal(new Set([report.coordinatorPid, identities.server.pid, identities.client.pid]).size, 3);
    let cumulative = 0;
    report.samples.forEach((sample, index) => {
        const [phase, count] = phases[index];
        cumulative += count;
        assert.equal(sample.phase, phase, 'Unexpected recovery phase');
        for (const role of ['server', 'client']) {
            const observed = sample[role];
            assert(positive(observed.pid), 'Invalid worker identity');
            assert.equal(observed.pid, identities[role].pid);
            assert.match(observed.node, /^v\d+\.\d+\.\d+$/);
            assert.equal(observed.node, identities.server.node);
            assert.equal(typeof observed.v8, 'string');
            assert(observed.v8.length > 0, 'Missing V8 identity');
            assert.equal(observed.v8, identities.server.v8);
            assert.deepEqual(observed.execArgv, ['--expose-gc']);
            assert(positive(observed.memory.heapUsed), 'Invalid retained heap');
            assert.equal(observed.received, cumulative, 'Incomplete delivery');
            assert.equal(observed.sent, role === 'client' ? cumulative : 0);
            assert.deepEqual(observed.registries, role === 'server'
                ? { clients: 0, rooms: 0, sessions: 0 } : { clients: 0 });
        }
    });
    for (const [index, role] of ['server', 'client'].entries()) {
        assert.deepEqual(report.workerExits[index], { role, pid: identities[role].pid,
            exitCode: 0, signalCode: null, forcedCleanupNeeded: false,
            stdoutClosed: true, stderrClosed: true });
    }
    const storms = report.samples.slice(2);
    const ratios = role => storms.map(sample => ({ phase: sample.phase,
        percentOfWarm: sample[role].memory.heapUsed * 100 / report.samples[1][role].memory.heapUsed }));
    const server = ratios('server');
    const client = ratios('client');
    // Compare integer byte counts exactly: 1100 / 1000 * 100 is slightly above
    // 110 in floating point, and multiplying arbitrary safe integers loses bits.
    return { candidatePassed: storms.every(sample => BigInt(sample.server.memory.heapUsed) * 100n
        <= BigInt(report.samples[1].server.memory.heapUsed) * 110n),
        maximumServerPercentOfWarm: 110, server, client,
        clientHeapBudgetEnforced: false, exactReplies: cumulative };
}

module.exports = { protocol, workload, phases, evaluate };
