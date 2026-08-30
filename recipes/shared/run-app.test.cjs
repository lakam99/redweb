const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawn } = require('node:child_process');

// Each case uses its own Node process, real HTTP/TCP/WS resources and real timers.
// Windows cannot deliver POSIX signals through child.kill, so only that platform
// explicitly emits the signal event inside the child. Linux uses real OS signals.
const fixture = String.raw`
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');
const WebSocket = require('ws');
const mode = process.argv[1];
const signals = ['SIGINT', 'SIGTERM'];
const initial = signals.map(signal => process.listenerCount(signal));
const { runApp } = require('./dist/run-app.js');
assert.deepEqual(signals.map(signal => process.listenerCount(signal)), initial);
require('./dist/app.js');
assert.deepEqual(signals.map(signal => process.listenerCount(signal)), initial);
let cleanups = 0;
process.once('beforeExit', () => console.log(JSON.stringify({ cleanups, signals: signals.map(signal => process.listenerCount(signal)), initial })));
const signal = name => process.platform === 'win32' ? process.emit(name) : process.kill(process.pid, name);
if (mode === 'invalid') {
    for (const value of [0, -1, NaN, Infinity, 1.5, 2147483648]) assert.throws(() => runApp(() => { throw Error('must not execute'); }, value), RangeError);
} else if (mode === 'factory') {
    assert.equal(runApp(() => { throw Error('private startup detail'); }), undefined);
} else {
    if (mode === 'preserve') process.exitCode = '7';
    const server = http.createServer((_request, response) => response.end('ready'));
    const wss = new WebSocket.Server({ server });
    wss.on('error', () => {}); // The HTTP listener error is owned by runApp.
    const peers = new Set();
    server.on('connection', peer => { peers.add(peer); peer.on('close', () => peers.delete(peer)); });
    const close = async () => {
        for (const peer of peers) peer.destroy();
        for (const peer of wss.clients) peer.terminate();
        await new Promise(resolve => wss.close(resolve));
        await new Promise(resolve => server.close(resolve));
    };
    const app = runApp(() => ({ server, shutdown() {
        cleanups++;
        console.log('cleanup-started');
        if (mode === 'throw') { void close(); throw Error('private cleanup detail'); }
        if (mode === 'reject-open') return Promise.reject(Error('private cleanup detail'));
        return close().then(async () => {
            if (mode === 'hung') return new Promise(() => {});
            if (mode === 'reject') throw Error('private cleanup detail');
            if (mode === 'repeat') {
                signal('SIGINT'); signal('SIGTERM');
                server.emit('error', Error('private listener detail'));
            }
            await new Promise(resolve => setTimeout(resolve, 20));
        });
    } }), 200);
    assert.equal(app.server, server);
    (async () => {
        if (mode === 'occupied') {
            const other = http.createServer();
            await new Promise(resolve => other.listen(0, '127.0.0.1', resolve));
            server.once('error', () => other.close());
            server.listen(other.address().port, '127.0.0.1');
            return;
        }
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const port = server.address().port;
        const response = await fetch('http://127.0.0.1:' + port);
        assert.equal(await response.text(), 'ready');
        const peer = net.connect(port, '127.0.0.1');
        peer.on('error', () => {});
        await once(peer, 'connect');
        peer.write('GET / HTTP/1.1\r\nHost: localhost\r\n');
        const socket = new WebSocket('ws://127.0.0.1:' + port);
        socket.on('error', () => {});
        await once(socket, 'open');
        if (mode === 'native-close') {
            for (const connection of peers) connection.destroy();
            server.close();
            return;
        }
        // A partial HTTP peer otherwise prevents native close; application cleanup
        // begins via the signal and the later native close must not end its timer.
        signal(mode === 'interrupt' ? 'SIGINT' : 'SIGTERM');
    })().catch(error => { console.error(error); process.exit(99); });
}
`;

function execute(mode, t) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['-e', fixture, mode], { cwd: process.cwd(), windowsHide: true });
        let stdout = '', stderr = '';
        let timedOut = false, finished = false;
        const closed = new Promise(resolve => child.once('close', () => { finished = true; resolve(); }));
        const deadline = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 5000);
        t.after(async () => {
            clearTimeout(deadline);
            if (!finished) { child.kill('SIGKILL'); await closed; }
        });
        child.stdout.on('data', data => { stdout += data; });
        child.stderr.on('data', data => { stderr += data; });
        child.once('error', reject);
        child.once('close', (code, signal) => {
            clearTimeout(deadline);
            if (timedOut) reject(new Error(`Lifecycle child timed out: ${mode}\n${stdout}\n${stderr}`));
            else resolve({ code, signal, stdout, stderr });
        });
    });
}

for (const mode of ['normal', 'interrupt', 'native-close', 'invalid', 'factory', 'throw', 'reject', 'reject-open', 'hung', 'occupied', 'repeat', 'preserve']) {
    test(`entrypoint cleanup: ${mode}`, { timeout: 7000 }, async t => {
        const result = await execute(mode, t);
        const expected = ['normal', 'interrupt', 'native-close', 'invalid'].includes(mode) ? 0 : mode === 'preserve' ? 7 : 1;
        assert.equal(result.code, expected, `${result.stdout}\n${result.stderr}`);
        assert.equal(result.signal, null);
        assert.doesNotMatch(result.stderr, /private .* detail/);
        const noApp = ['invalid', 'factory'].includes(mode);
        assert.equal((result.stdout.match(/cleanup-started/g) || []).length, noApp ? 0 : 1);
        if (['hung', 'reject-open'].includes(mode)) assert.match(result.stderr, /exceeded its deadline/);
        if (['normal', 'interrupt', 'native-close', 'invalid', 'factory', 'preserve'].includes(mode)) {
            const snapshot = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
            assert.deepEqual(snapshot.signals, snapshot.initial);
        }
    });
}
