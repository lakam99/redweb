'use strict';

// Copied into an independently installed consumer; never executed from the repository.
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { start } = require('redweb');
const packagePath = require.resolve('redweb/package.json');
const WebSocket = createRequire(packagePath)('ws');
const { waitFor, closeClient, WebSocket: supportSocket } = require('./probe-support/realtime-harness');
const { withTimeout } = require('./probe-support/network');
const { verificationError } = require('./probe-support/lib/verificationError');
const { performProbeAction } = require('./probe-support/lib/performProbeAction');
assert.equal(supportSocket, WebSocket, 'Probe support must use the installed Redweb transport.');
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
    let socket, result;
    const failures = [];
    try {
        if (!app.server.listening) await waitFor(app.server, 'listening');
        const origin = `http://127.0.0.1:${app.server.address().port}`;
        const response = await fetch(origin, { signal: AbortSignal.timeout(5000) });
        assert.equal(response.status, 200);
        const html = await response.text();
        const runtime = await fetch(`${origin}/__redweb/runtime.js`, { signal: AbortSignal.timeout(5000) });
        assert.equal(runtime.status, 200);
        assert.equal(await runtime.text(), 'import { mountLivePage } from "/__redweb/client.js";\nmountLivePage();\n');
        const client = await fetch(`${origin}/__redweb/client.js`, { signal: AbortSignal.timeout(5000) });
        assert.equal(client.status, 200);
        assert.equal(await client.text(), require('node:fs').readFileSync(path.join(
            path.dirname(createRequire(packagePath).resolve('redweb-client/live-html')), 'live-html.js'), 'utf8'));
        assert.match(html, chat ? /Join the chatroom/ : /Server-side counter/);
        if (!chat) {
            assert.equal(app.inspect(), null);
            assert.ok(!html.includes('__redweb_dev'));
            const development = await fetch(`${origin}/__redweb/development`, { signal: AbortSignal.timeout(5000) });
            assert.equal(development.status, 404);
            await development.text();
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
            socket = new WebSocket(`${origin.replace('http:', 'ws:')}${config.socketPath}?pageId=${config.pageId}&redwebVersion=${encodeURIComponent(config.version)}`,
                { handshakeTimeout: 5000, headers: { Origin: origin } });
            await waitFor(socket, 'open');
            await performProbeAction(socket, config.version);
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
        result = chat ? 'Packed chat, development inspection and refresh resources passed with explicit application Zod.' : 'Core and counter passed without Zod or TypeScript; inspection and refresh disabled.';
    } catch (error) { failures.push(verificationError(error)); }
    for (const cleanup of [() => closeClient(socket), () => withTimeout(app.shutdown(), 'packed example shutdown', 10000)]) {
        try { await cleanup(); } catch (error) { failures.push(verificationError(error)); }
    }
    if (failures.length) throw new AggregateError(failures, failures[0].message, { cause: failures[0] });
    console.log(result);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
