'use strict';

const path = require('node:path');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const script = path.resolve(__dirname, '../../scripts/verify-jsx-performance.js');

test('native JSX performance command rejects missing GC and renders all 10000 rows', () => new VerificationWorkspace().run(async owner => {
    await expect(owner.command([script], { timeoutMs: 10000 })).rejects.toThrow('--expose-gc');
    const output = await owner.command(['--expose-gc', script], { timeoutMs: 30000, rejectTruncatedOutput: true });
    expect(output).toMatch(/^JSX performance gate passed: 10000 component rows in \d+\.\dms; \d+\.\d MiB retained\.\s*$/);
}), 80000);
