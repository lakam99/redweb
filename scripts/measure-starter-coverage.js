'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { createCoverageMap } = require('istanbul-lib-coverage');
const { npmEntrypoint } = require('./evaluation/process');
const { VerificationWorkspace } = require('./lib/VerificationWorkspace');
const { reportCommand } = require('./lib/reportCommand');
const { finishVerificationSummary } = require('./lib/finishVerificationSummary');
const { linkApplication } = require('./lib/verify-starter');
const { projectFiles, TEMPLATES } = require('../src/cli/templates');

async function main() {
    const root = path.resolve(__dirname, '..');
    const runId = randomUUID();
    const output = path.join(root, 'coverage/starters');
    const runDirectory = path.join(output, runId);
    fs.mkdirSync(runDirectory, { recursive: true });
    const summary = { runId, status: 'running', node: process.version, platform: process.platform,
        typescript: require('typescript/package.json').version, c8: require('c8/package.json').version,
        startedAt: new Date().toISOString(), applications: {} };
    const persist = () => {
        fs.writeFileSync(path.join(runDirectory, 'summary.json'), JSON.stringify(summary, null, 2));
        fs.writeFileSync(path.join(output, 'latest.json'), JSON.stringify({ runId, status: summary.status }, null, 2));
    };
    persist();
    const hash = value => createHash('sha256').update(value).digest('hex');
    let failure;
    try { await new VerificationWorkspace().run(async execution => {
        assert.ok(TEMPLATES.length, 'Starter inventory must not be empty');
        for (const template of TEMPLATES) {
            const project = path.join(execution.directory, template);
            const target = path.join(runDirectory, template);
            fs.mkdirSync(target);
            await execution.command([path.join(root, 'bin/redweb.js'), 'init', project, '--template', template, '--json']);
            const inputFiles = projectFiles(require('../package.json').version, template);
            const inputs = Object.fromEntries(inputFiles.map(file => [file.path, hash(fs.readFileSync(path.join(project, file.path)))]));
            const expected = inputFiles.filter(file => /^src\/.*\.tsx?$/.test(file.path))
                .map(file => path.resolve(project, file.path)).sort();
            assert.ok(expected.length, 'Starter source inventory must not be empty');
            const manifest = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'));
            linkApplication(root, project, template, manifest);
            // Execute the actual generated command while TypeScript source is present.
            // The existing package gate separately verifies source-free deployment.
            const retainedReport = path.join(target, 'coverage-final.json');
            const testOutput = await reportCommand(execution, [npmEntrypoint(), 'run', 'test:coverage'], { cwd: project },
                path.join(project, 'coverage/coverage-final.json'), retainedReport);
            fs.writeFileSync(path.join(target, 'test-output.txt'), testOutput);
            const report = fs.readFileSync(retainedReport, 'utf8');
            const map = createCoverageMap(JSON.parse(report));
            const actual = map.files().map(file => path.resolve(file)).sort();
            if (JSON.stringify(actual) !== JSON.stringify(expected) || actual.some(file =>
                !Object.keys(map.fileCoverageFor(file).statementMap).length)) {
                throw new Error(`${template}: coverage must contain every generated TypeScript module and no unrelated modules.`);
            }
            assert.deepEqual(Object.fromEntries(inputFiles.map(file => [file.path, hash(fs.readFileSync(path.join(project, file.path)))])), inputs,
                'Measurement must retain identical application and test inputs');
            summary.applications[template] = { coverage: map.getCoverageSummary().toJSON(), reportSha256: hash(report),
                testOutputSha256: hash(testOutput),
                inputs,
                sources: Object.fromEntries(expected.map(file => [path.relative(project, file).replaceAll('\\', '/'), hash(fs.readFileSync(file))])) };
            persist();
            console.log(`${template}: ${JSON.stringify(summary.applications[template].coverage)}`);
        }
    }); } catch (error) {
        failure = error;
        summary.error = error.message;
        if (error.retainedWorkspace) summary.retainedWorkspace = error.retainedWorkspace;
    }
    finishVerificationSummary(summary, persist, failure, 'measured');
    console.log('Application coverage measured; uncovered counters remain gaps, not a passing 100% release gate.');
}

module.exports = { main };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
