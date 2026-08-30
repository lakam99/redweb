'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { parseArguments, USAGE } = require('../../src/cli/arguments');
const { ProjectDoctor, nodeIssue } = require('../../src/cli/ProjectDoctor');
const ProjectInitializer = require('../../src/cli/ProjectInitializer');
const { run } = require('../../src/cli/run');
const { version } = require('../../package.json');

const root = path.resolve(__dirname, '..', '..');

function installTools(target, names = ['redweb', 'typescript']) {
    fs.mkdirSync(path.join(target, 'node_modules'), { recursive: true });
    for (const name of names) fs.symlinkSync(name === 'redweb' ? root : path.dirname(require.resolve('typescript/package.json')), path.join(target, 'node_modules', name), 'junction');
}

function configure(target, options = {}) {
    fs.mkdirSync(path.join(target, 'src'), { recursive: true });
    fs.writeFileSync(path.join(target, 'src', 'app.tsx'), 'export const message = <h1>Hello</h1>;');
    fs.writeFileSync(path.join(target, 'tsconfig.json'), JSON.stringify({ extends: 'redweb/tsconfig.json', compilerOptions: options, include: ['src/**/*.tsx'] }));
}

describe('CLI command arguments', () => {
    test('parses commands without a shell or interactive prompts', () => {
        expect(parseArguments([])).toEqual({ command: '--help' });
        expect(parseArguments(['-h'])).toEqual({ command: '-h' });
        expect(parseArguments(['--version'])).toEqual({ command: '--version' });
        expect(parseArguments(['init', 'my project', '--existing', '--dry-run', '--json'])).toEqual({ command: 'init', target: 'my project', existing: true, dryRun: true, json: true, port: null });
        expect(parseArguments(['doctor', '--port', '8181', '--json']).port).toBe(8181);
        expect(parseArguments(['doctor', '--port', '0']).port).toBe(0);
        expect(parseArguments(['init', '--template', 'chat']).template).toBe('chat');
    });

    test.each([
        ['unknown'], ['--help', 'extra'], ['init', 'one', 'two'],
        ['init', '--json', '--json'], ['doctor', '--existing'], ['doctor', '--dry-run'],
        ['init', '--port', '80'], ['doctor', '--port'], ['doctor', '--port', '65536'],
        ['doctor', '--port', '-1'], ['doctor', '--port', '1.5'], ['init', '--unknown'],
        ['init', '--template'], ['init', '--template', '../file'], ['init', '--existing', '--template', 'site'],
        ['doctor', '--template', 'chat'], ['init', '--template', 'site', '--template', 'chat'],
    ])('rejects invalid arguments: %j', (...args) => {
        expect(() => parseArguments(args)).toThrow();
    });

    test('node compatibility is an explicit pure check', () => {
        expect(nodeIssue('18.0.0')).toBeNull();
        expect(nodeIssue('22.21.0')).toBeNull();
        expect(nodeIssue('16.20.0').code).toBe('NODE_UNSUPPORTED');
        expect(nodeIssue('unknown').code).toBe('NODE_UNSUPPORTED');
    });
});

describe('CLI filesystem safety and diagnostics without mocks', () => {
    let workspace;
    beforeEach(() => { workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-tools-')); });
    afterEach(() => { fs.rmSync(workspace, { recursive: true, force: true }); });

    test('dry-run creates nothing and existing-project mode creates only configuration', () => {
        const target = path.join(workspace, 'new');
        const initializer = new ProjectInitializer(version);
        const plan = initializer.initialize(target, { dryRun: true });
        expect(plan.created).toEqual([]);
        expect(plan.planned).toHaveLength(9);
        expect(fs.existsSync(target)).toBe(false);
        const created = initializer.initialize(target, { existing: true });
        expect(created.created).toEqual(['tsconfig.json']);
        expect(fs.readdirSync(target)).toEqual(['tsconfig.json']);
        expect(initializer.initialize(target, { existing: true }).skipped).toEqual(['tsconfig.json']);
    });

    test('preflights invalid directory targets without leaving a partial manifest', () => {
        fs.mkdirSync(path.join(workspace, 'src'));
        fs.mkdirSync(path.join(workspace, 'src', 'app.tsx'));
        expect(() => new ProjectInitializer(version).initialize(workspace)).toThrow('Expected a file');
        expect(fs.existsSync(path.join(workspace, 'package.json'))).toBe(false);
        fs.rmSync(path.join(workspace, 'src'), { recursive: true });
        fs.writeFileSync(path.join(workspace, 'src'), 'user file');
        expect(() => new ProjectInitializer(version).initialize(workspace)).toThrow();
        expect(fs.existsSync(path.join(workspace, 'package.json'))).toBe(false);
    });

    test('refuses linked directories and does not write outside the project', () => {
        const outside = path.join(workspace, 'outside');
        const target = path.join(workspace, 'project');
        fs.mkdirSync(outside);
        fs.mkdirSync(target);
        fs.symlinkSync(outside, path.join(target, 'src'), 'junction');
        expect(() => new ProjectInitializer(version).initialize(target)).toThrow('symbolic link');
        expect(fs.readdirSync(outside)).toEqual([]);
        expect(fs.existsSync(path.join(target, 'package.json'))).toBe(false);
        expect(new ProjectInitializer(version).initialize(target, { existing: true }).created).toEqual(['tsconfig.json']);
    });

    test('reports missing dependencies/config without mutating the directory', async () => {
        const report = await new ProjectDoctor(version).inspect(workspace);
        expect(report.ok).toBe(false);
        expect(report.issues.map(value => value.code)).toEqual(['REDWEB_MISSING', 'TYPESCRIPT_MISSING', 'CONFIG_MISSING']);
        expect(fs.readdirSync(workspace)).toEqual([]);
        fs.writeFileSync(path.join(workspace, 'tsconfig.json'), '{}');
        expect((await new ProjectDoctor(version).inspect(workspace)).issues.map(value => value.code)).toEqual(['REDWEB_MISSING', 'TYPESCRIPT_MISSING']);
    });

    test('resolves effective inherited settings rather than grepping JSON text', async () => {
        installTools(workspace);
        configure(workspace);
        const doctor = new ProjectDoctor(version);
        const before = fs.readFileSync(path.join(workspace, 'tsconfig.json'), 'utf8');
        const report = await doctor.inspect(workspace, 0);
        expect(report.ok).toBe(true);
        expect(report.issues).toEqual([]);
        expect(report.installedVersion).toBe(version);
        expect(report.checks).toContain('loopback-port');
        expect(fs.readFileSync(path.join(workspace, 'tsconfig.json'), 'utf8')).toBe(before);
        configure(workspace, { jsx: 'react-jsxdev' });
        expect((await doctor.inspect(workspace)).ok).toBe(true);
    });

    test('identifies runtime overrides, legacy decorators, and a mismatched CLI', async () => {
        installTools(workspace);
        configure(workspace, { jsxImportSource: 'react', experimentalDecorators: true });
        let report = await new ProjectDoctor('999.0.0').inspect(workspace);
        expect(report.ok).toBe(false);
        expect(report.issues.map(value => value.code)).toEqual(['CLI_VERSION_MISMATCH', 'JSX_RUNTIME_MISMATCH', 'LEGACY_DECORATORS']);
        configure(workspace, { jsx: 'preserve' });
        report = await new ProjectDoctor(version).inspect(workspace);
        expect(report.issues[0].code).toBe('JSX_RUNTIME_MISMATCH');
    });

    test('reports malformed and unresolvable configurations', async () => {
        installTools(workspace);
        fs.writeFileSync(path.join(workspace, 'tsconfig.json'), '{ nope: ');
        expect((await new ProjectDoctor(version).inspect(workspace)).issues[0].code).toBe('CONFIG_INVALID');
        fs.writeFileSync(path.join(workspace, 'tsconfig.json'), '{"extends":"./missing.json"}');
        const report = await new ProjectDoctor(version).inspect(workspace);
        expect(report.ok).toBe(false);
        expect(report.issues.every(value => value.code === 'CONFIG_INVALID')).toBe(true);
    });

    test('detects a real occupied port and releases its successful probes', async () => {
        installTools(workspace);
        configure(workspace);
        const server = net.createServer();
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const port = server.address().port;
        try {
            const report = await new ProjectDoctor(version).inspect(workspace, port);
            expect(report.ok).toBe(false);
            expect(report.issues[0].code).toBe('PORT_UNAVAILABLE');
        } finally { await new Promise(resolve => server.close(resolve)); }
        expect((await new ProjectDoctor(version).inspect(workspace, port)).ok).toBe(true);
    });

    test('provides machine-readable init/errors and honest human-readable output', async () => {
        const plan = await run(['init', '--json', '--dry-run'], workspace, version);
        expect(JSON.parse(plan.stdout).dryRun).toBe(true);
        expect(fs.readdirSync(workspace)).toEqual([]);
        const existing = await run(['init', '--existing'], workspace, version);
        expect(existing.stdout).toContain('No application or package files were generated.');
        expect(existing.stdout).toContain('not validated');
        expect((await run(['init', '--dry-run'], workspace, version)).stdout).toContain('Planned initialization');
        expect((await run(['init'], workspace, version)).stdout).toContain('npm install');
        const failure = await run(['invalid', '--json'], workspace, version);
        expect(failure.exitCode).toBe(1);
        expect(JSON.parse(failure.stderr).error.code).toBe('CLI_FAILED');
        expect((await run(['invalid'], workspace, version)).stderr).toContain('Run redweb --help');
        expect((await run([], workspace, version)).stdout).toBe(USAGE);
        expect((await run(['-h'], workspace, version)).stdout).toBe(USAGE);
        expect((await run(['--version'], workspace, version)).stdout).toBe(`${version}\n`);
    });

    test('doctor JSON uses exit status for errors, not for warnings', async () => {
        const failure = await run(['doctor', '--json'], workspace, version);
        expect(failure.exitCode).toBe(1);
        expect(JSON.parse(failure.stdout).ok).toBe(false);
        expect((await run(['doctor'], workspace, version)).stdout).toContain('issues found');
        installTools(workspace);
        configure(workspace);
        const success = await run(['doctor', '--json'], workspace, version);
        expect(success.exitCode).toBe(0);
        expect(JSON.parse(success.stdout).issues).toEqual([]);
        expect((await run(['doctor'], workspace, version)).stdout).toContain('passed selected checks');
    });
});
