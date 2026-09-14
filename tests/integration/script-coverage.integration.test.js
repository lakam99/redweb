'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { verifyScript } = require('../helpers/script-coverage');
const root = path.resolve(__dirname, '../..');
const script = 'tests/fixtures/coverage-script.cjs';
function prepare(workspace) {
    const target = path.join(workspace, script);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, script), target);
}

test.each([undefined, null, false, 0, ''])('unit fault: script verifier rejects a thrown %p without losing its cause', async value => {
    let failure;
    try { await verifyScript({ script, testFile: __filename, prepare, exercise() { throw value; } }); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect(failure.cause).toBe(value);
});

test.each(['missing', 'duplicate', 'plain'])('real command evidence rejects %s process reports', async mode => {
    await expect(verifyScript({ script, testFile: __filename, prepare,
        async exercise(_workspace, run) {
            const directory = await run([]);
            const files = fs.readdirSync(directory);
            if (files.length && mode === 'missing') fs.unlinkSync(path.join(directory, files[0]));
            if (files.length && mode === 'duplicate') fs.copyFileSync(path.join(directory, files[0]), path.join(directory, 'duplicate.json'));
            if (!files.length && mode === 'plain') fs.writeFileSync(path.join(directory, 'unexpected.json'), '{}', { flag: 'wx' });
        },
    })).rejects.toThrow('unexpected coverage report count');
}, 30000);

test('real command evidence associates every instrumented invocation with one validated report', async () => {
    const result = await verifyScript({ script, testFile: __filename, prepare,
        async exercise(_workspace, run) { await run([]); await run(['again']); },
    });
    expect(result.passed).toBe(true);
    expect(result.receivedProcessReports).toBe(2);
    expect(result.commands.instrumented.every(command => command.coverageReport.sha256.length === 64)).toBe(true);
}, 45000);
