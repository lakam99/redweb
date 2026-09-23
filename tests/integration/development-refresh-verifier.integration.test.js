'use strict';

const http = require('node:http');
const net = require('node:net');
const { WebSocket, WebSocketServer } = require('ws');
const { main, availablePort, closePage } = require('../../scripts/verify-development-refresh-browser');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { waitForListening, withTimeout } = require('../helpers/network');

// Run the canonical gate, including actual generated npm watchers, TypeScript
// rebuilds, Chromium input/drafts and process cleanup. No API replacements.
test('development verifier exercises actual generated-app rebuild and browser refresh', async () => {
    await main();
}, 300000);

test('a reserved native port is released before it is returned', async () => {
    const owner = {};
    const port = await availablePort(owner);
    const server = net.createServer();
    try {
        server.listen(port, '127.0.0.1');
        await waitForListening(server);
        expect(server.address().port).toBe(port);
        expect(owner.cleanupFailure).toBeUndefined();
    } finally { await new Promise(resolve => server.close(resolve)); }
});

test('a real failed DevTools HTTP close still disconnects its actual socket', async () => {
    const server = http.createServer((_request, response) => { response.writeHead(500); response.end('close failed'); });
    const sockets = new WebSocketServer({ server });
    let socket;
    try {
        server.listen(0, '127.0.0.1'); await waitForListening(server);
        socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/devtools/page/owned`);
        await withTimeout(new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); }), 'actual DevTools socket');
        const closed = new Promise(resolve => socket.once('close', resolve));
        await expect(closePage({ socket }, server.address().port)).rejects.toThrow('DevTools page close must succeed');
        await withTimeout(closed, 'failed HTTP close socket release');
        expect(socket.readyState).toBe(WebSocket.CLOSED);
    } finally {
        socket?.terminate();
        for (const client of sockets.clients) client.terminate();
        await new Promise(resolve => sockets.close(resolve));
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});

test('an adverse actual DevTools peer permits watcher cleanup and natural verifier exit', async () => {
    const peer = http.createServer((_request, response) => response.end('invalid DevTools JSON'));
    peer.listen(0, '127.0.0.1'); await waitForListening(peer);
    try {
        await new VerificationWorkspace().run(async execution => {
            const output = await execution.command(['-e', `
                const assert = require('node:assert/strict');
                const fs = require('node:fs');
                const { verifyTemplate } = require(${JSON.stringify(require.resolve('../../scripts/verify-development-refresh-browser'))});
                const { VerificationWorkspace } = require(${JSON.stringify(require.resolve('../../scripts/lib/VerificationWorkspace'))});
                const { BrowserPages } = require(${JSON.stringify(require.resolve('../../scripts/lib/BrowserPages'))});
                const { openPage } = require(${JSON.stringify(require.resolve('../../scripts/verify-live-html-browser'))});
                const { withTimeout } = require(${JSON.stringify(require.resolve('../helpers/network'))});
                const owner = new VerificationWorkspace();
                owner.run(async execution => {
                    const pages = new BrowserPages(execution, openPage, (promise, label) => withTimeout(promise, label, 15000));
                    try { await verifyTemplate(execution, ${peer.address().port}, 'realtime', (port, url) => pages.open(port, url)); }
                    finally { await pages.close(); }
                }).then(() => { throw new Error('Expected DevTools setup failure'); }, error => {
                    assert(error.cause instanceof SyntaxError);
                    assert.equal(owner.cleanupFailure, null);
                    assert.equal(fs.existsSync(owner.directory), false);
                    console.log('Original setup failure retained; watcher exited and workspace removed');
                }).catch(error => { console.error(error); process.exitCode = 1; });
            `], { timeoutMs: 90000 });
            expect(output).toContain('Original setup failure retained; watcher exited and workspace removed');
        });
    } finally { peer.closeAllConnections(); await new Promise(resolve => peer.close(resolve)); }
}, 120000);
