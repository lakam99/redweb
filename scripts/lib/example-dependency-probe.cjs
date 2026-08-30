'use strict';

// Copied into an independently installed consumer; never executed from the repository.
const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');
const { createRequire } = require('node:module');
const { start } = require('redweb');
const packagePath = require.resolve('redweb/package.json');
const WebSocket = createRequire(packagePath)('ws');
const example = name => path.join(path.dirname(packagePath), 'examples/live-html', name);

async function main() {
    const chat = process.argv[2] === 'chat';
    assert.throws(() => require.resolve('typescript'), { code: 'MODULE_NOT_FOUND' });
    if (!chat) {
        assert.throws(() => require.resolve('zod'), { code: 'MODULE_NOT_FOUND' });
        assert.throws(() => require(example('chatroom.js')), { code: 'MODULE_NOT_FOUND' });
    }
    const Page = chat ? require(example('chatroom.js')).createChatroomPage() : require(example('counter.js')).CounterPage;
    const app = start(Page, { port: 0, bind: '127.0.0.1', logger: null,
        ...(chat ? { development: { inspect: true, refresh: true } } : {}) });
    let socket;
    try {
        if (!app.server.listening) await once(app.server, 'listening');
        const origin = `http://127.0.0.1:${app.server.address().port}`;
        const response = await fetch(origin, { signal: AbortSignal.timeout(5000) });
        assert.equal(response.status, 200);
        const html = await response.text();
        assert.match(html, chat ? /Join the chatroom/ : /Server-side counter/);
        if (!chat) {
            assert.equal(app.inspect(), null);
            assert.ok(!html.includes('__redweb_dev'));
            assert.equal((await fetch(`${origin}/__redweb/development`, { signal: AbortSignal.timeout(5000) })).status, 404);
        }
        if (chat) {
            assert.equal(response.headers.get('cache-control'), 'private, no-store');
            const revisionResponse = await fetch(`${origin}/__redweb/development`, { signal: AbortSignal.timeout(5000) });
            assert.equal(revisionResponse.status, 200);
            const revision = await revisionResponse.json();
            assert.deepEqual(Object.keys(revision), ['revision']);
            assert.ok(html.includes(`development.js?revision=${revision.revision}`));
            for (const [extension, type] of [['js', 'text/javascript'], ['css', 'text/css']]) {
                const asset = await fetch(`${origin}/__redweb/development.${extension}`, { signal: AbortSignal.timeout(5000) });
                assert.equal(asset.status, 200);
                assert.ok(asset.headers.get('content-type').startsWith(type));
                assert.equal(asset.headers.get('cache-control'), 'private, no-store');
                assert.ok((await asset.text()).length > 0);
            }
            const config = JSON.parse(html.match(/id="__redweb_page">([^<]+)/)[1]);
            socket = new WebSocket(`${origin.replace('http:', 'ws:')}${config.socketPath}?pageId=${config.pageId}&redwebVersion=${encodeURIComponent(config.version)}`, { headers: { Origin: origin } });
            await once(socket, 'open');
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Packed chat action did not complete.')), 5000);
                socket.on('message', raw => {
                    const event = JSON.parse(String(raw));
                    if (event.requestId !== 'probe') return;
                    clearTimeout(timeout);
                    if (event.type === 'redweb:result' && event.payload === true) resolve();
                    else reject(new Error(`Unexpected packed chat result: ${JSON.stringify(event)}`));
                });
                socket.once('error', error => { clearTimeout(timeout); reject(error); });
                socket.send(JSON.stringify({ v: config.version, requestId: 'probe', type: 'redweb:html',
                    payload: { kind: 'action', component: 'chat', name: 'join', args: [{ name: 'Packed visitor' }] } }));
            });
            const snapshot = app.inspect();
            assert.equal(snapshot.schemaVersion, 1);
            assert.equal(snapshot.pages.available, true);
            assert.equal(snapshot.sockets.available, true);
            assert.equal(snapshot.pages.connections.connected, 1);
            assert.ok(snapshot.pages.registrations.items[0].instances.items[0].components.items
                .some(component => component.actions.items.includes('join')));
            assert.ok(Object.isFrozen(snapshot.pages.registrations.items));
            assert.ok(!JSON.stringify(snapshot).includes('Packed visitor'));
            assert.ok(!JSON.stringify(snapshot).includes(config.pageId));
        }
        console.log(chat ? 'Packed chat, development inspection and refresh resources passed with explicit application Zod.' : 'Core and counter passed without Zod or TypeScript; inspection and refresh disabled.');
    } finally { socket?.close(); await app.shutdown(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
