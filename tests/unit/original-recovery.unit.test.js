'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { OriginalRecoveryBoundary } = require('../helpers/OriginalRecoveryBoundary');
const { withTimeout } = require('../helpers/network');

async function boundary(options, assertion) {
    await new VerificationWorkspace().run(async owner => {
        if (options.prepare) options.prepare(owner.directory);
        const environment = typeof options.environment === 'function' ? options.environment(owner.directory) : options.environment;
        const probe = new OriginalRecoveryBoundary(owner.directory, { ...options, environment });
        try {
            await withTimeout(probe.done, 'unit recovery completion', 2000);
            // Observe the CLI catch after the synthetic shutdown has returned.
            await new Promise(setImmediate);
            await assertion(probe, owner.directory);
        } finally { probe.collect(); }
    });
}

const small = { REDWEB_RECOVERY_PROTOCOL: 'cold-v1', REDWEB_RECOVERY_WARM_CONNECTIONS: '2',
    REDWEB_RECOVERY_STORM_CONNECTIONS: '4', REDWEB_RECOVERY_BATCH_SIZE: '2' };

test.each([
    [{}, 'steady-v2', 7400, 5],
    [small, 'cold-v1', 6, 1],
])('original protocol defaults preserve the declared workload: %j', async (environment, protocol, connections, rounds) => {
    await boundary({ environment, delayedListening: true, delayedCleanup: true }, probe => {
        expect(probe.initializationError).toBeUndefined(); expect(probe.stderr).toBe('');
        const report = JSON.parse(probe.stdout);
        expect(report).toMatchObject({ protocol, stormRounds: rounds, diagnosticOnly: false,
            registries: { clients: 0, rooms: 0, sessions: 0 }, recoveredHeapPercentOfWarm: 100 });
        expect(report.cycles).toHaveLength(rounds);
        expect(probe.sent.map(message => message.id)).toEqual(Array.from({ length: connections }, (_, index) => index));
        expect(probe.replies).toEqual(probe.sent.map(({ id }) => ({ ready: id })));
        expect(probe.stops).toBe(1);
        expect(report).not.toHaveProperty('diagnostics');
        if (protocol === 'cold-v1') expect(report).not.toHaveProperty('preconditioning');
        else expect(report.preconditioning.phase).toBe('preconditioning');
    });
});

test.each([
    [{ REDWEB_RECOVERY_PROTOCOL: 'unknown' }, 'REDWEB_RECOVERY_PROTOCOL must be cold-v1 or steady-v2.'],
    [{ REDWEB_RECOVERY_STORM_ROUNDS: '4' }, 'REDWEB_RECOVERY_STORM_ROUNDS must be a safe integer of at least 5.'],
    [{ REDWEB_RECOVERY_STORM_ROUNDS: '1.5' }, 'REDWEB_RECOVERY_STORM_ROUNDS must be a safe integer of at least 5.'],
    [{ REDWEB_RECOVERY_WARM_CONNECTIONS: '0' }, 'REDWEB_RECOVERY_WARM_CONNECTIONS must be a positive safe integer.'],
    [{ REDWEB_RECOVERY_STORM_CONNECTIONS: 'NaN' }, 'REDWEB_RECOVERY_STORM_CONNECTIONS must be a positive safe integer.'],
    [{ REDWEB_RECOVERY_BATCH_SIZE: '-1' }, 'REDWEB_RECOVERY_BATCH_SIZE must be a positive safe integer.'],
    [{ REDWEB_RECOVERY_WARM_CONNECTIONS: String(Number.MAX_SAFE_INTEGER) }, 'Combined recovery connection count must be a safe integer.'],
    [{ REDWEB_RECOVERY_BATCH_SIZE: String(Number.MAX_SAFE_INTEGER) }, 'Recovery connection capacity must be a safe integer.'],
    [{ REDWEB_RECOVERY_HEAP_DIRECTORY: 'relative' }, 'Heap snapshots require diagnostics and an absolute REDWEB_RECOVERY_HEAP_DIRECTORY.'],
    [{ REDWEB_RECOVERY_DIAGNOSTICS: '1', REDWEB_RECOVERY_HEAP_DIRECTORY: 'relative' }, 'Heap snapshots require diagnostics and an absolute REDWEB_RECOVERY_HEAP_DIRECTORY.'],
])('invalid original measurement configuration fails before opening a server: %j', async (environment, message) => {
    await boundary({ environment }, probe => {
        expect(probe.initializationError.message).toBe(message);
        expect(probe.serverSettings).toBeUndefined(); expect(probe.stdout).toBe('');
    });
});

test('original measurement requires explicit garbage collection', async () => {
    await boundary({ noGc: true }, probe => {
        expect(probe.initializationError.message).toBe('Run with node --expose-gc scripts/verify-recovery.js.');
        expect(probe.serverSettings).toBeUndefined();
    });
});

test.each([false, true])('diagnostic records remain non-enumerable; snapshot capture enabled=%s', async snapshots => {
    await boundary({ environment: directory => ({ ...small, REDWEB_RECOVERY_PROTOCOL: 'steady-v2',
        REDWEB_RECOVERY_DIAGNOSTICS: '1', ...(snapshots ? { REDWEB_RECOVERY_HEAP_DIRECTORY: directory } : {}) }) }, (probe, directory) => {
        expect(probe.stderr).toBe('');
        const report = JSON.parse(probe.stdout);
        expect(report.diagnosticOnly).toBe(true);
        expect(Object.keys(report.diagnostics)).toEqual(['warm', 'storm-1', 'storm-2', 'storm-3', 'storm-4', 'storm-5', 'recovered']);
        expect(probe.captures.map(file => path.basename(file))).toEqual(snapshots ? ['warm.heapsnapshot', 'storm-3.heapsnapshot', 'recovered.heapsnapshot'] : []);
        expect(fs.readdirSync(directory).sort()).toEqual(snapshots ? ['recovered.heapsnapshot', 'storm-3.heapsnapshot', 'warm.heapsnapshot'] : []);
        const record = probe.context.diagnosticRecord({ value: 1 });
        expect(Object.keys(record)).toEqual(['value']);
        expect(record.__redwebRecoveryDiagnostic).toMatch(/^123:/);
        expect(probe.stdout).not.toContain('__redwebRecoveryDiagnostic');
        expect(probe.stops).toBe(1);
    });
});

test('the third and final cold storm does not request an extra snapshot', async () => {
    await boundary({ environment: directory => ({ ...small, REDWEB_RECOVERY_STORM_ROUNDS: '3',
        REDWEB_RECOVERY_DIAGNOSTICS: '1', REDWEB_RECOVERY_HEAP_DIRECTORY: directory }) }, probe => {
        expect(probe.stderr).toBe('');
        expect(probe.captures.map(file => path.basename(file))).toEqual(['warm.heapsnapshot', 'recovered.heapsnapshot']);
        expect(JSON.parse(probe.stdout).cycles).toHaveLength(3);
    });
});

test('snapshot paths cannot overwrite an existing private file', async () => {
    await boundary({ prepare: directory => fs.writeFileSync(path.join(directory, 'warm.heapsnapshot'), 'existing private fixture'),
        environment: directory => ({ ...small, REDWEB_RECOVERY_DIAGNOSTICS: '1', REDWEB_RECOVERY_HEAP_DIRECTORY: directory }) }, (probe, directory) => {
        expect(probe.context.process.exitCode).toBe(1);
        expect(probe.stderr).toContain('EEXIST'); expect(probe.stdout).toBe('');
        expect(fs.readFileSync(path.join(directory, 'warm.heapsnapshot'), 'utf8')).toBe('existing private fixture');
        expect(probe.captures).toEqual([]); expect(probe.stops).toBe(1);
    });
});

test.each(['openFailure', 'messageFailure', 'stuckClients', 'stuckRooms', 'primitiveFailure'])('original CLI rejects %s and shuts down its server', async mode => {
    await boundary({ environment: small, [mode]: true, ...(mode === 'primitiveFailure' ? { openFailure: true } : {}) }, probe => {
        expect(probe.context.process.exitCode).toBe(1); expect(probe.stdout).toBe('');
        expect(probe.stderr).toContain(mode === 'stuckClients' ? 'server-side connection cleanup timed out'
            : mode === 'stuckRooms' ? 'Recovery registries did not empty after warm'
                : mode === 'primitiveFailure' ? 'unit primitive failure' : 'unit recovery failure');
        expect(probe.stops).toBe(1);
    });
});

test('original 110-percent budget still fails and retains its measured output', async () => {
    await boundary({ environment: small, heapGrowth: true }, probe => {
        expect(JSON.parse(probe.stdout).recoveredHeapPercentOfWarm).toBe(120);
        expect(probe.stderr).toContain('Reconnect recovery exceeded its cleanup or retained-heap budget.');
        expect(probe.context.process.exitCode).toBe(1); expect(probe.stops).toBe(1);
    });
});

test('exactly 110 percent is within the declared original budget', async () => {
    await boundary({ environment: small, heaps: [1000, 1100] }, probe => {
        expect(JSON.parse(probe.stdout).recoveredHeapPercentOfWarm).toBeCloseTo(110, 12);
        expect(probe.stderr).toBe(''); expect(probe.context.process.exitCode).toBeUndefined();
        expect(probe.stops).toBe(1);
    });
});

test('an intermediate over-budget storm still fails after final recovery', async () => {
    await boundary({ environment: { ...small, REDWEB_RECOVERY_STORM_ROUNDS: '3' }, heaps: [1000, 1110, 1090, 1000] }, probe => {
        const report = JSON.parse(probe.stdout);
        expect(report.recoveredHeapPercentOfWarm).toBe(100);
        expect(report.cycles[0].recoveredHeapPercentOfWarm).toBeCloseTo(111, 12);
        expect(probe.stderr).toContain('Reconnect recovery exceeded its cleanup or retained-heap budget.');
        expect(probe.context.process.exitCode).toBe(1); expect(probe.stops).toBe(1);
    });
});

test.each([
    [1000, 1101, false],
    [1000000000000030, 1100000000000033, true],
    [1000000000000030, 1100000000000034, false],
])('byte budget comparison preserves the exact boundary (%s to %s bytes)', async (warm, recovered, accepted) => {
    // Large synthetic counters expose multiplication rounding, not a claim
    // that native V8 can allocate heaps this large on the tested machine.
    await boundary({ environment: small, heaps: [warm, recovered] }, probe => {
        expect(JSON.parse(probe.stdout)).toMatchObject({ warmedHeap: warm, recoveredHeap: recovered });
        expect(probe.context.process.exitCode).toBe(accepted ? undefined : 1);
        expect(probe.stderr.includes('Reconnect recovery exceeded')).toBe(!accepted);
        expect(probe.stops).toBe(1);
    });
});
