'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { summarize, compare } = require('../../scripts/diagnostics/recovery-heap-summary.cjs');

const script = path.resolve(__dirname, '../../scripts/verify-recovery.js');
const configured = {
    REDWEB_RECOVERY_WARM_CONNECTIONS: '2',
    REDWEB_RECOVERY_STORM_CONNECTIONS: '4',
    REDWEB_RECOVERY_BATCH_SIZE: '2',
    REDWEB_RECOVERY_DIAGNOSTICS: '0',
    REDWEB_RECOVERY_PROTOCOL: 'cold-v1',
};

test.each(Object.keys(configured).filter(name => /_CONNECTIONS$|_BATCH_SIZE$/.test(name)))(
    'rejects invalid %s before opening a recovery server', async name => {
        await new VerificationWorkspace().run(async owner => {
            for (const value of ['', '0', '-1', '1.5', 'invalid', 'Infinity', '9007199254740992']) {
                await expect(owner.command(['--expose-gc', script], {
                    environment: { ...configured, [name]: value }, timeoutMs: 10000,
                })).rejects.toThrow(`${name} must be a positive safe integer`);
            }
        });
    }, 90000);

test.each([
    [{ REDWEB_RECOVERY_WARM_CONNECTIONS: String(Number.MAX_SAFE_INTEGER) }, 'Combined recovery connection count'],
    [{ REDWEB_RECOVERY_BATCH_SIZE: String(Number.MAX_SAFE_INTEGER) }, 'Recovery connection capacity'],
])('rejects unsafe derived capacities: %s', async (override, message) => {
    await new VerificationWorkspace().run(async owner => {
        await expect(owner.command(['--expose-gc', script], { environment: { ...configured, ...override }, timeoutMs: 10000 }))
            .rejects.toThrow(message);
    });
}, 15000);

test.each(['0', '1'])('actual recovery traffic and optional native diagnostics (enabled=%s)', async enabled => {
    await new VerificationWorkspace().run(async owner => {
        const output = await owner.command(['--expose-gc', script], {
            environment: { ...configured, REDWEB_RECOVERY_DIAGNOSTICS: enabled }, timeoutMs: 15000,
        });
        const result = JSON.parse(output);
        expect(result).toMatchObject({ warmConnections: 2, stormConnections: 4, registries: { clients: 0, rooms: 0, sessions: 0 } });
        expect(result.protocol).toBe('cold-v1');
        expect(result.cycles).toHaveLength(1);
        expect(result.recoveredHeapPercentOfWarm).toBeLessThanOrEqual(110);
        if (enabled === '0') expect(result).not.toHaveProperty('diagnostics');
        else {
            for (const sample of Object.values(result.diagnostics)) {
                expect(sample.spaces.map(space => space.space_name)).toEqual(expect.arrayContaining(['old_space', 'code_space']));
                expect(sample.code.code_and_metadata_size).toBeGreaterThan(0);
                expect(sample.memory.heapUsed).toBeGreaterThan(0);
            }
        }
    });
}, 20000);

test('private native heap snapshots produce only fixed-label aggregates and never overwrite files', async () => {
    await new VerificationWorkspace().run(async owner => {
        const environment = { ...configured, REDWEB_RECOVERY_DIAGNOSTICS: '1', REDWEB_RECOVERY_HEAP_DIRECTORY: owner.directory };
        await owner.command(['--expose-gc', script], { environment, timeoutMs: 20000 });
        const warm = path.join(owner.directory, 'warm.heapsnapshot');
        const recovered = path.join(owner.directory, 'recovered.heapsnapshot');
        const before = fs.readFileSync(warm);
        const output = JSON.parse(await owner.command([path.resolve(__dirname, '../../scripts/diagnostics/recovery-heap-summary.cjs'), warm, recovered]));
        expect(output.diagnosticOnly).toBe(true);
        expect(output.groups.find(group => group.group === 'type:code').warm.count).toBeGreaterThan(0);
        expect(output.groups.find(group => group.group === 'object:WebSocket')?.delta.count ?? 0).toBe(0);
        expect(JSON.stringify(output)).not.toContain(owner.directory);
        await expect(owner.command(['--expose-gc', script], { environment, timeoutMs: 10000 })).rejects.toThrow('EEXIST');
        expect(fs.readFileSync(warm).equals(before)).toBe(true);
    });
}, 45000);

test('snapshot collection requires explicit diagnostics and an absolute directory', async () => {
    await new VerificationWorkspace().run(async owner => {
        for (const override of [
            { REDWEB_RECOVERY_HEAP_DIRECTORY: owner.directory },
            { REDWEB_RECOVERY_DIAGNOSTICS: '1', REDWEB_RECOVERY_HEAP_DIRECTORY: 'relative' },
        ]) {
            await expect(owner.command(['--expose-gc', script], { environment: { ...configured, ...override }, timeoutMs: 10000 }))
                .rejects.toThrow('Heap snapshots require diagnostics and an absolute REDWEB_RECOVERY_HEAP_DIRECTORY');
        }
    });
}, 25000);

test('aggregate unit cases redact arbitrary labels and reject malformed metadata', () => {
    const fixture = { snapshot: { meta: { node_fields: ['type', 'name', 'self_size'], node_types: [['object', 'unrecognized']] } },
        strings: ['private credential value', 'Socket'], nodes: [0, 0, 16, 0, 1, 32, 1, 0, 8] };
    const groups = summarize(fixture);
    expect(groups).toEqual({ 'type:object': { count: 1, selfBytes: 16 }, 'object:Socket': { count: 1, selfBytes: 32 }, 'type:other': { count: 1, selfBytes: 8 } });
    expect(JSON.stringify(groups)).not.toContain('private credential');
    expect(compare(groups, {})).toEqual(expect.arrayContaining([{ group: 'object:Socket', warm: { count: 1, selfBytes: 32 }, recovered: { count: 0, selfBytes: 0 }, delta: { count: -1, selfBytes: -32 } }]));
    expect(compare({}, groups)[0].warm).toEqual({ count: 0, selfBytes: 0 });
    expect(() => summarize({ ...fixture, nodes: [0] })).toThrow();
    expect(() => summarize({ ...fixture, nodes: [0, 0, -1] })).toThrow();
    for (const nodes of [[2, 0, 1], [-1, 0, 1], [0.5, 0, 1], [0, 2, 1], [0, -1, 1], [0, 0.5, 1]]) {
        expect(() => summarize({ ...fixture, nodes })).toThrow();
    }
    expect(() => summarize({ ...fixture, strings: {} })).toThrow();
    expect(() => summarize({ ...fixture, snapshot: { meta: { node_fields: {}, node_types: [] } } })).toThrow();
});

test.each(['steady-v2', undefined])('fixed protocol uses five storms against one baseline (selection=%s)', async protocol => {
    await new VerificationWorkspace().run(async owner => {
        const result = JSON.parse(await owner.command(['--expose-gc', script], {
            environment: { ...configured, REDWEB_RECOVERY_PROTOCOL: protocol }, timeoutMs: 20000,
        }));
        expect(result).toMatchObject({ protocol: 'steady-v2', preconditioningConnections: 4, stormRounds: 5 });
        expect(result.cycles).toHaveLength(5);
        for (const phase of [result.preconditioning, result.warm, ...result.cycles]) {
            expect(phase.registries).toEqual({ clients: 0, rooms: 0, sessions: 0 });
            expect(phase.heap).toBeGreaterThan(0);
        }
        for (const cycle of result.cycles) expect(cycle.recoveredHeapPercentOfWarm).toBe(cycle.heap / result.warmedHeap * 100);
        expect(result.recoveredHeap).toBe(result.cycles[4].heap);
        await expect(owner.command(['--expose-gc', script], {
            environment: { ...configured, REDWEB_RECOVERY_PROTOCOL: 'adaptive' }, timeoutMs: 10000,
        })).rejects.toThrow('REDWEB_RECOVERY_PROTOCOL must be cold-v1 or steady-v2');
    });
}, 35000);

test('extended protocol preserves its baseline and cannot reduce the declared storm count', async () => {
    await new VerificationWorkspace().run(async owner => {
        const environment = { ...configured, REDWEB_RECOVERY_PROTOCOL: 'steady-v2' };
        for (const value of ['', '0', '2', '3', '4', '3.5', 'invalid', 'Infinity', '9007199254740992']) {
            await expect(owner.command(['--expose-gc', script], {
                environment: { ...environment, REDWEB_RECOVERY_STORM_ROUNDS: value }, timeoutMs: 10000,
            })).rejects.toThrow('REDWEB_RECOVERY_STORM_ROUNDS must be a safe integer of at least 5');
        }
        const result = JSON.parse(await owner.command(['--expose-gc', script], {
            environment: { ...environment, REDWEB_RECOVERY_STORM_ROUNDS: '7' }, timeoutMs: 20000,
        }));
        expect(result.cycles).toHaveLength(7);
        for (const cycle of result.cycles) expect(cycle.recoveredHeapPercentOfWarm).toBe(cycle.heap / result.warmedHeap * 100);
    });
}, 95000);
