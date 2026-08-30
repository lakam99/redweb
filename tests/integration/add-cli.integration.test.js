'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { ProjectAddition } = require('../../src/cli/ProjectAddition');
const { run } = require('../../src/cli/run');
const configureProject = require('../helpers/addition-project');

const root = path.resolve(__dirname, '../..');
const compiler = require.resolve('typescript/bin/tsc');
let workspace;
beforeEach(() => { workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-add-')); });
afterEach(() => { fs.rmSync(workspace, { recursive: true, force: true }); });

const configure = (...args) => configureProject(workspace, ...args);

test.each([['commonjs', false], ['module', false], ['commonjs', true], ['module', true]])(
    'generated additions compile and pass real HTTP/socket tests (%s, legacy=%s)', async (type, legacy) => {
        configure(type, legacy);
        const originalManifest = fs.readFileSync(path.join(workspace, 'package.json'), 'utf8');
        const originalConfig = fs.readFileSync(path.join(workspace, 'tsconfig.json'), 'utf8');
        for (const kind of ['page', 'component', 'socket-route']) {
            const args = ['add', kind, 'sample', '--json'];
            const preview = await run([...args, '--dry-run'], workspace, '0.12.0');
            expect(preview.exitCode).toBe(0);
            expect(fs.existsSync(path.join(workspace, 'test', `sample.${kind}.test.cjs`))).toBe(false);
            const generated = await run(args, workspace, '0.12.0');
            expect(generated.stderr).toBe('');
            const report = JSON.parse(generated.stdout);
            expect(report.registration.status).toBe('pending');
            expect(report.created).toEqual(JSON.parse(preview.stdout).planned);
            const build = spawnSync(process.execPath, [compiler, '-p', 'tsconfig.json'], { cwd: workspace, encoding: 'utf8', timeout: 30000 });
            expect(build.stdout + build.stderr).toBe('');
            expect(build.status).toBe(0);
            const test = spawnSync(process.execPath, ['--test', '--test-reporter=tap', report.test], { cwd: workspace, encoding: 'utf8', timeout: 20000 });
            expect(test.stdout + test.stderr).toContain('# fail 0');
            expect(test.status).toBe(0);
            const repeat = await run(args, workspace, '0.12.0');
            expect(repeat.exitCode).toBe(1);
            expect(repeat.stderr).toContain('Refusing to overwrite');
        }
        expect(fs.readFileSync(path.join(workspace, 'package.json'), 'utf8')).toBe(originalManifest);
        expect(fs.readFileSync(path.join(workspace, 'tsconfig.json'), 'utf8')).toBe(originalConfig);
    }, 120000);

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
