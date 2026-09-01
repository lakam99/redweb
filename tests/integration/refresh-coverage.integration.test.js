'use strict';

const http = require('node:http');
const net = require('node:net');
const BrowserCoverage = require('../../scripts/lib/BrowserCoverage');
const { CoverageRevisionPeer } = require('../../scripts/lib/verify-refresh-coverage');
const refreshBrowser = require('../../src/development/refreshBrowser');
const { waitForCondition, waitForListening, withTimeout } = require('../helpers/network');

async function upload(peer, body) {
    return withTimeout(new Promise(resolve => {
        const request = http.request(peer.url + '/__coverage', { method: 'POST', agent: false }, response => {
            response.resume();
            response.on('end', () => resolve(response.statusCode));
        });
        request.on('error', error => resolve(error.code));
        request.end(body);
    }), 'actual coverage upload');
}

test('real coverage uploads reject malformed/oversized/aborted reports and accept a matching map', async () => {
    const coverage = new BrowserCoverage('refresh.generated.js', refreshBrowser());
    const peer = new CoverageRevisionPeer(coverage, true);
    let partial;
    try {
        await peer.listen();
        expect(await upload(peer, JSON.stringify(coverage.report().coverage))).toBe(200);
        expect(peer.reports).toBe(1);
        expect(await upload(peer, '{invalid')).toBe(400);
        expect(await upload(peer, '{}')).toBe(400);
        await upload(peer, Buffer.alloc(1024 * 1024 + 1, 'a'));
        await waitForCondition(() => peer.failures.length === 3, 'oversized upload rejected');
        expect(peer.failures[2].message).toContain('1 MiB');
        partial = net.connect(peer.port, '127.0.0.1');
        await withTimeout(new Promise((resolve, reject) => { partial.once('connect', resolve); partial.once('error', reject); }), 'partial upload connection');
        const arrived = new Promise(resolve => peer.server.once('request', resolve));
        partial.write('POST /__coverage HTTP/1.1\r\nHost: localhost\r\nContent-Length: 10000\r\n\r\n{');
        // A server-side request event proves the partial body reached the actual peer.
        await withTimeout(arrived, 'partial upload received by server');
        partial.end();
        await waitForCondition(() => peer.failures.length === 4, 'aborted upload recorded');
        expect(peer.failures[3].message).toMatch(/aborted/);
        expect(peer.reports).toBe(1);
    } finally { partial?.destroy(); await peer.pause(); }
});

test('revision peer listener conflicts reject without an unhandled native error', async () => {
    const occupied = net.createServer();
    occupied.listen(0, '127.0.0.1');
    await waitForListening(occupied);
    const peer = new CoverageRevisionPeer(new BrowserCoverage('refresh.generated.js', refreshBrowser()), false);
    peer.port = occupied.address().port;
    try { await expect(peer.listen()).rejects.toMatchObject({ code: 'EADDRINUSE' }); }
    finally { await peer.pause(); await new Promise(resolve => occupied.close(resolve)); }
});

test('an unfinished native close remains pending after the listener stops accepting', async () => {
    const peer = new CoverageRevisionPeer(new BrowserCoverage('refresh.generated.js', refreshBrowser()), false);
    let client, upgraded;
    try {
        await peer.listen();
        const accepted = new Promise(resolve => peer.server.once('upgrade', (_request, socket) => { upgraded = socket; resolve(); }));
        client = net.connect(peer.port, '127.0.0.1');
        await withTimeout(new Promise((resolve, reject) => { client.once('connect', resolve); client.once('error', reject); }), 'upgrade connection');
        client.write('GET / HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: coverage-test\r\n\r\n');
        await withTimeout(accepted, 'native upgrade accepted');
        // Node closeAllConnections deliberately excludes upgraded connections.
        await expect(peer.pause(25)).rejects.toThrow('revision peer shutdown');
        expect(peer.server.listening).toBe(false);
        const closing = peer.closing;
        await expect(peer.pause(25)).rejects.toThrow('revision peer shutdown');
        expect(peer.closing).toBe(closing);
        upgraded.destroy(); client.destroy();
        await peer.pause();
        await peer.listen();
        expect(peer.closing).toBeNull();
    } finally { upgraded?.destroy(); client?.destroy(); await peer.pause(); }
});
