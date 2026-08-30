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
    const app = start(Page, { port: 0, bind: '127.0.0.1', logger: null });
    let socket;
    try {
        if (!app.server.listening) await once(app.server, 'listening');
        const origin = `http://127.0.0.1:${app.server.address().port}`;
        const response = await fetch(origin, { signal: AbortSignal.timeout(5000) });
        assert.equal(response.status, 200);
        const html = await response.text();
        assert.match(html, chat ? /Join the chatroom/ : /Server-side counter/);
        if (chat) {
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
        }
        console.log(chat ? 'Packed chat passed with explicit application Zod.' : 'Core and counter passed without Zod or TypeScript.');
    } finally { socket?.close(); await app.shutdown(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
