'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { verifyDocumentation } = require('../../scripts/lib/verify-documentation');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { verifyRoomExample } = require('../../scripts/lib/verify-room-example');
const { copyDocumentationSource } = require('../helpers/documentation');
const { TEMPLATES } = require('../../src/cli/templates');
const { verifyScript } = require('../helpers/script-coverage');

const root = path.resolve(__dirname, '../..');

describe('documented applications without mocks', () => {
    test('shared page/room identity compiles in both decorator modes and survives source-free deployment', async () => {
        const execution = new VerificationWorkspace();
        await execution.run(owner => verifyRoomExample(root, owner));
        expect(fs.existsSync(execution.directory)).toBe(false);
    }, 120000);
    test('the printed Markdown applications compile and pass HTTP/socket tests without source at runtime', async () => {
        await new VerificationWorkspace().run(async execution => {
            const reports = await verifyDocumentation(root, execution);
            expect(reports.map(report => report.template)).toEqual(TEMPLATES);
            for (const report of reports) {
                if (report.output.startsWith('# SKIP')) expect(report.template).toBe('dashboard');
                else {
                    expect(report.output).toMatch(/# pass [1-9]/);
                    expect(report.output).toContain('# fail 0');
                }
            }
        });
    }, 420000); // Six applications, each with two bounded 30s commands plus cleanup.

    test('the actual generator rejects invalid arguments and verifies the checked-in artifact', () => {
        const script = path.join(root, 'scripts/generate-docs.js');
        const run = args => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 10000, windowsHide: true });
        expect(run(['--check']).status).toBe(0);
        expect(run(['--check']).stdout).toBe('');
        expect(run(['--check', '--check']).status).toBe(1);
        expect(run(['--unknown']).stderr).toContain('Usage:');
    });

    test('release snapshots are immutable and drift fails the actual check command', async () => {
        const { version } = require('../../package.json');
        await verifyScript({ script: 'scripts/generate-docs.js', testFile: __filename,
          prepare(workspace) {
            copyDocumentationSource(root, workspace);
            fs.rmSync(path.join(workspace, `docs/releases/${require('../../package.json').version}.json`));
            fs.writeFileSync(path.join(workspace, 'CHANGELOG.md'), '# Changelog\n\n## Unreleased\n\n- Pending.\n');
          },
          async exercise(workspace, run) {
            for (const args of [['--unknown'], ['--check', '--check']]) {
                await expect(run(args)).rejects.toThrow('Usage:');
            }
            await expect(run(['--release', '--check'])).rejects.toThrow('Move unreleased changes');
            fs.writeFileSync(path.join(workspace, 'CHANGELOG.md'), `# Changelog\n\n## ${version}\n\n- Released.\n`);
            expect(await run(['--release'])).toBe('');
            const snapshot = fs.readFileSync(path.join(workspace, `docs/releases/${version}.json`), 'utf8');
            expect(JSON.parse(snapshot).channel).toBe(version);
            // Git on Windows can restore the same generated file with CRLF line endings.
            fs.writeFileSync(path.join(workspace, `docs/releases/${version}.json`), snapshot.replace(/\n/g, '\r\n'));
            expect(await run(['--release'])).toBe('');
            expect(await run(['--check'])).toBe('');
            const readmeFile = path.join(workspace, 'README.md');
            const originalReadme = fs.readFileSync(readmeFile, 'utf8');
            const catalogueFile = path.join(workspace, 'docs/generated.json');
            const originalCatalogue = fs.readFileSync(catalogueFile, 'utf8');
            const snapshotFile = path.join(workspace, `docs/releases/${version}.json`);
            const originalSnapshot = fs.readFileSync(snapshotFile, 'utf8');
            for (const after of ['<!-- redweb:realtime:start -->', '<!-- redweb:realtime:end -->']) {
                const invalid = originalReadme.replace('<!-- redweb:setup:end -->', '')
                    .replace(after, after + '\n<!-- redweb:setup:end -->');
                for (const args of [[], ['--release'], ['--check']]) {
                    fs.writeFileSync(readmeFile, invalid);
                    await expect(run(args)).rejects.toThrow('must not overlap or nest');
                    expect(fs.readFileSync(readmeFile, 'utf8')).toBe(invalid);
                    expect(fs.readFileSync(catalogueFile, 'utf8')).toBe(originalCatalogue);
                    expect(fs.readFileSync(snapshotFile, 'utf8')).toBe(originalSnapshot);
                }
            }
            fs.writeFileSync(readmeFile, originalReadme);
            expect(originalReadme).toContain(`npx --yes redweb@${version} init my-realtime --template realtime`);
            expect(originalReadme).toContain(`cd my-realtime\nnpm install --save-exact redweb@${version}`);
            expect(originalReadme).not.toContain('TARBALL');
            fs.writeFileSync(readmeFile, originalReadme.replace('increment() { this.count += 1; }', 'increment() { this.count += 2; }'));
            await expect(run(['--check'])).rejects.toThrow('README recipe is stale');
            expect(await run(['--release'])).toBe('');
            for (const name of ['setup', 'realtime', 'http-ws']) {
                const start = `<!-- redweb:${name}:start -->`;
                const end = `<!-- redweb:${name}:end -->`;
                for (const invalid of [
                    originalReadme.replace(start, ''), originalReadme.replace(end, ''),
                    originalReadme.replace(start, start + start), originalReadme.replace(end, end + end),
                    originalReadme.replace(start, '__marker__').replace(end, start).replace('__marker__', end),
                    originalReadme + `\n${start}\n${end}`,
                ]) {
                    fs.writeFileSync(readmeFile, invalid);
                    await expect(run(['--check'])).rejects.toThrow(`exactly one ${name} recipe region`);
                }
                fs.writeFileSync(readmeFile, originalReadme.replace(start, start + '\nStale content'));
                await expect(run(['--check'])).rejects.toThrow('README recipe is stale');
            }
            fs.writeFileSync(readmeFile, 'A README with no generated region.');
            await expect(run(['--check'])).rejects.toThrow('exactly one realtime recipe region');
            fs.writeFileSync(readmeFile, originalReadme);
            const guide = path.join(workspace, 'docs/GETTING_STARTED.md');
            fs.appendFileSync(guide, '\nAdditional documented behavior.\n');
            await expect(run(['--check'])).rejects.toThrow('Generated documentation is stale');
            await expect(run(['--release'])).rejects.toThrow('immutable');
            expect(fs.readFileSync(path.join(workspace, `docs/releases/${version}.json`), 'utf8').replace(/\r\n/g, '\n')).toBe(snapshot);
            expect(await run([])).toBe('');
            expect(JSON.parse(fs.readFileSync(path.join(workspace, 'docs/generated.json'), 'utf8')).channel).toBe('unreleased');
            const developmentReadme = fs.readFileSync(readmeFile, 'utf8');
            expect(developmentReadme).toContain('npx --yes --package TARBALL redweb init my-realtime --template realtime');
            expect(developmentReadme).toContain('cd my-realtime\nnpm install --save-exact TARBALL');
            expect(developmentReadme).not.toContain(`npx --yes redweb@${version}`);
            expect(await run(['--check'])).toBe('');
            fs.unlinkSync(path.join(workspace, 'docs/generated.json'));
            await expect(run(['--check'])).rejects.toThrow('Generated documentation is stale');
          },
        });
    }, 600000); // Both modes include all invalid-region cases, each with bounded owned cleanup.
});
