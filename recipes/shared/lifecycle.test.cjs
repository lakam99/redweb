const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

function execute(t, args, env = process.env) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, { env, windowsHide: true });
        let stdout = '', stderr = '', finished = false;
        const closed = new Promise(resolve => child.once('close', () => { finished = true; resolve(); }));
        const deadline = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Entrypoint did not exit')); }, 5000);
        t.after(async () => {
            clearTimeout(deadline);
            if (!finished) { child.kill('SIGKILL'); await closed; }
        });
        child.stdout.on('data', data => { stdout += data; });
        child.stderr.on('data', data => { stderr += data; });
        child.once('error', reject);
        child.once('close', (code, signal) => { clearTimeout(deadline); resolve({ code, signal, stdout, stderr }); });
    });
}

// Each generated app is tested in a real process. Framework deadline/failure
// coverage lives with Application itself, not in six copied startup helpers.
for (const mode of ['SIGINT', 'SIGTERM', 'native-close']) {
    test(`import is inert; application owns ${mode} cleanup`, { timeout: 7000 }, async t => {
        const result = await execute(t, ['-e', String.raw`
            const assert = require('node:assert/strict');
            const { once } = require('node:events');
            const { defineApp } = require('redweb');
            const initial = ['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal));
            const source = require('./dist/app');
            assert.deepEqual(['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal)), initial);
            const app = source.app
                ? defineApp({ ...source.app.options, port: 0, bind: '127.0.0.1', logger: null })
                : source.createApp({ port: 0, database: ':memory:' });
            assert.equal(app.server, null);
            (async () => {
                const running = await app.run();
                const response = await fetch('http://127.0.0.1:' + running.server.address().port, { headers: { Connection: 'close' } });
                assert.ok(response.status < 500);
                await response.arrayBuffer();
                const closed = once(running.server, 'close');
                if (process.argv[1] === 'native-close') {
                    running.server.close();
                } else {
                    // Windows kill does not deliver a graceful POSIX signal.
                    if (process.platform === 'win32') process.emit(process.argv[1]);
                    else process.kill(process.pid, process.argv[1]);
                }
                await closed;
                await app.shutdown();
                assert.equal(running.server.listening, false);
                assert.deepEqual(['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal)), initial);
            })().catch(error => { console.error(error); process.exitCode = 1; });
        `, mode]);
        assert.equal(result.code, 0, result.stdout + result.stderr);
        assert.equal(result.signal, null);
    });
}

test('the actual application entrypoint reports an occupied port', { timeout: 7000 }, async t => {
    const net = require('node:net');
    const occupied = net.createServer(socket => socket.destroy());
    const loopback = net.createServer(socket => socket.destroy());
    t.after(async () => {
        for (const server of [occupied, loopback]) await new Promise(resolve => server.close(resolve));
    });
    occupied.listen(0, '0.0.0.0');
    await once(occupied, 'listening');
    // Windows may allow separate wildcard and loopback binds to the same port.
    loopback.listen(occupied.address().port, '127.0.0.1');
    try { await once(loopback, 'listening'); }
    catch (error) { assert.equal(error.code, 'EADDRINUSE'); }
    const env = { ...process.env, PORT: String(occupied.address().port), NODE_ENV: 'test', DASHBOARD_DATABASE: ':memory:' };
    delete env.DASHBOARD_ORIGIN;
    const result = await execute(t, ['dist/app.js'], env);
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.equal(result.signal, null);
    assert.match(result.stderr, /EADDRINUSE/);
});
