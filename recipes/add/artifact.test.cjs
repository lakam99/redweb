const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const WebSocket = require('ws');
const { start, page, SocketServer } = require('redweb');
const { jsx } = require('redweb/jsx-runtime');

test('__NAME__ generated __KIND__ works over the network', { timeout: 10000 }, async t => {
    // Import only this artifact, never the application's entry point.
    const artifact = await import(pathToFileURL(path.resolve(__dirname, __IMPORT__)).href);
    let Page = artifact.__CLASS__;
    if ('__KIND__' === 'component') {
        Page = page('/') (class TestPage {
            subject = new artifact.__CLASS__();
            render() { return jsx('main', { children: this.subject }); }
        });
    }
    const app = '__KIND__' === 'socket-route'
        ? new SocketServer({ port: 0, bind: '127.0.0.1', logger: null, routes: [artifact.__CLASS__] })
        : start(Page, { port: 0, bind: '127.0.0.1', logger: null });
    let socket;
    t.after(async () => {
        socket?.terminate();
        await app.shutdown();
    });
    if (!app.server.listening) await once(app.server, 'listening');
    const origin = `http://127.0.0.1:${app.server.address().port}`;
    let config;
    if ('__KIND__' !== 'socket-route') {
        const response = await fetch(`${origin}${'__KIND__' === 'page' ? '/__NAME__' : '/'}`);
        assert.equal(response.status, 200);
        const document = await response.text();
        assert.match(document, /Count 0/);
        config = JSON.parse(document.match(/id="__redweb_page">([^<]+)</)[1]);
    }
    const endpoint = config
        ? `${config.socketPath}?pageId=${config.pageId}&redwebVersion=${encodeURIComponent(config.version)}`
        : `/__NAME__?redwebVersion=${artifact.contract.version}`;
    socket = new WebSocket(`${origin.replace('http:', 'ws:')}${endpoint}`, { origin, handshakeTimeout: 3000 });
    const received = [];
    socket.on('message', raw => received.push(JSON.parse(raw.toString())));
    await once(socket, 'open');
    if (config) {
        socket.send(JSON.stringify({ v: config.version, type: 'redweb:html', payload: {
            kind: 'action', name: 'increment', args: [],
            ...('__KIND__' === 'component' ? { component: 'subject' } : {}),
        } }));
    } else await artifact.contract.client(socket).send('ping', { text: 'Hello' }, { requestId: 'probe' });
    const success = message => config
        ? message.type === 'redweb:patch' && message.payload.patches.some(patch => patch.html?.includes('Count 1'))
        : message.type === 'pong' && message.payload.text === 'Hello' && message.requestId === 'probe';
    const deadline = Date.now() + 3000;
    while (!received.some(success) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(received.some(success), `Expected action result; received ${JSON.stringify(received)}`);
});
