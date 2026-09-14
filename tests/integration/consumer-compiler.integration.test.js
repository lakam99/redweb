'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { compileConsumer } = require('../../scripts/lib/compile-consumer');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');

const root = path.resolve(__dirname, '../..');

test('real compiler errors retain diagnostics and source until workspace cleanup', async () => {
    const execution = new VerificationWorkspace();
    await execution.run(async owner => {
        const source = path.join(owner.directory, 'invalid.ts');
        fs.writeFileSync(source, 'export const count: number = "invalid";');
        const target = path.join(owner.directory, 'failed consumer with spaces');
        await expect(compileConsumer(root, owner, target, source, { experimentalDecorators: false }))
            .rejects.toThrow('TS2322');
        expect(fs.readFileSync(path.join(target, 'consumer.ts'), 'utf8')).toBe(fs.readFileSync(source, 'utf8'));
    });
    expect(fs.existsSync(execution.directory)).toBe(false);
}, 45000);
