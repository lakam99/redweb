'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const root = path.resolve(__dirname, '../..');
const client = fs.realpathSync(path.join(root, 'node_modules/redweb-client'));

for (const mode of ['instrumented-command', 'invalid-coverage']) test(
`actual client worker evidence survives ${mode} and temporary workspace cleanup`, { timeout: 300000 }, () =>
    new VerificationWorkspace().run(async owner => {
        const repository = path.join(owner.directory, 'repository');
        const checkout = path.join(owner.directory, 'client');
        fs.mkdirSync(repository);
        fs.cpSync(path.join(root, 'scripts'), path.join(repository, 'scripts'), { recursive: true });
        for (const directory of ['src', 'tests', 'examples', 'recipes', 'config', 'docs']) {
            fs.symlinkSync(path.join(root, directory), path.join(repository, directory), 'junction');
        }
        for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
            if (entry.isFile() && /\.(?:[cm]?js|json|ts)$/.test(entry.name)) fs.copyFileSync(path.join(root, entry.name), path.join(repository, entry.name));
        }
        fs.mkdirSync(path.join(repository, 'node_modules'));
        for (const entry of fs.readdirSync(path.join(root, 'node_modules'), { withFileTypes: true })) {
            if (entry.name !== 'redweb-client' && entry.isDirectory()) {
                fs.symlinkSync(path.join(root, 'node_modules', entry.name), path.join(repository, 'node_modules', entry.name), 'junction');
            }
        }
        for (const directory of ['src', 'tests', 'dist']) fs.mkdirSync(path.join(checkout, directory), { recursive: true });
        fs.symlinkSync(path.join(client, 'node_modules'), path.join(checkout, 'node_modules'), 'junction');
        fs.symlinkSync(checkout, path.join(repository, 'node_modules/redweb-client'), 'junction');
        fs.writeFileSync(path.join(checkout, 'package.json'), JSON.stringify({ name: 'redweb-client', type: 'module', main: './dist/index.cjs' }));
        fs.writeFileSync(path.join(checkout, 'dist/index.cjs'), 'module.exports = {};');
        fs.writeFileSync(path.join(checkout, 'src/value.ts'), 'export const value = 1;');
        fs.writeFileSync(path.join(checkout, 'tsconfig.json'), '{}');
        fs.writeFileSync(path.join(checkout, 'vitest.config.ts'), `import fs from 'node:fs'; import path from 'node:path';
fs.writeFileSync(${JSON.stringify(path.join(checkout, 'workspace.txt'))}, path.dirname(process.argv[process.argv.indexOf('--config') + 1]));
export default { test: { include: ['tests/*.test.ts'], minWorkers: 1, maxWorkers: 1 } };`);
        // Deliberately faulty test input, not mocked compiler/process/filesystem APIs.
        fs.writeFileSync(path.join(checkout, 'tests/value.test.ts'), `import { test, expect } from 'vitest';
import { value } from '../src/value';
test('real instrumented worker', () => {
    expect(value).toBe(1);
    if (process.env.REDWEB_CLIENT_INSTRUMENTED === '1') {
        ${mode === 'instrumented-command' ? "throw new Error('intentional worker failure');" : 'globalThis.__redwebApplicationCoverage__ = undefined;'}
    }
});`);
        const script = path.join(repository, 'scripts/verify-client-source-coverage.js');
        assert.equal(fs.readFileSync(script, 'utf8'), fs.readFileSync(path.join(root, 'scripts/verify-client-source-coverage.js'), 'utf8'));
        const { main } = require(script);
        // Invoke the actual coordinator in-process: its own bounded commands own
        // cleanup, so an outer process deadline cannot strand detached children.
        const failure = await main([]).catch(error => error);
        if (failure?.retainedWorkspace) owner.cleanupFailure = failure;
        assert.ok(require('node:util').types.isNativeError(failure));
        const expectedError = mode === 'instrumented-command' ? 'command failed (1)' : 'did not execute instrumented source';
        assert.ok(failure.message.includes(expectedError), failure.message);
        const runs = path.join(repository, 'coverage/client-source');
        const entries = fs.readdirSync(runs);
        assert.equal(entries.length, 1);
        const output = path.join(runs, entries[0]);
        assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'plain-tests.json'), 'utf8')).success, true);
        const instrumented = JSON.parse(fs.readFileSync(path.join(output, 'instrumented-tests.json'), 'utf8'));
        assert.equal(instrumented.success, mode !== 'instrumented-command');
        if (mode === 'instrumented-command') assert.ok(JSON.stringify(instrumented).includes('intentional worker failure'));
        const workers = fs.readdirSync(path.join(output, 'workers'));
        assert.equal(workers.length, 1);
        const worker = JSON.parse(fs.readFileSync(path.join(output, 'workers', workers[0]), 'utf8'));
        assert.equal(worker.test, 'tests/value.test.ts');
        if (mode === 'instrumented-command') assert.deepEqual(Object.keys(worker.coverage), ['src/value.ts']);
        else assert.deepEqual(worker.coverage, {});
        const summary = JSON.parse(fs.readFileSync(path.join(output, 'summary.json'), 'utf8'));
        assert.equal(summary.status, 'failed');
        assert.ok(summary.error.includes(expectedError));
        assert.equal(summary.retainedWorkspace, undefined);
        const workspace = fs.readFileSync(path.join(checkout, 'workspace.txt'), 'utf8');
        assert.equal(fs.existsSync(workspace), false, 'The actual worker workspace must be removed, not retained to make this test pass.');
    })); // Two existing 120s commands plus cleanup; no outer subprocess kill.
