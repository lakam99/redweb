'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { ClientSourceCoverage, hash, slash } = require('./lib/ClientSourceCoverage');
const { VerificationWorkspace } = require('./lib/VerificationWorkspace');
const { verificationError } = require('./lib/verificationError');
const { reportCommand } = require('./lib/reportCommand');
const { finishVerificationSummary } = require('./lib/finishVerificationSummary');

async function main(args = process.argv.slice(2)) {
    const clientRoot = ClientSourceCoverage.resolveCheckout(require.resolve.paths('redweb-client'));
    if (ClientSourceCoverage.validateCheckout(clientRoot, args)) {
        console.log('Matching linked client checkout verified.');
        return;
    }
    assert.equal(fs.realpathSync(path.join(path.dirname(require.resolve('redweb-client')), '..')), clientRoot,
        'Client export must resolve inside the checked checkout dist directory.');
    const { runBrowserChecks } = require('./verify-browser-coverage');
    const clientRequire = createRequire(path.join(clientRoot, 'package.json'));
    const source = new ClientSourceCoverage(clientRoot);
    const coverage = source.coverage;
    const root = path.resolve(__dirname, '..');
    const tooling = Object.fromEntries(Object.keys(require.cache).filter(filename => filename.startsWith(root + path.sep) &&
        !filename.includes(path.sep + 'node_modules' + path.sep)).sort()
        .map(filename => [slash(path.relative(root, filename)), hash(fs.readFileSync(filename))]));
    const run = { id: randomUUID(), startedAt: new Date().toISOString(), status: 'running',
        node: process.version, platform: process.platform, inputs: source.inputs, linkage: source.linkage, tooling,
        typescript: require('typescript').version, instrumenter: require('istanbul-lib-instrument/package.json').version,
        scope: 'Original client TS/JS, shared Node and Chromium instrumentation; not exhaustive optional-chain/V8 branch coverage' };
    const output = path.resolve(__dirname, '../coverage/client-source', run.id);
    fs.mkdirSync(output, { recursive: true });
    const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2));
    let failure;
    try {
        await new VerificationWorkspace().run(async execution => {
            const compiled = path.join(execution.directory, 'compiled.json');
            fs.writeFileSync(compiled, JSON.stringify(coverage.compiled));
            fs.symlinkSync(path.join(clientRoot, 'node_modules'), path.join(execution.directory, 'node_modules'), 'junction');
            // Record raw bytes outside the disposable workspace, even when a
            // worker fails or its report cannot be parsed or collected.
            const reports = path.join(output, 'workers');
            fs.mkdirSync(reports);
            const setup = path.join(execution.directory, 'record.mjs');
            fs.writeFileSync(setup, `import { afterAll, expect } from 'vitest';
import fs from 'node:fs'; import path from 'node:path'; import { createHash } from 'node:crypto';
globalThis.__redwebApplicationCoverage__ = undefined;
afterAll(() => {
    const test = path.relative(${JSON.stringify(clientRoot)}, expect.getState().testPath).replaceAll('\\\\', '/');
    const filename = createHash('sha256').update(test).digest('hex') + '.json';
    fs.writeFileSync(path.join(${JSON.stringify(reports)}, filename), JSON.stringify({ test,
        coverage: globalThis.__redwebApplicationCoverage__ || {} }), { flag: 'wx' });
});`);
            const config = path.join(execution.directory, 'vitest.config.mjs');
            fs.writeFileSync(config, `import base from ${JSON.stringify(pathToFileURL(path.join(clientRoot, 'vitest.config.ts')).href)};
import fs from 'node:fs'; import path from 'node:path';
const compiled = JSON.parse(fs.readFileSync(${JSON.stringify(compiled)}, 'utf8'));
const instrumented = process.env.REDWEB_CLIENT_INSTRUMENTED === '1';
export default { ...base, plugins: [...(base.plugins || []), { name: 'original-client-coverage', enforce: 'pre',
transform(_source, id) { const key = path.relative(${JSON.stringify(clientRoot)}, id.split('?')[0]).replaceAll('\\\\', '/');
    if (instrumented && Object.hasOwn(compiled, key)) return { code: compiled[key], map: null }; }
}], test: { ...base.test, coverage: { ...base.test.coverage, enabled: false },
setupFiles: [...(base.test.setupFiles || []), ...(instrumented ? [${JSON.stringify(setup)}] : [])] } };`);
            const outcomes = [];
            for (const instrumented of [false, true]) {
                const name = instrumented ? 'instrumented' : 'plain';
                const reportFile = path.join(execution.directory, `${name}.json`);
                const retainedReport = path.join(output, `${name}-tests.json`);
                const log = await reportCommand(execution, [clientRequire.resolve('vitest/vitest.mjs'), 'run', '--config', config,
                    '--root', clientRoot, '--reporter=json', '--outputFile', reportFile], { cwd: clientRoot,
                    environment: { REDWEB_CLIENT_INSTRUMENTED: instrumented ? '1' : '0' } }, reportFile, retainedReport);
                const report = JSON.parse(fs.readFileSync(retainedReport, 'utf8'));
                run[name + 'LogSha256'] = hash(log);
                outcomes.push(source.outcomes(report));
            }
            assert.deepEqual(outcomes[0], outcomes[1], 'Plain and instrumented client tests must agree');
            source.unchanged();
            const workers = fs.readdirSync(reports).map(name => JSON.parse(fs.readFileSync(path.join(reports, name), 'utf8')));
            save('workers.json', workers);
            source.collectWorkers(workers);
            save('node.json', coverage.report());
            run.nodeTests = outcomes[0];
            run.workerReports = workers.length;

            const esbuild = clientRequire('esbuild');
            run.esbuild = esbuild.version;
            const frontends = { transport: {} };
            for (const instrumented of [false, true]) {
                const name = instrumented ? 'instrumented' : 'plain';
                const result = await esbuild.build({ absWorkingDir: clientRoot, entryPoints: ['src/live-html.ts', 'src/index.ts'],
                    outdir: path.join(execution.directory, 'browser-' + name),
                    bundle: true, write: false, format: 'esm', target: 'es2022', platform: 'browser',
                    plugins: instrumented ? [{ name: 'original-client-coverage', setup(build) {
                        build.onLoad({ filter: /\.[jt]s$/ }, args => {
                            const key = slash(path.relative(clientRoot, args.path));
                            if (Object.hasOwn(coverage.compiled, key)) return { contents: coverage.compiled[key], loader: 'js' };
                        });
                    } }] : [] });
                assert.deepEqual(result.outputFiles.map(file => path.basename(file.path)).sort(), ['index.js', 'live-html.js'],
                    'Each client entry must be self-contained');
                frontends[name] = result.outputFiles.find(file => path.basename(file.path) === 'live-html.js').text;
                frontends.transport[name] = result.outputFiles.find(file => path.basename(file.path) === 'index.js').text;
                fs.writeFileSync(path.join(output, name + '.js'), frontends[name]);
                fs.writeFileSync(path.join(output, name + '-transport.js'), frontends.transport[name]);
            }
            for (const [entry, candidate] of [['live-html.js', frontends.plain], ['index.js', frontends.transport.plain]]) {
                assert.equal(candidate, fs.readFileSync(path.join(clientRoot, 'dist', entry), 'utf8'),
                    'Source-built plain candidate must equal the linked production build; rebuild the client first');
            }
            run.browser = {};
            const browserReports = [];
            await runBrowserChecks({ mode: 'source', frontends, run: run.browser,
                coverage: { collect(report) { coverage.collect(report); browserReports.push(report); } } });
            assert.equal(browserReports.length, 1, 'The covered browser realm must report exactly once');
            save('browser.json', browserReports[0]);
            run.browserBundleHashes = { plain: hash(frontends.plain), instrumented: hash(frontends.instrumented) };
            run.transportBundleHashes = { plain: hash(frontends.transport.plain), instrumented: hash(frontends.transport.instrumented) };
            source.unchanged();
            for (const [filename, digest] of Object.entries(tooling)) {
                assert.equal(hash(fs.readFileSync(path.join(root, filename))), digest, 'Verification tooling changed during execution');
            }
            coverage.assertComplete();
        });
    } catch (error) {
        failure = verificationError(error);
        run.retainedWorkspace = failure.retainedWorkspace;
    }
    run.endedAt = new Date().toISOString();
    try {
        finishVerificationSummary(run, () => {
            save('coverage.json', coverage.report());
            save('summary.json', run);
        }, failure, 'passed');
    } catch (error) {
        failure = error;
    }
    console.log(JSON.stringify({ ...run, inputs: undefined, tooling: undefined, nodeTests: undefined, coverage: coverage.report().summary }, null, 2));
    if (failure) throw failure;
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { main };
