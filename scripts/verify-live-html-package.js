'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        encoding: 'utf8',
        shell: process.platform === 'win32',
        ...options,
    });
    if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
    return result.stdout;
}

async function main() {
    const root = path.resolve(__dirname, '..');
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-live-package-'));
    try {
        const pack = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', workspace], { cwd: root }));
        const archive = path.join(workspace, pack[0].filename);
        run('tar', ['-xf', archive, '-C', workspace]);
        const packageRoot = path.join(workspace, 'package');
        fs.symlinkSync(path.join(root, 'node_modules'), path.join(packageRoot, 'node_modules'), 'junction');
        const installed = require(packageRoot);
        class SmokePage extends installed.LivePage {
            constructor() {
                super();
                this.message = 'packed';
            }
            render() { return '<p>{{ message }}</p>'; }
        }
        installed.state()(SmokePage.prototype, 'message');
        installed.page('/')(SmokePage);
        const server = new installed.LiveHtmlServer({ pages: [SmokePage], listen: false });
        const runtime = server.manager.records.get('/');
        if (!runtime || !require.resolve('redweb-client', { paths: [packageRoot] })) {
            throw new Error('Packed Live HTML runtime or client dependency is missing.');
        }
        const rendered = await server.manager.render(runtime, { params: {}, query: {}, body: undefined });
        if (!rendered.includes('data-rw-state="message">packed</span>')) {
            throw new Error('Packed Live HTML server did not render decorated state.');
        }
        await server.shutdown();
        console.log(`Live HTML package gate passed: ${pack[0].filename} extracted, loaded, and rendered in isolation.`);
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
