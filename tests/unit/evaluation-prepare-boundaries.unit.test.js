'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createInstrumenter } = require('istanbul-lib-instrument');
const { createCoverageMap } = require('istanbul-lib-coverage');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const filename = path.resolve(__dirname, '../../scripts/evaluation/prepare.js');

// Explicit subprocess-boundary units, not native npm/git/tar execution.
test.each([
    [{ status: null, error: new Error('launch failure'), stderr: 'secondary', stdout: 'last' }, 'launch failure'],
    [{ status: 1, stderr: 'stderr failure', stdout: 'last' }, 'stderr failure'],
    [{ status: 1, stderr: '', stdout: 'stdout failure' }, 'stdout failure'],
])('preparation preserves command failure precedence: %p', async (result, message) => {
    await new VerificationWorkspace().run(async owner => {
        const nativeRequire = createRequire(filename), calls = [];
        const requireBoundary = name => {
            if (name === 'os') return { tmpdir: () => owner.directory };
            if (name === 'child_process') return { spawnSync: (...args) => { calls.push(args); return result; } };
            return nativeRequire(name);
        };
        const context = { require: requireBoundary, module: { exports: {} }, __dirname: path.dirname(filename),
            process: { platform: 'linux' } };
        vm.runInNewContext(createInstrumenter().instrumentSync(fs.readFileSync(filename, 'utf8'), filename), context, { filename });
        try {
            expect(() => context.module.exports.prepare(owner.directory)).toThrow(`npm failed: ${result.error ? 'Error: ' : ''}${message}`);
            expect(calls).toHaveLength(1);
            expect(calls[0][0]).toBe('npm');
            expect(calls[0][1].slice(0, 3)).toEqual(['pack', '--json', '--pack-destination']);
            expect(calls[0][2]).toMatchObject({ encoding: 'utf8', windowsHide: true, cwd: owner.directory, shell: false, timeout: 60000 });
        } finally {
            if (process.argv.includes('--collectCoverageFrom=scripts/evaluation/prepare.js')) {
                const map = createCoverageMap(globalThis.__coverage__ || {}); map.merge(context.__coverage__);
                globalThis.__coverage__ ||= {}; globalThis.__coverage__[filename] = map.fileCoverageFor(filename).toJSON();
            }
        }
    });
});
