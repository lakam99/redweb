'use strict';

const { workload, evaluate } = require('../../scripts/lib/ServerRecoveryPolicy');
const { preflight } = require('../../scripts/lib/ServerRecoveryCandidate');
const { evidence } = require('../fixtures/server-recovery-evidence.cjs');

test('fixed server limit includes exactly 110%; client memory is explicitly informational', () => {
    const report = evidence();
    report.samples[3].server.memory.heapUsed = 1100;
    report.samples[4].client.memory.heapUsed = 5000;
    expect(evaluate(report)).toMatchObject({ candidatePassed: true, exactReplies: 7400,
        maximumServerPercentOfWarm: 110, clientHeapBudgetEnforced: false });
    report.samples[3].server.memory.heapUsed = 1101;
    expect(evaluate(report).candidatePassed).toBe(false);
    expect(evaluate(report).server.at(-1).percentOfWarm).toBe(100);
    expect(evaluate(report).client[2].percentOfWarm).toBe(500);
});

test.each([
    r => { r.protocol = 'other'; }, r => { r.candidateOnly = false; },
    r => { r.workload = { ...workload, warm: 201 }; }, r => { r.coordinatorPid = 0; },
    r => { r.deliveryAndCleanupPassed = false; }, r => { r.fingerprintPassed = false; },
    r => { r.sourceHashes = {}; }, r => { r.sourceHashes.input = 12; },
    r => { r.sourceHashes.input = 'not-a-hash'; }, r => { r.finalSourceHashes.input = 'c'.repeat(64); },
    r => { r.workerOutput.truncated = true; }, r => { delete r.outputFiles['client.stderr.log']; },
    r => { r.outputFiles['client.stdout.log'].complete = false; },
    r => { r.outputFiles['client.stdout.log'].bytes = 1.5; },
    r => { r.outputFiles['client.stdout.log'].bytes = -1; },
    r => { r.outputFiles['client.stdout.log'].sha256 = ''; },
    r => { r.samples.pop(); }, r => { r.workerExits.pop(); },
    r => { r.samples[0].server.pid = 1; }, r => { r.samples[2].phase = 'warm'; },
    r => { r.samples[0].server.pid = -1; }, r => { r.samples[2].server.pid = 4; },
    r => { r.samples[2].client.node = 'v20.1.0'; }, r => { r.samples[2].server.node = 'bad'; },
    r => { r.samples[0].server.v8 = 2; }, r => { r.samples[0].server.v8 = ''; },
    r => { r.samples[2].client.v8 = 'other'; }, r => { r.samples[2].server.execArgv.push('--jitless'); },
    r => { r.samples[2].server.memory.heapUsed = NaN; },
    r => { r.samples[2].server.memory.heapUsed = 0; },
    r => { r.samples[2].client.received--; }, r => { r.samples[2].client.sent--; },
    r => { r.samples[2].server.received--; }, r => { r.samples[2].server.registries.sessions = 1; },
    r => { r.workerExits[0].exitCode = 1; }, r => { r.workerExits[1].signalCode = 'SIGTERM'; },
    r => { r.workerExits[0].forcedCleanupNeeded = true; }, r => { r.workerExits[1].stdoutClosed = false; },
])('malformed, incomplete or corrupted evidence cannot pass (%#)', corrupt => {
    const report = evidence();
    corrupt(report);
    expect(() => evaluate(report)).toThrow();
});

test('candidate preflight refuses instrumentation and tuning instead of silently normalizing it', () => {
    expect(() => preflight({ PATH: 'ordinary', NODE_OPTIONS: '', NODE_V8_COVERAGE: '' }, [])).not.toThrow();
    for (const name of ['NODE_OPTIONS', 'NODE_V8_COVERAGE', 'REDWEB_RECOVERY_BATCH_SIZE', 'REDWEB_RECOVERY_DIAGNOSTICS',
        'node_options', 'node_v8_coverage', 'redweb_recovery_batch_size']) {
        expect(() => preflight({ [name]: '1' }, [])).toThrow(`Candidate does not accept ${name}`);
    }
    expect(() => preflight({}, ['--inspect'])).toThrow('Candidate coordinator does not accept Node flags');
    expect(() => preflight({}, 'not-an-array')).toThrow('Candidate coordinator does not accept Node flags');
});
