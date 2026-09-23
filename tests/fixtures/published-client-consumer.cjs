'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { once } = require('events');
const { BaseHandler, SocketRoute, HttpServer, SocketServer } = require('redweb');
const { RedwebClient } = require('redweb-client');
const WebSocket = require('ws');

async function verify() {
    const clientRoot = path.resolve(path.dirname(require.resolve('redweb-client')), '..');
    assert.equal(JSON.parse(fs.readFileSync(path.join(clientRoot, 'package.json'))).version, process.argv[2]);
    assert.equal(typeof (await import('redweb-client')).RedwebClient, 'function');
    assert.equal(typeof (await import('redweb-client/live-html')).mountLivePage, 'function');
    assert.equal(typeof require('redweb-client/live-html').mountLivePage, 'function');
    const expressRequire = createRequire(require.resolve('express'));
    const bodyRequire = createRequire(expressRequire.resolve('body-parser'));
    for (const from of [expressRequire, bodyRequire]) assert.equal(from('qs/package.json').version, '6.16.0');
    class Command extends BaseHandler {
        constructor() { super('command'); }
        onMessage(socket, message) {
            const metadata = { requestId: message.requestId };
            socket.sendEvent('progress', null, metadata);
            socket.sendEvent('complete', message.payload, metadata);
        }
    }
    class Route extends SocketRoute {
        constructor() { super({ path: '/match', handlers: [Command], protocol: { versions: ['1'] }, logger: null }); }
    }
    const http = new HttpServer({ listen: false, encoding: 'urlencoded', logger: null,
        services: [{ serviceName: '/form', method: 'post', function: (req, res) => res.json(req.body) }] });
    const sockets = new SocketServer({ server: http.server, routes: [Route], listen: false, logger: null });
    let client;
    try {
        http.server.listen(0, '127.0.0.1'); await once(http.server, 'listening');
        const port = http.server.address().port;
        const response = await fetch(`http://127.0.0.1:${port}/form`, { method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: 'player[name]=Alice&player[roles][]=X&player[roles][]=member' });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { player: { name: 'Alice', roles: ['X', 'member'] } });
        client = new RedwebClient(`ws://127.0.0.1:${port}/match`, { version: '1', webSocketFactory: url => new WebSocket(url) });
        await client.connect();
        const progress = client.waitFor('progress');
        const completed = client.request('command', { value: 7 }, { responseType: 'complete', timeoutMs: 3000 });
        assert.equal((await progress).type, 'progress');
        assert.equal((await completed).type, 'complete');
        assert.deepEqual((await client.request('command', null, { responseType: 'complete' })).payload, null);
        console.log('PASS: isolated package exports, terminal replies, HTTP forms and qs 6.16.0');
    } finally { client?.dispose(); try { await sockets.shutdown(); } finally { await http.shutdown(); } }
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
