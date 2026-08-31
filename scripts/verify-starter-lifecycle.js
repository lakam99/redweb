'use strict';

const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createCoverageMap } = require('istanbul-lib-coverage');
const { VerificationWorkspace } = require('./lib/VerificationWorkspace');
const { verifyStarter } = require('./lib/verify-starter');
const { reportCommand } = require('./lib/reportCommand');

function assertLifecycleCoverage(report, expected) {
    const coverage = createCoverageMap(report);
    const files = coverage.files();
    assert.ok(files.length === 1 && files[0] === expected, 'Lifecycle coverage must contain exactly the deployed run-app module');
    const summary = coverage.getCoverageSummary();
    for (const metric of ['statements', 'branches', 'functions', 'lines']) {
        const value = summary[metric];
        assert.ok(value.total > 0 && value.pct === 100, `Lifecycle ${metric} coverage must be nonempty and complete`);
    }
}

async function main() {
    const root = path.resolve(__dirname, '..');
    const retained = path.join(root, 'coverage/starter-lifecycle', randomUUID());
    fs.mkdirSync(retained, { recursive: true });
    const output = await new VerificationWorkspace().run(async execution => {
        // All templates copy this exact helper and test; verifyStarter also checks
        // the generated commands and then removes src/ from the deployed layout.
        await verifyStarter(root, execution, 'realtime');
        const project = path.join(execution.directory, 'realtime');
        // Measure emitted JS explicitly; c8 otherwise follows maps to removed TS.
        // Keep both byte identities and remove only the trailing metadata comment.
        const compiled = path.join(project, 'dist/run-app.js');
        const deployed = fs.readFileSync(compiled, 'utf8');
        const measured = deployed.replace(/\r?\n\/\/# sourceMappingURL=run-app\.js\.map(?:\r?\n)?$/, '');
        assert.notEqual(measured, deployed, 'Expected the generated trailing lifecycle source-map directive');
        fs.copyFileSync(compiled, path.join(retained, 'deployed-run-app.js'));
        fs.copyFileSync(compiled + '.map', path.join(retained, 'deployed-run-app.js.map'));
        fs.writeFileSync(path.join(retained, 'measured-run-app.js'), measured);
        fs.writeFileSync(compiled, measured);
        const reports = path.join(project, 'coverage/lifecycle');
        const report = path.join(retained, 'coverage-final.json');
        const output = await reportCommand(execution, [
            require.resolve('c8/bin/c8.js'), '--all', '--src=dist', '--include=dist/run-app.js',
            '--reporter=text', '--reporter=json', `--reports-dir=${reports}`,
            '--check-coverage', '--lines=100', '--branches=100', '--functions=100', '--statements=100',
            process.execPath, '--test', 'test/run-app.test.cjs',
        ], { cwd: project }, path.join(reports, 'coverage-final.json'), report);
        fs.writeFileSync(path.join(retained, 'test-output.txt'), output);
        assert.equal(fs.readFileSync(compiled, 'utf8'), measured, 'Lifecycle executable content changed during coverage');
        assertLifecycleCoverage(JSON.parse(fs.readFileSync(report, 'utf8')), path.join(project, 'dist/run-app.js'));
        return output;
    });
    console.log(output);
}

module.exports = { main, assertLifecycleCoverage };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
