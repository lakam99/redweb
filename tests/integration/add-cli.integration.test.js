'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createHash, randomUUID } = require('node:crypto');
const ts = require('typescript');
const { ProjectAddition } = require('../../src/cli/ProjectAddition');
const { run } = require('../../src/cli/run');
const configureProject = require('../helpers/addition-project');
const ApplicationCoverage = require('../../scripts/lib/ApplicationCoverage');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');

const root = path.resolve(__dirname, '../..');
const compiler = require.resolve('typescript/bin/tsc');
let workspace;
beforeEach(() => { workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-add-')); });
afterEach(() => { fs.rmSync(workspace, { recursive: true, force: true }); });

const configure = (...args) => configureProject(workspace, ...args);

test.each([['commonjs', false], ['module', false], ['commonjs', true], ['module', true]])(
    'generated additions compile and pass real HTTP/socket tests (%s, legacy=%s)', async (type, legacy) => {
      await new VerificationWorkspace().run(async owner => {
        const project = owner.directory;
        configureProject(project, type, legacy);
        const originalManifest = fs.readFileSync(path.join(project, 'package.json'), 'utf8');
        const originalConfig = fs.readFileSync(path.join(project, 'tsconfig.json'), 'utf8');
        const evidence = path.join(root, 'coverage/addition-source', randomUUID());
        fs.mkdirSync(evidence, { recursive: true });
        const hash = bytes => createHash('sha256').update(bytes).digest('hex');
        for (const kind of ['page', 'component', 'socket-route']) {
            const args = ['add', kind, 'sample', '--json'];
            const preview = await run([...args, '--dry-run'], project, '0.12.0');
            expect(preview.exitCode).toBe(0);
            expect(fs.existsSync(path.join(project, 'test', `sample.${kind}.test.cjs`))).toBe(false);
            const generated = await run(args, project, '0.12.0');
            expect(generated.stderr).toBe('');
            const report = JSON.parse(generated.stdout);
            expect(report.registration.status).toBe('pending');
            expect(report.created).toEqual(JSON.parse(preview.stdout).planned);
            const testArgs = ['--test', '--test-reporter=tap', report.test];

            // Measure the actual filled template, before TypeScript inserts
            // decorator helpers. No application/API is replaced in either run.
            const sourcePath = path.join(project, report.source);
            const source = fs.readFileSync(sourcePath, 'utf8');
            const template = `recipes/add/${kind === 'socket-route' ? 'socket-route.ts' : 'live.tsx'}`;
            const preload = path.join(root, 'scripts/lib/record-application-coverage.cjs');
            const inputFiles = Object.fromEntries([report.source, report.test, 'package.json', 'tsconfig.json']
                .map(file => [file, path.join(project, file)]));
            for (const file of [template, 'config/tsconfig.json', 'scripts/lib/ApplicationCoverage.js', 'scripts/lib/assertCoverageFile.js',
                'scripts/lib/record-application-coverage.cjs']) inputFiles[`redweb/${file}`] = path.join(root, file);
            const inputs = () => Object.fromEntries(Object.entries(inputFiles).map(([name, file]) => [name, hash(fs.readFileSync(file))]));
            const before = inputs();
            const configuration = ts.getParsedCommandLineOfConfigFile(path.join(project, 'tsconfig.json'), {}, {
                ...ts.sys, onUnRecoverableConfigFileDiagnostic: diagnostic => { throw new Error(String(diagnostic.messageText)); },
            });
            expect(configuration.errors).toEqual([]);
            // transpileModule has no package.json context: explicitly preserve
            // the module format that the preceding real NodeNext build checked.
            const compilerOptions = { ...configuration.options,
                module: type === 'module' ? ts.ModuleKind.ESNext : ts.ModuleKind.CommonJS,
                moduleResolution: ts.ModuleResolutionKind.Node10 };
            const coverage = new ApplicationCoverage({ [sourcePath]: source }, compilerOptions);
            const compiled = coverage.compiled[sourcePath];
            // Child reports live outside the disposable project, including when
            // a command fails. Keep the failing command's captured output too.
            const reports = path.join(evidence, kind);
            fs.mkdirSync(reports);
            const result = {
                kind, type, legacy, node: process.version, platform: process.platform,
                typescript: ts.version, compilerOptions, inputs: before, template,
                templateSha256: before[`redweb/${template}`], compiledSha256: hash(compiled), passed: false,
            };
            let failure;
            try {
                result.phase = 'build';
                result.build = await owner.command([compiler, '-p', 'tsconfig.json'], { timeoutMs: 30000 });
                expect(result.build).toBe('');
                result.phase = 'plain';
                result.plain = await owner.command(testArgs, { timeoutMs: 20000 });
                expect(result.plain).toContain('# fail 0');
                fs.writeFileSync(path.join(project, report.output), compiled);
                result.phase = 'instrumented';
                result.instrumented = await owner.command(testArgs, { timeoutMs: 20000, environment: {
                    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require ${JSON.stringify(preload)}`,
                    REDWEB_APPLICATION_COVERAGE_DIRECTORY: reports,
                } });
                expect(result.instrumented).toContain('# fail 0');
                result.phase = 'coverage';
                const reportFiles = fs.readdirSync(reports).sort();
                result.receivedProcessReports = reportFiles.length;
                expect(reportFiles.length).toBeGreaterThan(0);
                for (const file of reportFiles) coverage.collect(JSON.parse(fs.readFileSync(path.join(reports, file), 'utf8')));
                expect(inputs()).toEqual(before);
                coverage.assertComplete();
                result.passed = true;
            } catch (error) {
                failure = error;
                result.error = error.stack;
            }
            try {
                fs.writeFileSync(path.join(evidence, `${kind}.json`), JSON.stringify({ ...result, ...coverage.report() }, null, 2), { flag: 'wx' });
            } catch (error) {
                failure = failure ? new AggregateError([failure, error], failure.message, { cause: failure }) : error;
            }
            if (failure) throw failure;
            const repeat = await run(args, project, '0.12.0');
            expect(repeat.exitCode).toBe(1);
            expect(repeat.stderr).toContain('Refusing to overwrite');
        }
        expect(fs.readFileSync(path.join(project, 'package.json'), 'utf8')).toBe(originalManifest);
        expect(fs.readFileSync(path.join(project, 'tsconfig.json'), 'utf8')).toBe(originalConfig);
      });
    }, 240000); // Three bounded compile/plain/instrumented runs, plus owned cleanup.

test('human and subprocess CLI report the exact unregistered addition and test command', async () => {
    configure();
    const planned = await run(['add', 'page', 'account-settings', '--dry-run'], workspace, '0.12.0');
    expect(planned.exitCode).toBe(0);
    expect(planned.stdout).toContain('Planned addition');
    const added = await run(['add', 'page', 'account-settings', '--test-dir', 'checks'], workspace, '0.12.0');
    expect(added.exitCode).toBe(0);
    expect(added.stdout).toContain('Registration pending: Import AccountSettingsPage');
    expect(added.stdout).toContain('checks/account-settings.page.test.cjs');
    const cli = spawnSync(process.execPath, [path.join(root, 'bin/redweb.js'), 'add', 'component', 'notifications', '--dry-run', '--json'], { cwd: workspace, encoding: 'utf8', timeout: 30000 });
    expect(cli.status).toBe(0);
    expect(JSON.parse(cli.stdout).operation).toBe('add');
    expect(fs.existsSync(path.join(workspace, 'source/components/notifications.tsx'))).toBe(false);
});

test('refuses an excluded source before any write and supports explicit config and source location', () => {
    configure();
    const configuration = { extends: 'redweb/tsconfig.json', compilerOptions: { rootDir: '.', outDir: 'release' }, include: ['features/**/*.tsx'], exclude: ['features/pages/hidden.tsx'] };
    fs.writeFileSync(path.join(workspace, 'custom.json'), JSON.stringify(configuration));
    const addition = new ProjectAddition();
    const options = { kind: 'page', name: 'hidden', configFile: 'custom.json', sourceDir: 'features' };
    expect(() => addition.add(workspace, options)).toThrow('excluded');
    expect(fs.existsSync(path.join(workspace, 'features'))).toBe(false);
    const result = addition.add(workspace, { ...options, name: 'visible' });
    expect(result.output).toBe('release/features/pages/visible.js');
    expect(result.verification.build).toEqual(['npx', 'tsc', '-p', 'custom.json']);
});
