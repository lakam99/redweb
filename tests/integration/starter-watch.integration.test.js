const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const ProjectInitializer = require('../../src/cli/ProjectInitializer');
const { request } = require('../helpers/network');
const { version } = require('../../package.json');

async function eventually(check, description) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        try { if (await check()) return; } catch { /* A restarting server may temporarily refuse connections. */ }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out: ${description}`);
}

test('the generated dev command rebuilds TSX/CSS, refuses type errors, and recovers', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-watch-'));
    const root = path.resolve(__dirname, '../..');
    const reservation = net.createServer();
    await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    let child;
    let output = '';
    try {
        new ProjectInitializer(version).initialize(workspace, { template: 'site' });
        fs.mkdirSync(path.join(workspace, 'node_modules'));
        for (const [name, location] of [
            ['redweb', root], ['typescript', path.dirname(require.resolve('typescript/package.json'))],
            ['nodemon', path.dirname(require.resolve('nodemon/package.json'))],
            ['.bin', path.join(root, 'node_modules/.bin')],
        ]) fs.symlinkSync(location, path.join(workspace, 'node_modules', name), 'junction');
        child = spawn('npm', ['run', 'dev'], {
            cwd: workspace, shell: process.platform === 'win32', windowsHide: true,
            detached: process.platform !== 'win32', env: { ...process.env, PORT: String(port) },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        child.stdout.on('data', chunk => { output += chunk; });
        child.stderr.on('data', chunk => { output += chunk; });
        await eventually(async () => (await request({ port })).body.includes('Your server-rendered app is ready.'), 'initial app');
        const source = path.join(workspace, 'src/app.tsx');
        const changed = fs.readFileSync(source, 'utf8').replace('Your server-rendered app is ready.', 'Updated by watch');
        fs.writeFileSync(source, changed);
        await eventually(async () => (await request({ port })).body.includes('Updated by watch'), 'TSX rebuild');
        fs.appendFileSync(path.join(workspace, 'src/app.css'), '\n.watch-proof { color: gold; }\n');
        await eventually(async () => {
            const document = (await request({ port })).body;
            const url = document.match(/<link rel="stylesheet" href="([^"]+)"/)[1];
            return (await request({ port, path: url })).body.includes('.watch-proof');
        }, 'stylesheet rebuild');
        fs.writeFileSync(source, `${changed}\nconst invalid: number = 'not a number';\n`);
        await eventually(() => output.includes('TS2322'), 'type failure reported');
        await eventually(() => output.includes('app crashed'), 'watcher remains alive after the compiler exits');
        expect(output).not.toContain('EADDRINUSE');
        fs.writeFileSync(source, changed.replace('Updated by watch', 'Recovered after type error'));
        await eventually(async () => (await request({ port })).body.includes('Recovered after type error'), 'type repair rebuild');
    } catch (error) {
        throw new Error(`${error.message}\n${output}`);
    } finally {
        if (child?.pid) {
            // Terminate only this test's spawned process tree; never match processes by executable name.
            if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
            else process.kill(-child.pid, 'SIGTERM');
            if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
        }
        fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
}, 70000);
