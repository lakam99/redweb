'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createInstrumenter } = require('istanbul-lib-instrument');
const { createCoverageMap } = require('istanbul-lib-coverage');
const { hash, slash } = require('../../scripts/lib/ClientSourceCoverage');

const root = path.resolve(__dirname, '../..');
const filename = path.join(root, 'scripts/verify-client-source-coverage.js');
const modes = ['pass', 'import', 'preflight', 'invalid-link', 'export-link', 'initial-write',
    'plain-command', 'instrumented-command', 'missing-report', 'malformed-report', 'inventory',
    'changed-source', 'missing-workers', 'malformed-worker', 'collection', 'workers-write', 'node-write',
    'plain-build', 'instrumented-build', 'outputs', 'bundle', 'browser', 'browser-zero', 'browser-many',
    'browser-collection', 'browser-write', 'changed-tooling', 'incomplete', 'falsy', 'retained',
    'coverage-write', 'summary-write', 'combined-write', 'retained-write', 'transient-summary-write'];

// Explicit dependency-boundary units. Real Vitest/filesystem/process tests and
// the unchanged full client/browser gate remain separate, not simulated here.
test.each(modes)('client source coordinator unit: %s', async mode => {
    const checkout = path.join(root, 'unit-client');
    const workspace = path.join(root, 'unit-client-workspace');
    const output = path.join(root, 'coverage/client-source/unit-run');
    const files = new Map([[filename, 'unit tooling'],
        [path.join(checkout, 'dist/live-html.js'), 'plain live'],
        [path.join(checkout, 'dist/index.js'), 'plain transport']]);
    const writes = [], commands = [], printed = [], errors = [];
    const primary = new Error('unit operation failed');
    const writeFailure = new Error('unit write failed');
    let reports, unchanged = 0, finished, failedWrite = false;
    const completion = new Promise(resolve => { finished = resolve; });
    const fakeFs = {
        mkdirSync(directory) {
            if (directory === output && mode === 'initial-write') throw writeFailure;
            if (path.basename(directory) === 'workers') reports = directory;
        },
        symlinkSync() {},
        realpathSync: value => value,
        readFileSync(file, encoding) {
            if (!files.has(file)) throw new Error(`Missing unit file: ${file}`);
            return encoding ? String(files.get(file)) : Buffer.from(String(files.get(file)));
        },
        readdirSync(directory) {
            return [...files.keys()].filter(file => path.dirname(file) === directory).map(file => path.basename(file));
        },
        writeFileSync(file, value) {
            const failAt = { 'workers-write': 'workers.json', 'node-write': 'node.json',
                'browser-write': 'browser.json', 'coverage-write': 'coverage.json',
                'summary-write': 'summary.json', 'combined-write': 'coverage.json', 'retained-write': 'summary.json',
                'transient-summary-write': 'summary.json' }[mode];
            if (path.basename(file) === failAt && (mode !== 'transient-summary-write' || !failedWrite)) {
                failedWrite = true; throw writeFailure;
            }
            files.set(file, String(value)); writes.push(file);
        },
    };
    const coverage = {
        compiled: { 'src/live-html.ts': 'instrumented live source', 'src/index.ts': 'instrumented transport source' },
        collect() { if (mode === 'browser-collection') throw primary; },
        report: () => ({ summary: { unit: 'authored scope' } }),
        assertComplete() { if (mode === 'incomplete') throw primary; },
    };
    class Source {
        static resolveCheckout(paths) { expect(paths).toEqual(['unit modules']); return checkout; }
        static validateCheckout(directory, args) {
            expect(directory).toBe(checkout); expect(args).toEqual([]);
            if (mode === 'invalid-link') throw primary;
            return mode === 'preflight';
        }
        constructor(directory) {
            expect(directory).toBe(checkout);
            this.coverage = coverage; this.inputs = { 'src/live-html.ts': 'unit hash' }; this.linkage = {};
        }
        outcomes(report) { return mode === 'inventory' ? report.mode : ['same test']; }
        unchanged() { unchanged++; if (mode === 'changed-source') throw primary; }
        collectWorkers(workers) {
            expect(workers).toEqual(mode === 'missing-workers' ? [] : [{ test: 'unit', coverage: {} }]);
            if (['missing-workers', 'collection'].includes(mode)) throw primary;
        }
    }
    const execution = { directory: workspace };
    class Workspace {
        async run(operation) {
            try {
                if (mode === 'falsy') throw undefined;
                if (mode.startsWith('retained')) throw Object.assign(primary, { retainedWorkspace: workspace });
                return await operation(execution);
            } finally {
                if (!mode.startsWith('retained')) for (const file of files.keys()) {
                    if (file.startsWith(workspace + path.sep)) files.delete(file);
                }
            }
        }
    }
    const reportCommand = async (owner, args, options, source, destination) => {
        expect(owner).toBe(execution);
        expect(args.slice(0, 2)).toEqual(['unit-vitest', 'run']);
        expect(options.cwd).toBe(checkout);
        expect(args.at(-1)).toBe(source);
        const instrumented = options.environment.REDWEB_CLIENT_INSTRUMENTED === '1';
        const name = instrumented ? 'instrumented' : 'plain';
        commands.push(name);
        expect(path.basename(destination)).toBe(name + '-tests.json');
        if (mode !== 'missing-report') files.set(destination, mode === 'malformed-report' ? '{broken' : JSON.stringify({ mode: name }));
        if (instrumented && mode !== 'missing-workers') files.set(path.join(reports, 'raw.json'),
            mode === 'malformed-worker' ? '{broken' : JSON.stringify({ test: 'unit', coverage: {} }));
        if (mode === name + '-command' || mode === 'combined-write') throw primary;
        return 'unit command output';
    };
    const esbuild = { version: 'unit-esbuild', async build(options) {
        const instrumented = options.plugins.length > 0;
        const name = instrumented ? 'instrumented' : 'plain';
        expect(options.entryPoints).toEqual(['src/live-html.ts', 'src/index.ts']);
        expect(options).toMatchObject({ bundle: true, write: false, format: 'esm', target: 'es2022', platform: 'browser' });
        if (mode === name + '-build') throw primary;
        if (instrumented) options.plugins[0].setup({ onLoad(filter, callback) {
            expect(String(filter.filter)).toBe('/\\.[jt]s$/');
            expect(callback({ path: path.join(checkout, 'src/live-html.ts') })).toEqual({ contents: coverage.compiled['src/live-html.ts'], loader: 'js' });
            expect(callback({ path: path.join(checkout, 'src/other.ts') })).toBeUndefined();
        } });
        return { outputFiles: (mode === 'outputs' ? ['index.js'] : ['index.js', 'live-html.js']).map(file => ({
            path: path.join(options.outdir, file), text: mode === 'bundle' ? 'different' : name + (file === 'index.js' ? ' transport' : ' live'),
        })) };
    } };
    const dependencies = {
        'node:fs': fakeFs,
        // VM arrays have a different prototype; these units compare the actual
        // argument values while native integration exercises real strict asserts.
        'node:assert/strict': { ...assert, deepEqual: (a, b, message) => assert.deepEqual(
            JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), message) },
        'node:crypto': { randomUUID: () => 'unit-run' },
        'node:module': { createRequire: () => Object.assign(id => {
            expect(id).toBe('esbuild'); return esbuild;
        }, { resolve: id => { expect(id).toBe('vitest/vitest.mjs'); return 'unit-vitest'; } }) },
        './lib/ClientSourceCoverage': { ClientSourceCoverage: Source, hash, slash },
        './lib/VerificationWorkspace': { VerificationWorkspace: Workspace },
        './lib/verificationError': require('../../scripts/lib/verificationError'),
        './lib/reportCommand': { reportCommand },
        './lib/finishVerificationSummary': require('../../scripts/lib/finishVerificationSummary'),
        './verify-browser-coverage': { runBrowserChecks: async options => {
            expect(options.mode).toBe('source');
            expect(options.frontends).toEqual({ plain: 'plain live', instrumented: 'instrumented live',
                transport: { plain: 'plain transport', instrumented: 'instrumented transport' } });
            if (mode === 'browser') throw primary;
            for (let i = 0; i < (mode === 'browser-zero' ? 0 : mode === 'browser-many' ? 2 : 1); i++) options.coverage.collect({ unit: 'browser' });
            if (mode === 'changed-tooling') files.set(filename, 'changed tooling');
        } },
        typescript: { version: 'unit-ts' },
        'istanbul-lib-instrument/package.json': { version: 'unit-instrumenter' },
    };
    const module = { exports: {} };
    const resolve = Object.assign(id => {
        expect(id).toBe('redweb-client');
        return path.join(mode === 'export-link' ? workspace : checkout, 'dist/index.cjs');
    }, { paths: () => ['unit modules'] });
    const sandbox = { __dirname: path.dirname(filename), module,
        require: Object.assign(id => Object.hasOwn(dependencies, id) ? dependencies[id] : require(id), {
            resolve, main: mode === 'import' ? undefined : module,
            cache: { [filename]: {}, [path.join(root, 'node_modules/unit/index.js')]: {}, [path.resolve(root, '../outside.js')]: {} },
        }),
        process: { version: process.version, platform: process.platform, argv: ['node', filename], exitCode: 0 },
        console: { log(value) { printed.push(value); finished(); }, error(error) { errors.push(error); finished(); } },
        Error, AggregateError, Buffer, __coverage__: {},
    };
    const code = createInstrumenter({ coverageGlobalScope: 'globalThis', coverageGlobalScopeFunc: false })
        .instrumentSync(fs.readFileSync(filename, 'utf8'), filename);
    vm.runInNewContext(code, sandbox, { filename, timeout: 1000 });
    if (mode === 'import') {
        expect(commands).toEqual([]); expect(writes).toEqual([]);
        await sandbox.module.exports.main([]);
    }
    await completion;
    // A failed run prints its retained summary before the CLI rejection handler.
    await new Promise(resolve => setImmediate(resolve));
    const success = ['pass', 'import', 'preflight'].includes(mode);
    expect(sandbox.process.exitCode).toBe(success ? 0 : 1);
    expect(errors).toHaveLength(success ? 0 : 1);
    if (mode === 'preflight') expect(writes).toEqual([]);
    else if (success) {
        expect(JSON.parse(files.get(path.join(output, 'summary.json'))).status).toBe('passed');
        expect(commands).toEqual(['plain', 'instrumented']); expect(unchanged).toBe(2);
    } else {
        expect(require('node:util').types.isNativeError(errors[0])).toBe(true);
        if (mode === 'combined-write') {
            expect(errors[0].errors[0].errors).toEqual([primary, writeFailure]);
            expect(errors[0].errors[1]).toBe(writeFailure);
        }
        if (mode === 'falsy') expect(errors[0].message).toBe('undefined');
        if (mode === 'retained') expect(JSON.parse(files.get(path.join(output, 'summary.json'))).retainedWorkspace).toBe(workspace);
        if (mode === 'retained-write') expect(errors[0].retainedWorkspace).toBe(workspace);
        if (mode === 'transient-summary-write') {
            expect(errors[0]).toBe(writeFailure);
            expect(JSON.parse(files.get(path.join(output, 'summary.json'))).status).toBe('failed');
        }
        if (['instrumented-command', 'malformed-worker', 'collection'].includes(mode)) {
            expect(files.get(path.join(output, 'workers/raw.json'))).toBe(mode === 'malformed-worker' ? '{broken' : JSON.stringify({ test: 'unit', coverage: {} }));
        }
        expect(printed.every(line => !line.includes('"status": "passed"'))).toBe(true);
    }
    if (process.argv.includes('--collectCoverageFrom=scripts/verify-client-source-coverage.js')) {
        const combined = createCoverageMap(globalThis.__coverage__ || {});
        combined.merge(sandbox.__coverage__); globalThis.__coverage__ ||= {};
        globalThis.__coverage__[filename] = combined.fileCoverageFor(filename).toJSON();
    }
});
