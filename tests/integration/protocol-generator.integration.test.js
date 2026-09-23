'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { verifyScript } = require('../helpers/script-coverage');
const root = path.resolve(__dirname, '../..');

test('protocol generator writes exact types and rejects missing or stale output without modifying it', async () => {
    const script = 'scripts/generate-protocol-types.js';
    await verifyScript({ script, testFile: __filename,
        prepare(workspace) {
            for (const file of [script, 'src/ws/protocol-schema.json']) {
                fs.mkdirSync(path.dirname(path.join(workspace, file)), { recursive: true });
                fs.copyFileSync(path.join(root, file), path.join(workspace, file));
            }
        },
        async exercise(workspace, run) {
            const target = path.join(workspace, 'client.d.ts');
            await expect(run(['--check'])).rejects.toThrow('client.d.ts is stale');
            expect(fs.existsSync(target)).toBe(false);
            expect(await run([])).toBe('');
            const generated = fs.readFileSync(target, 'utf8');
            expect(generated).toBe(fs.readFileSync(path.join(root, 'client.d.ts'), 'utf8').replace(/\r\n/g, '\n'));
            expect(await run(['--check'])).toBe('');
            fs.writeFileSync(target, generated.replace(/\n/g, '\r\n'));
            expect(await run(['--check'])).toBe('');
            fs.writeFileSync(target, '// stale output\n');
            await expect(run(['--check'])).rejects.toThrow('client.d.ts is stale');
            expect(fs.readFileSync(target, 'utf8')).toBe('// stale output\n');
            await run([]);
            expect(fs.readFileSync(target, 'utf8')).toBe(generated);
            expect(await run(['--check'])).toBe('');
        },
    });
}, 120000);
