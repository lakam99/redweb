'use strict';

const http = require('http');
const WebSocket = require('ws');
const { RedwebClient } = require('redweb-client');
const { start } = require('..');
const { ChatroomPage } = require('../examples/live-html/chatroom');

const logger = Object.freeze({ log() {}, warn() {}, error() {} });
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function getPage(port) {
    return new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port, path: '/' }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf8');
                const match = body.match(/<script type="application\/json" id="__redweb_page">([^<]+)<\/script>/);
                if (response.statusCode !== 200 || !match) return reject(new Error('Live HTML page render failed.'));
                resolve(JSON.parse(match[1]));
            });
        }).once('error', reject);
    });
}

async function waitFor(predicate, label, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}.`);
        await pause(10);
    }
}

function createClient(port, config, updates) {
    const client = new RedwebClient(`ws://127.0.0.1:${port}${config.socketPath}?pageId=${config.pageId}`, {
        version: config.version,
        webSocketFactory: url => new WebSocket(url, { headers: { Origin: `http://127.0.0.1:${port}` } }),
    });
    client.on('redweb:state', message => updates.push(message.payload));
    return client;
}

function closeClient(client) {
    if (client.state === 'closed' || client.state === 'idle') {
        client.close();
        return Promise.resolve();
    }
    return new Promise(resolve => {
        const unsubscribe = client.onClose(() => { unsubscribe(); resolve(); });
        client.close();
    });
}

async function main() {
    const server = start(ChatroomPage, {
        port: 0,
        bind: '127.0.0.1',
        logger,
        maxSessions: 500,
        sessionTtlMs: 1000,
    });
    const clients = [];
    try {
        if (!server.server.listening) await new Promise(resolve => server.server.once('listening', resolve));
        const port = server.server.address().port;
        global.gc?.();
        const baseline = process.memoryUsage().heapUsed;

        await Promise.all(Array.from({ length: 200 }, () => getPage(port)));
        if (server.manager.pending.size !== 200) throw new Error('Pending-session concurrency accounting failed.');
        await waitFor(() => server.manager.pending.size === 0, 'pending-session expiry');

        const configs = await Promise.all(Array.from({ length: 30 }, () => getPage(port)));
        const updates = configs.map(() => []);
        configs.forEach((config, index) => clients.push(createClient(port, config, updates[index])));
        await Promise.all(clients.map(client => client.connect()));
        await waitFor(() => updates.every(messages => messages.length >= 1), 'initial state fan-out');
        clients[0].send('redweb:html', {
            kind: 'action',
            name: 'send',
            args: [{ name: 'load-gate', message: 'ordered-broadcast' }],
        });
        await waitFor(
            () => updates.every(messages => messages.at(-1)?.value.includes('ordered-broadcast')),
            '30-client ordered broadcast'
        );

        await Promise.all(clients.splice(0).map(closeClient));
        await waitFor(() => server.manager.active.size === 0, 'disconnected-session expiry');
        global.gc?.();
        await pause(50);
        global.gc?.();
        const growth = process.memoryUsage().heapUsed - baseline;
        const limit = 16 * 1024 * 1024;
        if (growth > limit) throw new Error(`Live HTML heap grew by ${growth} bytes; limit is ${limit}.`);
        console.log(`Live HTML load gate passed: 200 expired renders, 30 live clients, heap delta ${growth} bytes.`);
    } finally {
        await Promise.allSettled(clients.map(closeClient));
        await server.shutdown();
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
