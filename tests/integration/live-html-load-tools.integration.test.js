'use strict';

const http = require('node:http');
const path = require('node:path');
const { WebSocketServer, WebSocket } = require('ws');
const { readLiveHtmlPage } = require('../../scripts/lib/readLiveHtmlPage');
const { LiveHtmlLoadClient } = require('../../scripts/lib/LiveHtmlLoadClient');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { withTimeout, waitForCondition } = require('../helpers/network');
const { waitFor: waitForEvent } = require('../../scripts/realtime-harness');

// Supervision includes acquisition + the complete operation + every cleanup.
// HTTP: listen5 + response10 + local-close5 + observation1 + fixture-close5.
// WS: listen5 + acquisition/acceptance15 + condition10 + explicit-close10 + retry-close10 + fixture-close5.
const HTTP_TEST_MS = 35000;
const SOCKET_TEST_MS = 60000;

const config = { pageId: 'native-page', socketPath: '/live', version: '1' };
const document = value => `<script type="application/json" id="__redweb_page">${JSON.stringify(value)}</script>`;

async function withHttp(handler, exercise) {
    const server = http.createServer(handler), sockets = new Set(), failures = [];
    let result;
    server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    try {
        await waitForEvent(server, 'listening', 5000, () => server.listen(0, '127.0.0.1'));
        result = await exercise(server.address().port, sockets, server);
    } catch (error) { failures.push(error); }
    for (const socket of sockets) socket.destroy();
    try { await withTimeout(new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())), 'native HTTP cleanup', 5000); }
    catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'Native HTTP fixture failed', { cause: failures[0] });
    return result;
}

test('native bootstrap HTTP response is parsed and its non-pooled transport closes', () => withHttp(
    (_request, response) => response.end(document(config)), async (port, sockets) => {
        expect(await readLiveHtmlPage(port)).toEqual(config);
        await waitForCondition(() => sockets.size === 0, 'HTTP transport closed', 1000);
    }), HTTP_TEST_MS);

test.each(['bad-json', 'missing-bootstrap', 'bad-status', 'aborted', 'oversized', 'invalid-config'])
('native bootstrap rejects %s and releases its connection', mode => withHttp((_request, response) => {
    if (mode === 'aborted') { response.writeHead(200, { 'Content-Length': '1000' }); response.write('partial'); setImmediate(() => response.destroy()); }
    else if (mode === 'oversized') response.end(Buffer.alloc(1024 * 1024 + 1));
    else if (mode === 'bad-json') response.end('<script type="application/json" id="__redweb_page">{invalid</script>');
    else if (mode === 'bad-status') { response.statusCode = 500; response.end(document(config)); }
    else response.end(mode === 'missing-bootstrap' ? 'empty' : document(null));
}, async (port, sockets) => {
    await expect(readLiveHtmlPage(port)).rejects.toThrow();
    await waitForCondition(() => sockets.size === 0, 'failed HTTP transport closed', 1000);
}), HTTP_TEST_MS);

test('native silent HTTP response hits its real deadline and releases the peer', () => withHttp(() => {}, async (port, sockets) => {
    await expect(readLiveHtmlPage(port)).rejects.toThrow('timed out');
    await waitForCondition(() => sockets.size === 0, 'silent HTTP transport closed', 1000);
}), HTTP_TEST_MS);

async function withWebSocket(exercise) {
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' }), failures = [], updates = [];
    let owner;
    try {
        await waitForEvent(server, 'listening');
        owner = new LiveHtmlLoadClient(server.address().port, config, updates);
        const connected = waitForEvent(server, 'connection', 15000);
        const [connecting, accepted] = await Promise.allSettled([owner.connect(), connected]);
        if (connecting.status === 'rejected') throw connecting.reason;
        if (accepted.status === 'rejected') throw accepted.reason;
        const [peer] = accepted.value;
        await exercise(owner, peer, updates);
    } catch (error) { failures.push(error); }
    try { await owner?.close(); } catch (error) { failures.push(error); }
    for (const peer of server.clients) peer.terminate();
    try { await withTimeout(new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())), 'native socket cleanup', 5000); }
    catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'Native socket fixture failed', { cause: failures[0] });
}

test('actual client records valid patches and confirms native closure', () => withWebSocket(async (owner, peer, updates) => {
    peer.send(JSON.stringify({ v: '1', type: 'redweb:patch', payload: { patches: [{ html: '<p>actual</p>' }] } }));
    await waitForCondition(() => updates.length === 1, 'actual patch');
    expect(updates[0].html).toBe('<p>actual</p>'); owner.check();
    const sockets = [...owner.sockets];
    await owner.close(); await owner.close();
    expect(sockets.every(socket => socket.readyState === WebSocket.CLOSED)).toBe(true);
    expect(owner.sockets.size).toBe(0); owner.check();
}), SOCKET_TEST_MS);

test.each(['bad-patch', 'bad-protocol', 'protocol-error', 'disconnect'])
('actual client latches %s rather than silently accepting it', mode => withWebSocket(async (owner, peer) => {
    if (mode === 'disconnect') peer.close();
    else if (mode === 'bad-protocol') peer.send('{');
    else if (mode === 'protocol-error') peer.send(JSON.stringify({ v: '1', type: 'error', error: { code: 'FAILED', message: 'Denied' } }));
    else peer.send(JSON.stringify({ v: '1', type: 'redweb:patch', payload: { patches: [] } }));
    await waitForCondition(() => owner.failure !== null, 'latched client failure');
    const failure = owner.failure;
    expect(() => owner.check()).toThrow(failure);
    await owner.close(); expect(owner.failure).toBe(failure);
}), SOCKET_TEST_MS);

test('actual paused peer is forcibly closed after its bounded handshake wait', () => withWebSocket(async (owner, peer) => {
    peer._socket.pause();
    const sockets = [...owner.sockets];
    await owner.close();
    expect(sockets.every(socket => socket.readyState === WebSocket.CLOSED)).toBe(true);
    peer._socket.resume();
}), SOCKET_TEST_MS);

test('actual unanswered upgrade fails and its connecting socket is owned through cleanup', () => withHttp(() => {}, async (port, sockets, server) => {
    // An upgraded HTTP raw socket allows a half-open writable side. Consume the
    // client's FIN and finish that owned side, without answering the upgrade.
    server.on('upgrade', (_request, socket) => { socket.once('end', () => socket.end()); socket.resume(); });
    const owner = new LiveHtmlLoadClient(port, config, []);
    try { await expect(owner.connect()).rejects.toThrow(); }
    finally { await owner.close(); }
    expect(owner.sockets.size).toBe(0);
    await waitForCondition(() => sockets.size === 0, 'unanswered upgrade peer closure', 1000);
}), SOCKET_TEST_MS);

test('real CLI requires GC and completes the unchanged default HTML load workload', () => new VerificationWorkspace().run(async owner => {
    const script = path.resolve(__dirname, '../../scripts/verify-live-html-load.js');
    await expect(owner.command([script], { timeoutMs: 10000 })).rejects.toThrow('--expose-gc');
    const output = await owner.command(['--expose-gc', script], { timeoutMs: 180000, rejectTruncatedOutput: true });
    expect(output).toMatch(/^Live HTML load gate passed: 200 expired renders, 110 live clients, heap delta -?\d+ bytes\.\s*$/);
}), 215000);
