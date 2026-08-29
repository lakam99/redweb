'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const { request, withTimeout } = require('../helpers/network');

const root = path.resolve(__dirname, '..', '..');
const cli = path.join(root, 'bin', 'redweb.js');

function run(args, cwd) {
    return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', shell: false });
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

    beforeEach(() => {
        workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-init-integration-'));
    });

    afterEach(() => {
        fs.rmSync(workspace, { recursive: true, force: true });
    });

    test('scaffolds, safely reruns, compiles, and serves through the shipped preset', async () => {
        const first = run(['init', 'game'], workspace);
        expect(first.status).toBe(0);
        expect(first.stdout).toContain('Created: package.json, tsconfig.json, src/app.tsx, src/app.css');

        const target = path.join(workspace, 'game');
        const nodeModules = path.join(target, 'node_modules');
        fs.mkdirSync(nodeModules);
        fs.symlinkSync(root, path.join(nodeModules, 'redweb'), 'junction');
        const compiler = require.resolve('typescript/bin/tsc');
        const compiled = spawnSync(process.execPath, [compiler, '-p', target], {
            cwd: target,
            encoding: 'utf8',
            shell: false,
        });
        expect(compiled.stderr || compiled.stdout).toBe('');
        expect(compiled.status).toBe(0);

        const port = await availablePort();
        const app = spawn(process.execPath, ['dist/app.js'], {
            cwd: target,
            env: { ...process.env, PORT: String(port) },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        try {
            await waitForOutput(app, `:${port}`);
            const response = await request({ port });
            expect(response.status).toBe(200);
            expect(response.body).toContain('<h1>Your server-rendered app is ready.</h1>');
            expect(response.body).toContain('/__redweb/css/');
            expect(response.body).not.toContain('<script');
        } finally {
            const stopped = new Promise(resolve => app.once('exit', resolve));
            app.kill();
            await withTimeout(stopped, 'generated Redweb app to stop');
        }

        const source = path.join(target, 'src', 'app.tsx');
        fs.writeFileSync(source, 'user-owned source', 'utf8');
        const second = run(['init', 'game'], workspace);
        expect(second.status).toBe(0);
        expect(second.stdout).toContain('Kept existing: package.json, tsconfig.json, src/app.tsx, src/app.css');
        expect(fs.readFileSync(source, 'utf8')).toBe('user-owned source');
    });

    test('prints help and rejects unknown commands', () => {
        const help = run(['--help'], workspace);
        const invalid = run(['unknown'], workspace);
        expect(help.status).toBe(0);
        expect(help.stdout).toBe('Usage: redweb init [directory]\n');
        expect(invalid.status).toBe(1);
        expect(invalid.stderr).toBe('Usage: redweb init [directory]\n');
    });
});
