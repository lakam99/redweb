'use strict';

const http = require('node:http');
const { WebSocketServer } = require('ws');
const { verifyActionApplication } = require('../../scripts/lib/verify-action-input');
const { waitFor, closeClient } = require('../../scripts/realtime-harness');
const { withTimeout } = require('../helpers/network');
const { settleTasks } = require('../../src/serverLifecycle');

test.each(['http-status', 'json', 'missing-config', 'denied-upgrade', 'silent-upgrade', 'malformed-action',
    'closed-action', 'silent-action'])('action verifier against actual faulty HTTP/WebSocket peer: %s', async mode => {
    const transports = new Set(), peers = [];
    const cleanupErrors = [];
    let shutdowns = 0, upgrades = 0;
    const config = { version: '1', pageId: 'native', socketPath: '/live' };
    const server = http.createServer((_request, response) => {
        response.writeHead(mode === 'http-status' ? 503 : 200, { 'content-type': 'text/html' });
        response.end(mode === 'missing-config' ? '<p>No bootstrap</p>' :
            `<script id="__redweb_page">${mode === 'json' ? '{' : JSON.stringify(config)}</script>`);
    });
    server.on('connection', socket => { transports.add(socket); socket.once('close', () => transports.delete(socket)); });
    const ws = new WebSocketServer({ noServer: true });
    server.on('upgrade', (request, socket, head) => {
        upgrades++;
        if (mode === 'silent-upgrade') return;
        if (mode === 'denied-upgrade') { socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return; }
        ws.handleUpgrade(request, socket, head, peer => {
            peers.push(peer);
            peer.on('message', () => {
                if (mode === 'malformed-action') peer.send('{');
                else if (mode === 'closed-action') peer.close();
            });
        });
    });
    const shutdown = async () => {
        shutdowns++;
        for (const peer of peers) {
            try { await closeClient(peer); } catch (error) { cleanupErrors.push(error); }
        }
        for (const socket of transports) socket.destroy();
        cleanupErrors.push(...await settleTasks([
            () => withTimeout(new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())), 'faulty action HTTP closure', 5000),
            () => withTimeout(new Promise((resolve, reject) => ws.close(error => error ? reject(error) : resolve())), 'faulty action WS closure', 5000),
        ]));
        if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Faulty action peer cleanup failed', { cause: cleanupErrors[0] });
    };
    let failure, assertionFailure;
    try {
        await waitFor(server, 'listening', 5000, () => server.listen(0, '127.0.0.1'));
        failure = await verifyActionApplication({ server, shutdown, revoke: async () => { throw new Error('Faulty peer must not reach revocation'); } })
            .then(() => undefined, error => error);
        expect(failure).toBeInstanceOf(AggregateError);
        expect(failure.cleanupFailed).toBe(false);
        expect(shutdowns).toBe(1); expect(cleanupErrors).toEqual([]);
        expect(server.listening).toBe(false);
        expect(peers.every(peer => peer.readyState === peer.CLOSED)).toBe(true);
        expect(upgrades).toBe(['http-status', 'json', 'missing-config'].includes(mode) ? 0 : 1);
        if (mode === 'malformed-action') expect(failure.errors[0]).toBeInstanceOf(SyntaxError);
    } catch (error) { assertionFailure = error; }
    // Fixtures own independent closure even when acquisition/assertions fail.
    for (const socket of transports) socket.destroy();
    if (!shutdowns) {
        try { await shutdown(); }
        catch (error) { assertionFailure = assertionFailure ? new AggregateError([assertionFailure, error], assertionFailure.message) : error; }
    }
    if (assertionFailure) throw assertionFailure;
}, 60000);
