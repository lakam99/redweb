const assert = require('node:assert/strict');
const { once } = require('node:events');
const WebSocket = require('ws');
const { createApp } = require('../dist/app.js');

async function listen(t) {
    const app = createApp({ port: 0, bind: '127.0.0.1', logger: null });
    t.after(() => app.shutdown());
    if (!app.server.listening) await once(app.server, 'listening');
    return `http://127.0.0.1:${app.server.address().port}`;
}

async function connect(t, url, origin, headers = {}) {
    const socket = new WebSocket(url, { headers: { ...headers, Origin: origin } });
    const messages = [];
    socket.on('message', raw => messages.push(JSON.parse(raw.toString())));
    t.after(async () => {
        if (socket.readyState === WebSocket.CLOSED) return;
        const closed = once(socket, 'close');
        socket.close();
        await closed;
    });
    await once(socket, 'open');
    return {
        socket,
        send: message => socket.send(JSON.stringify(message)),
        async receive(predicate) {
            const deadline = Date.now() + 3000;
            while (Date.now() < deadline) {
                const index = messages.findIndex(predicate);
                if (index !== -1) return messages.splice(index, 1)[0];
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            assert.fail(`Timed out waiting for a socket message; received ${JSON.stringify(messages)}`);
        },
    };
}

async function live(t, origin, headers = {}) {
    const response = await fetch(origin, { headers });
    assert.equal(response.status, 200);
    const document = await response.text();
    const config = JSON.parse(document.match(/id="__redweb_page">([^<]+)</)[1]);
    const connection = await connect(t, `${origin.replace('http:', 'ws:')}${config.socketPath}?pageId=${config.pageId}&redwebVersion=${encodeURIComponent(config.version)}`, origin, headers);
    return {
        ...connection,
        document, config,
        patch: predicate => connection.receive(message => message.type === 'redweb:patch' && message.payload.patches.some(predicate)),
        action: (name, args = [], component) => connection.send({
            v: config.version, type: 'redweb:html', payload: { kind: 'action', name, args, component },
        }),
        state: (name, value, component) => connection.receive(message => message.type === 'redweb:state' &&
            message.payload.name === name && message.payload.component === component && value(message.payload.value)),
    };
}

module.exports = { listen, connect, live };
