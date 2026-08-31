'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { assertLifecycleCoverage, main } = require('../../scripts/verify-starter-lifecycle');

test('actual c8 can exit successfully with an empty map, which lifecycle acceptance rejects', () =>
    new VerificationWorkspace().run(async owner => {
        const report = path.join(owner.directory, 'reports');
        await owner.command([require.resolve('c8/bin/c8.js'), '--all', '--src=.', '--include=missing.js',
            '--reporter=json', `--reports-dir=${report}`, '--check-coverage', '--lines=100', '--branches=100',
            '--functions=100', '--statements=100', process.execPath, '-e', 'void 0'], { timeoutMs: 10000 });
        const coverage = JSON.parse(fs.readFileSync(path.join(report, 'coverage-final.json'), 'utf8'));
        expect(coverage).toEqual({});
        expect(() => assertLifecycleCoverage(coverage, path.join(owner.directory, 'dist/run-app.js')))
            .toThrow('exactly the deployed run-app module');
    }), 30000);

test('actual source-free starter lifecycle passes a nonempty complete coverage gate', async () => {
    // Direct ownership lets each bounded child settle before its fixture is removed.
    // No compiler, subprocess, filesystem or network API is replaced.
    await main();
}, 240000); // Three 30s starter commands + 120s c8 + managed cleanup.
