'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runBuild, npmEntrypoint, stopProcessTree, listenerAddresses } = require('../../scripts/evaluation/process');
const { startApplication } = require('../../scripts/evaluation/verify');

describe('evaluation process runner with actual subprocesses', () => {
    let root;
    beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'evaluation-process-test-')); });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
    function fixture(source) {
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { build: 'node build.cjs' } }));
        fs.writeFileSync(path.join(root, 'build.cjs'), source);
    }
    test('finds real npm and captures a successful build', async () => {
        expect(fs.existsSync(npmEntrypoint())).toBe(true);
        fixture('console.log("built actual fixture"); console.error("diagnostic");');
        const result = await runBuild(root);
        expect(result.exitCode).toBe(0);
        expect(result.error).toBeUndefined();
        expect(result.stdout).toContain('built actual fixture');
        expect(result.stderr).toContain('diagnostic');
        expect(Date.parse(result.endedAt)).toBeGreaterThanOrEqual(Date.parse(result.startedAt));
    });
    test('retains nonzero production build failure', async () => {
        fixture('console.error("invalid application"); process.exitCode = 7;');
        const result = await runBuild(root);
        expect(result.exitCode).toBe(7);
        expect(result.stderr).toContain('invalid application');
    });
    test('bounds captured output without deadlocking a verbose child', async () => {
        fixture('process.stdout.write("x".repeat(2 * 1024 * 1024)); process.stderr.write("y".repeat(2 * 1024 * 1024));');
        const result = await runBuild(root);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toHaveLength(1024 * 1024);
        expect(result.stderr).toHaveLength(1024 * 1024);
    });
    test('terminates a timed-out build and its actual descendant', async () => {
        fixture(`const child = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
            require('fs').writeFileSync('child.pid', String(child.pid)); setInterval(() => {}, 1000);`);
        const result = await runBuild(root, 2000);
        expect(result.error).toContain('Timed out waiting for production build');
        const pid = Number(fs.readFileSync(path.join(root, 'child.pid'), 'utf8'));
        expect(() => process.kill(pid, 0)).toThrow();
    }, 12000);
    test.each(['success', 'invalid-url'])('cleans managed application descendants after %s', async mode => {
        fs.writeFileSync(path.join(root, 'app.cjs'), `const child = require('child_process').spawn(process.execPath,
            ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: ${process.platform === 'win32'} });
            require('fs').writeFileSync('child.pid', String(child.pid));
            console.log(JSON.stringify({ url: ${JSON.stringify(mode === 'success' ? 'http://127.0.0.1:12345' : 'http://0.0.0.0:12345')} }));
            setInterval(() => {}, 1000);`);
        if (mode === 'success') {
            const app = await startApplication(root, {}, 'app.cjs');
            await stopProcessTree(app.child);
        } else await expect(startApplication(root, {}, 'app.cjs')).rejects.toThrow('ephemeral loopback HTTP URL');
        const pid = Number(fs.readFileSync(path.join(root, 'child.pid'), 'utf8'));
        expect(() => process.kill(pid, 0)).toThrow();
    }, 12000);
    test('rejects invalid listener inspection arguments before invoking a shell', () => {
        expect(() => listenerAddresses(0)).toThrow('Invalid listener port');
        expect(() => listenerAddresses('12; exit')).toThrow('Invalid listener port');
    });
});
