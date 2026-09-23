'use strict';

const { protocol, workload, phases } = require('../../scripts/lib/ServerRecoveryPolicy');

// Synthetic policy inputs only; integration tests must use actual worker reports.
function evidence() {
    let total = 0;
    const sample = (pid, sent, received, registries) => ({ pid, node: 'v22.21.0', v8: '12.4',
        execArgv: ['--expose-gc'], memory: { heapUsed: 1000 }, sent, received, registries });
    return { protocol, workload, candidateOnly: true, coordinatorPid: 1,
        deliveryAndCleanupPassed: true, fingerprintPassed: true,
        sourceHashes: { input: 'a'.repeat(64) }, finalSourceHashes: { input: 'a'.repeat(64) },
        workerOutput: { truncated: false }, outputFiles: Object.fromEntries(
            ['server', 'client'].flatMap(role => ['stdout', 'stderr'].map(stream =>
                [`${role}.${stream}.log`, { complete: true, bytes: 0, sha256: 'b'.repeat(64) }]))),
        samples: phases.map(([phase, count]) => {
            total += count;
            return { phase, server: sample(2, 0, total, { clients: 0, rooms: 0, sessions: 0 }),
                client: sample(3, total, total, { clients: 0 }) };
        }),
        workerExits: ['server', 'client'].map((role, index) => ({ role, pid: index + 2,
            exitCode: 0, signalCode: null, forcedCleanupNeeded: false, stdoutClosed: true, stderrClosed: true })) };
}

module.exports = { evidence };
