'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { MemoryMeasurement } = require('../../scripts/lib/MemoryMeasurement');
const worker = path.resolve(__dirname, '../../scripts/memory-worker.js');
const coordinator = path.resolve(__dirname, '../../scripts/verify-memory-overhead.js');

test('real memory workers measure every feature mode and exit after owned socket/server cleanup', async () => {
    const owner = new VerificationWorkspace();
    const policy = new MemoryMeasurement({ REDWEB_MEMORY_CLIENTS: '4' });
    await owner.run(async () => {
        for (const mode of ['legacy', 'context', 'transport', 'heartbeat', 'rooms', 'sessions', 'drain', 'protocol', 'enabled']) {
            const output = await owner.command(['--expose-gc', worker, mode, '4'], { timeoutMs: 10000 });
            expect(policy.decode(output, mode).count).toBe(4);
        }
    });
    expect(fs.existsSync(owner.directory)).toBe(false);
}, 120000);

test('real memory commands reject invalid workloads instead of reporting a zero-cost pass', () =>
    new VerificationWorkspace().run(async owner => {
        for (const count of ['0', '-1', '1.5', 'NaN', 'Infinity', '9007199254740991']) {
            await expect(owner.command(['--expose-gc', worker, 'legacy', count], { timeoutMs: 5000 }))
                .rejects.toThrow('positive safe integer');
            await expect(owner.command([coordinator], { timeoutMs: 5000,
                environment: { REDWEB_MEMORY_CLIENTS: count } })).rejects.toThrow('positive safe integer');
        }
        await expect(owner.command(['--expose-gc', worker, 'unknown', '4'], { timeoutMs: 5000 })).rejects.toThrow('Unsupported');
        await expect(owner.command([worker, 'legacy', '4'], { timeoutMs: 5000 })).rejects.toThrow('--expose-gc');
    }), 100000);

test('real coordinator consumes six isolated worker reports in a small functional fixture', () =>
    new VerificationWorkspace().run(async owner => {
        const output = await owner.command([coordinator], { timeoutMs: 400000, environment: {
            REDWEB_MEMORY_CLIENTS: '4', REDWEB_MEMORY_TRIALS: '3', REDWEB_MEMORY_MAX_BYTES: '1000000000',
        } });
        const result = JSON.parse(output);
        expect(result.connections).toBe(4);
        expect(result.trials).toBe(3);
        expect(Number.isFinite(result.legacyBytesPerConnection)).toBe(true);
        expect(Number.isFinite(result.enabledBytesPerConnection)).toBe(true);
        expect(result.frameworkMetadataBytesPerConnection).toBe(result.enabledBytesPerConnection - result.legacyBytesPerConnection);
        expect(result.maximumFrameworkMetadataBytesPerConnection).toBe(1000000000);
        // This deliberately small fixture checks mechanics, not the 500-client acceptance budget.
    }), 425000); // Six 60s owned workers, followed by owner cleanup before the outer supervisor.
