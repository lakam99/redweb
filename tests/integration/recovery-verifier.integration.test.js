'use strict';

const path = require('node:path');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');

const script = path.resolve(__dirname, '../../scripts/verify-recovery.js');
const configured = {
    REDWEB_RECOVERY_WARM_CONNECTIONS: '2',
    REDWEB_RECOVERY_STORM_CONNECTIONS: '4',
    REDWEB_RECOVERY_BATCH_SIZE: '2',
    REDWEB_RECOVERY_DIAGNOSTICS: '0',
};

test.each(Object.keys(configured).filter(name => name !== 'REDWEB_RECOVERY_DIAGNOSTICS'))(
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
