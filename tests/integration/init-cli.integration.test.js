'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawnSync } = require('child_process');
const { request, withTimeout } = require('../helpers/network');
const { spawnManaged, stopProcessTree } = require('../../scripts/evaluation/process');
const { USAGE } = require('../../src/cli/arguments');

const root = path.resolve(__dirname, '..', '..');
const cli = path.join(root, 'bin', 'redweb.js');

function run(args, cwd) {
    return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', shell: false, windowsHide: true, timeout: 30000 });
}

function availablePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            server.close(error => error ? reject(error) : resolve(address.port));
        });
    });
}

function waitForOutput(child, text) {
    return withTimeout(new Promise((resolve, reject) => {
        let output = '';
        child.stdout.on('data', chunk => {
            output += chunk;
            if (output.includes(text)) resolve();
        });
        child.once('error', reject);
        child.once('exit', code => reject(new Error(`Generated app exited before listening (${code}): ${output}`)));
    }), 'generated Redweb app to listen');
}

describe('redweb init CLI integration', () => {
    let workspace;
    let retainWorkspace;

    beforeEach(() => {
        workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-init-integration-'));
        retainWorkspace = false;
    });

    afterEach(() => {
        if (retainWorkspace) console.error(`Cleanup uncertain; retained CLI test workspace: ${workspace}`);
        else fs.rmSync(workspace, { recursive: true, force: true });
    });

    // Supervise the complete scenario, not just its first asynchronous operation:
    // two CLI calls + tsc allow 30s each, assets 10s, and network/startup/cleanup
    // have their own bounded waits. The default 5s can expire during compilation
    // and abandon a live child as soon as the event loop resumes under coverage.
    test('scaffolds, safely reruns, compiles, and serves through the shipped preset', async () => {
        const first = run(['init', 'game', '--template', 'site'], workspace);
        expect(first.status).toBe(0);
        expect(first.stdout).toContain('Created: package.json, tsconfig.json, src/app.tsx, src/run-app.ts, src/app.css');

        const target = path.join(workspace, 'game');
        const nodeModules = path.join(target, 'node_modules');
        fs.mkdirSync(nodeModules);
        fs.symlinkSync(root, path.join(nodeModules, 'redweb'), 'junction');
        const compiler = require.resolve('typescript/bin/tsc');
        const compiled = spawnSync(process.execPath, [compiler, '-p', target], {
            cwd: target,
            encoding: 'utf8',
            shell: false,
            windowsHide: true,
            timeout: 30000,
        });
        expect(compiled.stderr || compiled.stdout).toBe('');
        expect(compiled.status).toBe(0);
        expect(spawnSync(process.execPath, ['scripts/copy-assets.cjs'], { cwd: target, encoding: 'utf8', windowsHide: true, timeout: 10000 }).status).toBe(0);

        const port = await availablePort();
        const app = spawnManaged(['dist/app.js'], {
            cwd: target,
            env: { ...process.env, PORT: String(port) },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        // Observe closure before any asynchronous startup work: startup can fail
        // before cleanup begins. This test verifies serving, not graceful stop.
        const stopped = new Promise(resolve => app.once('close', resolve));
        app.stderr.resume();
        let failure;
        try {
            await waitForOutput(app, `:${port}`);
            const response = await request({ port });
            expect(response.status).toBe(200);
            expect(response.body).toContain('<h1>Your server-rendered app is ready.</h1>');
            expect(response.body).toContain('/__redweb/css/');
            expect(response.body).not.toContain('<script');
            const stylesheet = response.body.match(/<link rel="stylesheet" href="([^"]+)"/)[1];
            const styles = await request({ port, path: stylesheet });
            expect(styles.status).toBe(200);
            expect(styles.body).toContain('.home');
        } catch (error) { failure = error; }
        try {
            await stopProcessTree(app);
            await withTimeout(stopped, 'generated Redweb app to stop');
        } catch (cleanup) {
            retainWorkspace = true;
            // Release this test's handles without claiming the process stopped.
            app.stdout.destroy();
            app.stderr.destroy();
            app.unref();
            failure = failure ? new AggregateError([failure, cleanup], failure.message, { cause: failure }) : cleanup;
        }
        if (failure) throw failure;

        const source = path.join(target, 'src', 'app.tsx');
        fs.writeFileSync(source, 'user-owned source', 'utf8');
        const second = run(['init', 'game', '--template', 'site'], workspace);
        expect(second.status).toBe(0);
        expect(second.stdout).toContain('Kept existing: package.json, tsconfig.json, src/app.tsx, src/run-app.ts, src/app.css');
        expect(fs.readFileSync(source, 'utf8')).toBe('user-owned source');
    }, 180000);

    test('prints help and rejects unknown commands', () => {
        const help = run(['--help'], workspace);
        const invalid = run(['unknown'], workspace);
        expect(help.status).toBe(0);
        expect(help.stdout).toBe(USAGE);
        expect(invalid.status).toBe(1);
        expect(invalid.stderr).toContain('Unknown command');
    });

    test('existing-project and diagnostic commands work as real subprocesses without mutation', () => {
        const original = '{"name":"existing-app","private":true}';
        fs.writeFileSync(path.join(workspace, 'package.json'), original);
        const dry = run(['init', '--existing', '--dry-run', '--json'], workspace);
        expect(dry.status).toBe(0);
        expect(JSON.parse(dry.stdout).planned).toEqual(['tsconfig.json']);
        expect(fs.readdirSync(workspace)).toEqual(['package.json']);
        const init = run(['init', '--existing', '--json'], workspace);
        expect(init.status).toBe(0);
        expect(JSON.parse(init.stdout).created).toEqual(['tsconfig.json']);
        expect(fs.readFileSync(path.join(workspace, 'package.json'), 'utf8')).toBe(original);
        expect(fs.existsSync(path.join(workspace, 'src'))).toBe(false);

        const missing = run(['doctor', '--json'], workspace);
        expect(missing.status).toBe(1);
        expect(JSON.parse(missing.stdout).issues.map(issue => issue.code)).toContain('REDWEB_MISSING');
        fs.mkdirSync(path.join(workspace, 'node_modules'));
        fs.symlinkSync(root, path.join(workspace, 'node_modules', 'redweb'), 'junction');
        fs.symlinkSync(path.dirname(require.resolve('typescript/package.json')), path.join(workspace, 'node_modules', 'typescript'), 'junction');
        fs.mkdirSync(path.join(workspace, 'src'));
        fs.writeFileSync(path.join(workspace, 'src', 'app.tsx'), 'throw new Error("Application code must not execute during doctor"); export {};');
        const inspected = run(['doctor', '--json', '--port', '0'], workspace);
        expect(inspected.status).toBe(0);
        expect(JSON.parse(inspected.stdout).issues).toEqual([]);
        expect(fs.existsSync(path.join(workspace, 'dist'))).toBe(false);
        fs.writeFileSync(path.join(workspace, 'tsconfig.json'), '{"compilerOptions":{"jsx":"react-jsx","jsxImportSource":"react"},"include":["src/**/*"]}');
        const wrongRuntime = run(['doctor', '--json'], workspace);
        expect(wrongRuntime.status).toBe(1);
        expect(JSON.parse(wrongRuntime.stdout).issues.map(issue => issue.code)).toContain('JSX_RUNTIME_MISMATCH');
    });
});
