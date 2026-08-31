'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { FrozenCoverage } = require('../helpers/FrozenCoverage');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const root = path.resolve(__dirname, '../..');
const filename = path.join(root, 'scripts/evaluation/prepare.js');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const temporaryEnvironment = directory => ({ TEMP: directory, TMP: directory, TMPDIR: directory });

test('unchanged preparation CLI snapshots the real package and catalogue identically in plain and instrumented modes', async () => {
    const before = hash(filename);
    let plain;
    for (const mode of ['plain', 'instrumented']) {
        await new VerificationWorkspace().run(async owner => {
            const coverage = mode === 'instrumented' ? new FrozenCoverage(owner.directory, 'scripts/evaluation/prepare.js') : null;
            const stdout = await owner.command([filename], {
                cwd: root, timeoutMs: 120000, rejectTruncatedOutput: true,
                environment: { ...temporaryEnvironment(owner.directory), ...coverage?.environment },
            });
            const manifest = JSON.parse(stdout);
            const relative = path.relative(owner.directory, manifest.workspace);
            expect(relative.startsWith('framework-adoption-')).toBe(true);
            expect(path.dirname(relative)).toBe('.');
            expect(JSON.parse(fs.readFileSync(path.join(manifest.workspace, 'manifest.json'), 'utf8'))).toEqual(manifest);
            expect(manifest.archiveSha256).toBe(hash(manifest.archive));
            expect(manifest.catalogueSha256).toBe(hash(manifest.documentation));
            expect(manifest.catalogueSha256).toBe(hash(path.join(root, 'docs/generated.json')));
            expect(manifest.sourceCommit).toBe((await owner.command(['rev-parse', 'HEAD'], { executable: 'git', cwd: root })).trim());
            expect(manifest.node).toBe(process.version);
            expect(manifest.platform).toBe(process.platform);
            expect(manifest.arch).toBe(process.arch);
            expect(Number.isFinite(Date.parse(manifest.createdAt))).toBe(true);
            for (const name of ['assigned', 'discovery']) expect(fs.readdirSync(path.join(manifest.workspace, name))).toEqual([]);
            const identity = { archive: manifest.archiveSha256, catalogue: manifest.catalogueSha256, commit: manifest.sourceCommit };
            if (plain) expect(identity).toEqual(plain);
            else plain = identity;
            coverage?.collect();
        });
    }
    expect(hash(filename)).toBe(before);
}, 240000);

test('preparation reports an actual failed npm launch without creating a success manifest', async () => {
    await new VerificationWorkspace().run(async owner => {
        const coverage = new FrozenCoverage(owner.directory, 'scripts/evaluation/prepare.js');
        const absent = path.join(owner.directory, 'absent-source');
        await expect(owner.command(['-e', `require(${JSON.stringify(filename)}).prepare(${JSON.stringify(absent)})`], {
            environment: { ...temporaryEnvironment(owner.directory), ...coverage.environment },
        })).rejects.toThrow(/npm failed:.*ENOENT/);
        const workspaces = fs.readdirSync(owner.directory).filter(name => name.startsWith('framework-adoption-'));
        expect(workspaces).toHaveLength(1);
        expect(fs.existsSync(path.join(owner.directory, workspaces[0], 'manifest.json'))).toBe(false);
        coverage.collect();
        // The frozen implementation retains failed preparation; this test's
        // outer owner removes only its own directory, not sealed trial data.
    });
});
