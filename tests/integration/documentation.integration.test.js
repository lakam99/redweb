'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { verifyDocumentation } = require('../../scripts/lib/verify-documentation');
const { verifySharedServer } = require('../../scripts/lib/verify-shared-server');
const { copyDocumentationSource } = require('../helpers/documentation');
const { TEMPLATES } = require('../../src/cli/templates');

const root = path.resolve(__dirname, '../..');

describe('documented applications without mocks', () => {
    test('the homepage shared-listener example answers real HTTP and typed socket messages', async () => {
        await verifySharedServer(root);
    }, 10000);
    test('the printed Markdown applications compile and pass HTTP/socket tests without source at runtime', () => {
        const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-documentation-'));
        try {
            const reports = verifyDocumentation(root, workspace);
            expect(reports.map(report => report.template)).toEqual(TEMPLATES);
            for (const report of reports) {
                if (report.output.startsWith('# SKIP')) expect(report.template).toBe('dashboard');
                else {
                    expect(report.output).toMatch(/# pass [1-9]/);
                    expect(report.output).toContain('# fail 0');
                }
            }
        } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
    }, 90000);

    test('the actual generator rejects invalid arguments and verifies the checked-in artifact', () => {
        const script = path.join(root, 'scripts/generate-docs.js');
        const run = args => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 10000, windowsHide: true });
        expect(run(['--check']).status).toBe(0);
        expect(run(['--check']).stdout).toBe('');
        expect(run(['--check', '--check']).status).toBe(1);
        expect(run(['--unknown']).stderr).toContain('Usage:');
        expect(run(['--release', '--check']).stderr).toContain('Move unreleased changes');
    });

    test('release snapshots are immutable and drift fails the actual check command', () => {
        const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-docs-command-'));
        try {
            copyDocumentationSource(root, workspace);
            const { version } = require('../../package.json');
            fs.writeFileSync(path.join(workspace, 'CHANGELOG.md'), `# Changelog\n\n## ${version}\n\n- Released.\n`);
            const run = args => spawnSync(process.execPath, [path.join(workspace, 'scripts/generate-docs.js'), ...args], { cwd: workspace, encoding: 'utf8', timeout: 10000, windowsHide: true });
            expect(run(['--release']).status).toBe(0);
            const snapshot = fs.readFileSync(path.join(workspace, `docs/releases/${version}.json`), 'utf8');
            expect(JSON.parse(snapshot).channel).toBe(version);
            // Git on Windows can restore the same generated file with CRLF line endings.
            fs.writeFileSync(path.join(workspace, `docs/releases/${version}.json`), snapshot.replace(/\n/g, '\r\n'));
            expect(run(['--release']).status).toBe(0);
            expect(run(['--check']).status).toBe(0);
            const readmeFile = path.join(workspace, 'README.md');
            const originalReadme = fs.readFileSync(readmeFile, 'utf8');
            fs.writeFileSync(readmeFile, originalReadme.replace('increment() { this.count += 1; }', 'increment() { this.count += 2; }'));
            expect(run(['--check']).stderr).toContain('README recipe is stale');
            expect(run(['--release']).status).toBe(0);
            fs.writeFileSync(readmeFile, 'A README with no generated region.');
            expect(run(['--check']).stderr).toContain('exactly one realtime recipe region');
            fs.writeFileSync(readmeFile, originalReadme);
            const guide = path.join(workspace, 'docs/GETTING_STARTED.md');
            fs.appendFileSync(guide, '\nAdditional documented behavior.\n');
            expect(run(['--check']).stderr).toContain('Generated documentation is stale');
            expect(run(['--release']).stderr).toContain('immutable');
            expect(fs.readFileSync(path.join(workspace, `docs/releases/${version}.json`), 'utf8').replace(/\r\n/g, '\n')).toBe(snapshot);
            expect(run([]).status).toBe(0);
            expect(JSON.parse(fs.readFileSync(path.join(workspace, 'docs/generated.json'), 'utf8')).channel).toBe('unreleased');
            expect(run(['--check']).status).toBe(0);
            fs.unlinkSync(path.join(workspace, 'docs/generated.json'));
            expect(run(['--check']).stderr).toContain('Generated documentation is stale');
        } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
    });
});
