'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { createCoverageMap } = require('istanbul-lib-coverage');
const { npmEntrypoint } = require('./evaluation/process');
const { VerificationWorkspace } = require('./lib/VerificationWorkspace');
const { reportCommand } = require('./lib/reportCommand');
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
    let failure;
    try { await new VerificationWorkspace().run(async execution => {
        for (const template of TEMPLATES) {
            const project = path.join(execution.directory, template);
            const target = path.join(runDirectory, template);
            fs.mkdirSync(target);
            await execution.command([path.join(root, 'bin/redweb.js'), 'init', project, '--template', template, '--json']);
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
            const expected = projectFiles(require('../package.json').version, template)
                .filter(file => /^src\/.*\.tsx?$/.test(file.path))
                .map(file => path.resolve(project, file.path)).sort();
            const actual = map.files().map(file => path.resolve(file)).sort();
            if (JSON.stringify(actual) !== JSON.stringify(expected) || actual.some(file =>
                !Object.keys(map.fileCoverageFor(file).statementMap).length)) {
                throw new Error(`${template}: coverage must contain every generated TypeScript module and no unrelated modules.`);
            }
            const hash = value => createHash('sha256').update(value).digest('hex');
            summary.applications[template] = { coverage: map.getCoverageSummary().toJSON(), reportSha256: hash(report),
                testOutputSha256: hash(testOutput),
                inputs: Object.fromEntries(projectFiles(require('../package.json').version, template)
                    .map(file => [file.path, hash(fs.readFileSync(path.join(project, file.path)))])),
                sources: Object.fromEntries(expected.map(file => [path.relative(project, file).replaceAll('\\', '/'), hash(fs.readFileSync(file))])) };
            persist();
            console.log(`${template}: ${JSON.stringify(summary.applications[template].coverage)}`);
        }
    }); } catch (error) {
        failure = error;
        summary.error = error.message;
        if (error.retainedWorkspace) summary.retainedWorkspace = error.retainedWorkspace;
    }
    summary.status = failure ? 'failed' : 'measured';
    summary.finishedAt = new Date().toISOString();
    try { persist(); }
    catch (error) { failure = failure ? new AggregateError([failure, error], 'Measurement and evidence recording failed') : error; }
    if (failure) throw failure;
    console.log('Application coverage measured; uncovered counters remain gaps, not a passing 100% release gate.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
