'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { seal } = require('../../scripts/evaluation/seal');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { FrozenCoverage } = require('../helpers/FrozenCoverage');
const { evaluationFixture, write, hash, retainTrialFailure } = require('../helpers/evaluation-fixture');
const root = path.resolve(__dirname, '../..');
const filename = path.join(root, 'scripts/evaluation/run-trial.js');
const resultFile = evidence => path.join(evidence, 'independent-submission-1.json');

async function fixture(mode, operation) {
    await new VerificationWorkspace().run(async owner => {
        const build = mode === 'build-failure' ? 'process.exitCode = 2;' : [
            "const fs = require('fs'); fs.mkdirSync('dist');",
            "fs.copyFileSync('src/app.js', 'dist/app.js'); fs.copyFileSync('src/page.html', 'dist/page.html');",
            ...(mode === 'mutation' ? ["fs.appendFileSync('src/app.js', '\\n// changed by build'); process.exitCode = 2;"] : []),
        ].join('\n');
        const fixture = evaluationFixture(owner.directory, {
            'package.json': { private: true, scripts: { build: 'node build.cjs' } },
            'build.cjs': build,
            'src/app.js': fs.readFileSync(path.join(root, 'scripts/evaluation/fixtures/app.js'), 'utf8'),
            'src/page.html': fs.readFileSync(path.join(root, 'scripts/evaluation/fixtures/page.html'), 'utf8'),
        });
        // Copy the real WebSocket dependency; no source-checkout resolution fallback.
        fs.cpSync(path.dirname(require.resolve('ws/package.json')), path.join(fixture.application, 'node_modules/ws'), { recursive: true });
        seal(fixture.evidence);
        const coverage = new FrozenCoverage(owner.directory, 'scripts/evaluation/run-trial.js');
        const invoke = () => owner.command([filename, fixture.evidence, fixture.application], { timeoutMs: 120000,
            rejectTruncatedOutput: true, environment: { ...coverage.environment,
                TEMP: owner.directory, TMP: owner.directory, TMPDIR: owner.directory, EVALUATION_FAULT: '' } })
            .catch(error => { throw retainTrialFailure(owner, fixture.evidence, error); });
        await operation({ ...fixture, owner, invoke });
        coverage.collect();
    });
}

(process.platform === 'win32' ? test : test.skip)('the real trial CLI checks the actual protocol control in isolated browsers and removes its execution', async () => {
    await fixture('working', async ({ evidence, application, invoke }) => {
        const report = JSON.parse(await invoke());
        expect(report).toEqual(JSON.parse(fs.readFileSync(resultFile(evidence), 'utf8')));
        expect(report.passed).toBe(true);
        expect(report.checks).toHaveLength(10);
        expect(report.checks.every(check => check.passed)).toBe(true);
        expect(report.notRun).toEqual([]);
        expect(report.browser.browserVersions).toHaveLength(3);
        expect(report.inputs.verifiedInstalledFiles).toBe(1);
        expect(report.inputs.sealSha256).toBe(hash(path.join(evidence, 'seal.json')));
        expect(report.compiledAppSha256).toBe(hash(path.join(application, 'src/app.js')));
        expect(fs.existsSync(report.root)).toBe(false);
        expect(report.cleanupError).toBeUndefined();
    });
}, 150000);

test.each(['build-failure', 'mutation'])('the real trial CLI preserves %s evidence and exits unsuccessfully', async mode => {
    await fixture(mode, async ({ evidence, application, invoke }) => {
        await expect(invoke()).rejects.toThrow('Package verification command failed (1)');
        const report = JSON.parse(fs.readFileSync(resultFile(evidence), 'utf8'));
        expect(report.passed).toBe(false);
        expect(report.error).toBe('Independent production build failed.');
        expect(report.build.exitCode).toBe(2);
        expect(report.inputs.verifiedInstalledFiles).toBe(1);
        expect(report.cleanupError).toBeUndefined();
        expect(fs.existsSync(report.root)).toBe(false);
        if (mode === 'mutation') {
            expect(report.evidenceError).toContain('Live submission differs');
            expect(report.compiledAppSha256).toBe(hash(path.join(application, 'src/app.js')));
        } else {
            expect(report.evidenceError).toBeUndefined();
            expect(report.compiledAppSha256).toBeUndefined();
        }
    });
}, 30000);

test('the real trial CLI refuses tampered installed input before writing a result', async () => {
    await fixture('build-failure', async ({ evidence, application, invoke }) => {
        write(path.join(application, 'node_modules/redweb/index.js'), 'tampered candidate');
        await expect(invoke()).rejects.toThrow('Installed candidate file differs');
        expect(fs.existsSync(resultFile(evidence))).toBe(false);
    });
});
