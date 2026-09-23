'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const ts = require('typescript');
const { npmEntrypoint } = require('./evaluation/process');
const { VerificationWorkspace } = require('./lib/VerificationWorkspace');
const { verificationError } = require('./lib/verificationError');
const { reportCommand } = require('./lib/reportCommand');
const { finishVerificationSummary } = require('./lib/finishVerificationSummary');
const { linkApplication } = require('./lib/verify-starter');
const { projectFiles, TEMPLATES } = require('../src/cli/templates');
const ApplicationCoverage = require('./lib/ApplicationCoverage');

async function main() {
    const root = path.resolve(__dirname, '..');
    const runId = randomUUID();
    const output = path.join(root, 'coverage/starter-source');
    const runDirectory = path.join(output, runId);
    fs.mkdirSync(runDirectory, { recursive: true });
    const summary = { runId, status: 'running', node: process.version, platform: process.platform,
        typescript: ts.version, instrumenter: require('istanbul-lib-instrument/package.json').version,
        startedAt: new Date().toISOString(), applications: {} };
    const persist = () => {
        fs.writeFileSync(path.join(runDirectory, 'summary.json'), JSON.stringify(summary, null, 2));
        fs.writeFileSync(path.join(output, 'latest.json'), JSON.stringify({ runId, status: summary.status }, null, 2));
    };
    const hash = value => createHash('sha256').update(value).digest('hex');
    persist();
    let failure, incomplete;
    try { await new VerificationWorkspace().run(async execution => {
        assert.ok(TEMPLATES.length, 'Starter inventory must not be empty');
        for (const template of TEMPLATES) {
            const project = path.join(execution.directory, template);
            const target = path.join(runDirectory, template);
            fs.mkdirSync(target);
            await execution.command([path.join(root, 'bin/redweb.js'), 'init', project, '--template', template, '--json']);
            const files = projectFiles(require('../package.json').version, template);
            const inputs = Object.fromEntries(files.map(file => [file.path, hash(fs.readFileSync(path.join(project, file.path)))]));
            const manifest = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'));
            linkApplication(root, project, template, manifest);
            // A real tsc build and the unchanged shipped test command pass first.
            const retainedV8 = path.join(target, 'v8-coverage.json');
            const plain = await reportCommand(execution, [npmEntrypoint(), 'run', 'test:coverage'], { cwd: project },
                path.join(project, 'coverage/coverage-final.json'), retainedV8);
            fs.writeFileSync(path.join(target, 'plain.txt'), plain);
            const v8Report = fs.readFileSync(retainedV8, 'utf8');
            const config = ts.getParsedCommandLineOfConfigFile(path.join(project, 'tsconfig.json'), {}, {
                ...ts.sys, onUnRecoverableConfigFileDiagnostic: error => { throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n')); },
            });
            if (config.errors.length) throw new Error(ts.formatDiagnostics(config.errors, ts.createCompilerHost(config.options)));
            const sources = Object.fromEntries(files.filter(file => /^src\/.*\.tsx?$/.test(file.path))
                .map(file => [path.resolve(project, file.path), fs.readFileSync(path.join(project, file.path), 'utf8')]));
            assert.deepEqual(Object.keys(JSON.parse(v8Report)).sort(), Object.keys(sources).sort(), 'V8 and authored coverage must measure the same original modules');
            const coverage = new ApplicationCoverage(sources, config.options);
            for (const [filename, compiled] of Object.entries(coverage.compiled)) {
                const target = path.join(project, 'dist', path.relative(path.join(project, 'src'), filename).replace(/\.tsx?$/, '.js'));
                fs.writeFileSync(target, compiled);
            }
            const reports = path.join(project, 'source-coverage');
            fs.mkdirSync(reports);
            const preload = path.join(root, 'scripts/lib/record-application-coverage.cjs');
            const retainedWorkers = path.join(target, 'process-reports');
            const instrumented = await reportCommand(execution, ['--test', 'test/app.test.cjs', 'test/lifecycle.test.cjs',
                ...(template === 'dashboard' ? ['test/rate-window.test.cjs'] : [])], { cwd: project, environment: {
                    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require ${JSON.stringify(preload)}`,
                    REDWEB_APPLICATION_COVERAGE_DIRECTORY: reports,
                } }, reports, retainedWorkers);
            fs.writeFileSync(path.join(target, 'instrumented.txt'), instrumented);
            const reportFiles = fs.readdirSync(retainedWorkers).sort();
            if (!reportFiles.length) throw new Error(`${template}: no actual process coverage reports`);
            for (const filename of reportFiles) coverage.collect(JSON.parse(fs.readFileSync(path.join(retainedWorkers, filename), 'utf8')));
            const report = JSON.stringify({ ...coverage.report(), compilerOptions: config.options,
                instrumentedSha256: Object.fromEntries(Object.entries(coverage.compiled).map(([filename, source]) => [filename, hash(source)])) }, null, 2);
            fs.writeFileSync(path.join(target, 'coverage.json'), report);
            assert.deepEqual(Object.fromEntries(files.map(file => [file.path, hash(fs.readFileSync(path.join(project, file.path)))])), inputs,
                'Plain and instrumented runs must retain identical application and test inputs');
            summary.applications[template] = { coverage: coverage.report().summary, reportSha256: hash(report),
                plainSha256: hash(plain), instrumentedSha256: hash(instrumented), v8ReportSha256: hash(v8Report), receivedProcessReports: reportFiles.length, inputs };
            try { coverage.assertComplete(); }
            catch (error) { incomplete = verificationError(error); summary.applications[template].error = incomplete.message; }
            persist();
            console.log(`${template}: ${JSON.stringify(summary.applications[template].coverage)}`);
        }
    }); } catch (error) {
        failure = verificationError(error);
        summary.error = failure.message;
        if (failure.retainedWorkspace) summary.retainedWorkspace = failure.retainedWorkspace;
    }
    if (!failure && incomplete) { failure = incomplete; summary.error = failure.message; }
    finishVerificationSummary(summary, persist, failure, 'passed');
    console.log('All six original-TypeScript coverage gates passed; compiler-generated code remains measured separately by c8.');
}

module.exports = { main };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
