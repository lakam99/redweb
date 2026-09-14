'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createInstrumenter } = require('istanbul-lib-instrument');
const { createCoverageMap } = require('istanbul-lib-coverage');
const root = path.resolve(__dirname, '../..');

// Explicit orchestration fault units, not simulated integration tests. The real
// six-application commands exercise the unchanged compiler/process/filesystem APIs.
const common = ['pass', 'import', 'initial-write', 'intermediate-write', 'final-write', 'combined-write', 'latest-write', 'persistent-write',
    'init', 'plain-command', 'missing-report', 'malformed-report', 'inventory', 'retained', 'retained-write', 'retained-persistent-write', 'empty-templates', 'changed-input'];
const cases = [
    ...[...common, 'empty-statements', 'empty-sources'].map(mode => ['measure-starter-coverage.js', mode]),
    ...[...common, 'environment', 'config-fatal', 'config-errors', 'instrumented-command',
        'missing-workers', 'malformed-worker', 'collection', 'incomplete',
        'incomplete-then-failure'].map(mode => ['verify-starter-source-coverage.js', mode]),
];

test.each(cases)('%s coordinator unit: %s', async (script, mode) => {
    const authored = script.startsWith('verify');
    const filename = path.join(root, 'scripts', script);
    const workspace = path.resolve('unit-starter-workspace');
    const files = new Map(), writes = [], printed = [], errors = [], commands = [];
    const templates = mode === 'empty-templates' ? [] : ['realtime', 'dashboard'];
    const projectFiles = () => ['src/app.ts', 'src/view.tsx', 'package.json', 'tsconfig.json', 'test/app.test.cjs']
        .filter(file => mode !== 'empty-sources' || !file.startsWith('src/')).map(file => ({ path: file }));
    const primary = new Error('unit starter command failed');
    const recordFailure = new Error('unit recording failed');
    let failedWrite = false, constructed = 0;
    const fakeFs = {
        mkdirSync() {},
        readFileSync(file, encoding) {
            if (!files.has(file)) throw new Error(`Missing unit file: ${file}`);
            return encoding ? String(files.get(file)) : Buffer.from(String(files.get(file)));
        },
        writeFileSync(file, value) {
            if (path.basename(file) === 'latest.json' && mode === 'latest-write' && JSON.parse(value).status !== 'running' && !failedWrite) {
                failedWrite = true; throw recordFailure;
            }
            if (path.basename(file) === 'summary.json') {
                const summary = JSON.parse(value);
                const trigger = mode === 'initial-write' ||
                    (mode === 'intermediate-write' && Object.keys(summary.applications).length === 1) ||
                    (['final-write', 'combined-write', 'persistent-write', 'retained-write', 'retained-persistent-write'].includes(mode) && summary.status !== 'running');
                if (trigger && (!failedWrite || mode.endsWith('persistent-write'))) { failedWrite = true; throw recordFailure; }
                writes.push(summary);
            }
            files.set(file, String(value));
        },
        readdirSync(directory) {
            return [...files.keys()].filter(file => path.dirname(file) === directory).map(file => path.basename(file));
        },
    };
    const execution = { directory: workspace, command: async args => {
        commands.push(args);
        if (['init', 'combined-write'].includes(mode)) throw primary;
        const project = args[2];
        if (mode === 'incomplete-then-failure' && project.endsWith('dashboard')) throw primary;
        for (const file of projectFiles()) files.set(path.join(project, file.path),
            file.path === 'package.json' ? JSON.stringify({ dependencies: {} }) : `original ${file.path}`);
        return '{}';
    } };
    class Workspace {
        async run(operation) {
            if (mode.startsWith('retained')) throw Object.assign(primary, { retainedWorkspace: workspace });
            return operation(execution);
        }
    }
    const sourceNames = project => projectFiles().filter(file => file.path.startsWith('src/')).map(file => path.join(project, file.path));
    const rawMap = project => Object.fromEntries(sourceNames(project).slice(mode === 'inventory' ? 1 : 0).map(file => [file, {
        path: file, statementMap: mode === 'empty-statements' ? {} : { 0: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } } },
        s: mode === 'empty-statements' ? {} : { 0: 1 }, fnMap: {}, f: {}, branchMap: {}, b: {},
    }]));
    const reportCommand = async (owner, args, options, source, destination) => {
        expect(owner).toBe(execution);
        const instrumented = args[0] === '--test';
        commands.push(args);
        if (!instrumented) {
            expect(args).toEqual(['unit-npm', 'run', 'test:coverage']);
            expect(source).toBe(path.join(options.cwd, 'coverage/coverage-final.json'));
            expect(path.basename(destination)).toBe(authored ? 'v8-coverage.json' : 'coverage-final.json');
            if (mode !== 'missing-report') files.set(destination, mode === 'malformed-report' ? '{broken' : JSON.stringify(rawMap(options.cwd)));
            if (mode === 'plain-command') throw primary;
            if (!authored && mode === 'changed-input') files.set(path.join(options.cwd, 'src/app.ts'), 'changed source');
        } else {
            expect(source).toBe(path.join(options.cwd, 'source-coverage'));
            expect(path.basename(destination)).toBe('process-reports');
            expect(options.environment.REDWEB_APPLICATION_COVERAGE_DIRECTORY).toBe(source);
            expect(options.environment.NODE_OPTIONS).toContain('--require');
            if (mode === 'environment') expect(options.environment.NODE_OPTIONS).toContain('--unit-option');
            expect(args.includes('test/rate-window.test.cjs')).toBe(options.cwd.endsWith('dashboard'));
            if (mode !== 'missing-workers') files.set(path.join(destination, 'worker.json'), mode === 'malformed-worker' ? '{broken' : '{}');
            if (mode === 'instrumented-command') throw primary;
            if (mode === 'changed-input') files.set(path.join(options.cwd, 'src/app.ts'), 'changed source');
        }
        return 'unit command output';
    };
    class Coverage {
        constructor(sources) {
            this.index = constructed++;
            this.compiled = Object.fromEntries(Object.keys(sources).map(file => [file, 'compiled unit application']));
        }
        collect() { if (mode === 'collection') throw primary; }
        report() { return { summary: { unit: 'coverage' }, coverage: {} }; }
        assertComplete() {
            if (['incomplete', 'incomplete-then-failure'].includes(mode) && this.index === 0) throw new Error('unit coverage incomplete');
        }
    }
    const dependencies = {
        'node:fs': fakeFs,
        'node:crypto': { ...require('node:crypto'), randomUUID: () => 'unit-run' },
        './evaluation/process': { npmEntrypoint: () => 'unit-npm' },
        './lib/VerificationWorkspace': { VerificationWorkspace: Workspace },
        './lib/reportCommand': { reportCommand },
        './lib/verify-starter': { linkApplication: (packageRoot, project) => {
            expect(packageRoot).toBe(root); expect(project.startsWith(workspace)).toBe(true);
        } },
        '../src/cli/templates': { projectFiles, TEMPLATES: templates },
        '../package.json': { version: 'unit-version' },
        './lib/ApplicationCoverage': Coverage,
        './lib/verificationError': require('../../scripts/lib/verificationError'),
        './lib/finishVerificationSummary': require('../../scripts/lib/finishVerificationSummary'),
        typescript: { version: 'unit-ts', sys: {},
            getParsedCommandLineOfConfigFile: (_file, _options, host) => {
                if (mode === 'config-fatal') host.onUnRecoverableConfigFileDiagnostic({ messageText: 'unit fatal config' });
                return { errors: mode === 'config-errors' ? ['bad config'] : [], options: {} };
            },
            flattenDiagnosticMessageText: value => value, formatDiagnostics: () => 'unit config diagnostics', createCompilerHost: () => ({}),
        },
    };
    const module = { exports: {} };
    const sandbox = { __dirname: path.dirname(filename), module,
        require: Object.assign(id => Object.hasOwn(dependencies, id) ? dependencies[id] : require(id), { main: mode === 'import' ? undefined : module }),
        process: { version: process.version, platform: process.platform, exitCode: 0, env: mode === 'environment' ? { NODE_OPTIONS: '--unit-option' } : {} },
        console: { log: value => printed.push(value), error: value => errors.push(value) },
        Error, AggregateError, Buffer, __coverage__: {},
    };
    const source = fs.readFileSync(filename, 'utf8');
    const code = createInstrumenter({ coverageGlobalScope: 'globalThis', coverageGlobalScopeFunc: false }).instrumentSync(source, filename);
    await vm.runInNewContext(code, sandbox, { filename, timeout: 1000 });
    if (mode === 'import') {
        expect(commands).toEqual([]); expect(writes).toEqual([]);
        await sandbox.module.exports.main();
    }
    const success = ['pass', 'import', 'environment'].includes(mode);
    expect(sandbox.process.exitCode).toBe(success ? 0 : 1);
    expect(errors).toHaveLength(success ? 0 : 1);
    if (success) {
        expect(writes.at(-1).status).toBe(authored ? 'passed' : 'measured');
        expect(Object.keys(writes.at(-1).applications)).toEqual(templates);
        expect(printed.at(-1)).toContain(authored ? 'All six original-TypeScript' : 'uncovered counters remain gaps');
    } else {
        expect(require('node:util').types.isNativeError(errors[0])).toBe(true);
        expect(printed.some(line => line.startsWith(authored ? 'All six' : 'Application coverage measured'))).toBe(false);
        if (mode === 'combined-write') expect(errors[0].errors).toEqual([primary, recordFailure]);
        if (mode === 'persistent-write') expect(errors[0].errors).toEqual([recordFailure, recordFailure]);
        if (mode.startsWith('retained')) {
            expect(errors[0].retainedWorkspace).toBe(workspace);
            if (mode !== 'retained-persistent-write') expect(writes.at(-1).retainedWorkspace).toBe(workspace);
        }
        if (mode === 'latest-write') expect(writes.at(-1).status).toBe('failed');
        if (mode === 'incomplete') {
            expect(writes.at(-1).status).toBe('failed');
            expect(Object.keys(writes.at(-1).applications)).toEqual(templates);
            expect(writes.at(-1).applications.realtime.error).toBe('unit coverage incomplete');
        }
        if (mode === 'incomplete-then-failure') expect(writes.at(-1).error).toBe(primary.message);
        if (['plain-command', 'malformed-report', 'inventory'].includes(mode)) {
            expect([...files.keys()].some(file => file.endsWith(authored ? 'v8-coverage.json' : 'coverage-final.json'))).toBe(true);
        }
        if (['instrumented-command', 'malformed-worker', 'collection'].includes(mode)) {
            expect([...files.keys()].some(file => file.endsWith(path.join('process-reports', 'worker.json')))).toBe(true);
        }
    }
    // Keep the private tool maps out of the configured 91-file library scope.
    if (process.argv.includes(`--collectCoverageFrom=scripts/${script}`)) {
        const combined = createCoverageMap(globalThis.__coverage__ || {});
        combined.merge(sandbox.__coverage__);
        globalThis.__coverage__ ||= {};
        globalThis.__coverage__[filename] = combined.fileCoverageFor(filename).toJSON();
    }
});
