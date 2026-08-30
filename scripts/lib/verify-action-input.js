'use strict';

const assert = require('assert/strict');
const path = require('path');
const { once } = require('events');
const { compileConsumer } = require('./compile-consumer');
const WebSocket = require('ws');
const { RedwebClient } = require('redweb-client');
const { websocketUpgradeStatus } = require('../../tests/helpers/network');

/** Compile both decorator ABIs against the nominated package and exercise real listeners. */
async function verifyActionInput(packageRoot, execution) {
    for (const experimentalDecorators of [false, true]) {
        const target = path.join(execution.directory, `action-${experimentalDecorators ? 'legacy' : 'standard'}`);
        const compiled = await compileConsumer(packageRoot, execution, target, path.resolve(__dirname, '../../tests/fixtures/action-consumer.ts'), { experimentalDecorators, dependencies: ['zod'] });
        const { ValidatedPage } = require(compiled);
        const { start } = require(packageRoot);
        const server = start(ValidatedPage, { port: 0, bind: '127.0.0.1', authenticate: () => 'trusted-owner' });
        let client;
        try {
            if (!server.server.listening) await once(server.server, 'listening');
            const origin = `http://127.0.0.1:${server.server.address().port}`;
            const response = await fetch(origin, { signal: AbortSignal.timeout(5000) });
            assert.equal(response.status, 200);
            const document = await response.text();
            const config = JSON.parse(document.match(/id="__redweb_page">([^<]+)/)[1]);
            client = new RedwebClient(`${origin.replace('http:', 'ws:')}${config.socketPath}?pageId=${config.pageId}`, {
                version: config.version, requestTimeoutMs: 5000,
                webSocketFactory: url => new WebSocket(url, { headers: { Origin: origin } }),
            });
            await client.connect();
            const invoke = args => client.request('redweb:html', { kind: 'action', name: 'save', args });
            await assert.rejects(invoke([{ amount: 'invalid' }]), { code: 'ACTION_INVALID_INPUT' });
            for (const amount of ['9'.repeat(400), '9007199254740993', '1001', '0']) {
                await assert.rejects(invoke([{ amount }]), { code: 'ACTION_INVALID_INPUT' });
            }
            await assert.rejects(invoke([{ amount: '3' }, { principal: 'forged' }]), { code: 'ACTION_INVALID_INPUT' });
            await assert.rejects(invoke([{ amount: '11' }]), { code: 'ACCESS_DENIED' });
            assert.deepEqual((await invoke([{ amount: '3' }])).payload, { total: 3, principal: 'trusted-owner' });
            assert.deepEqual((await invoke([{ amount: '2' }])).payload, { total: 5, principal: 'trusted-owner' });
            for (const args of [[], [{ principal: 'forged' }]]) {
                assert.deepEqual((await client.request('redweb:html', { kind: 'action', name: 'who', args })).payload, { principal: 'trusted-owner', path: '/' });
            }
            await assert.rejects(client.request('redweb:html', { kind: 'action', name: 'who', args: [null, { principal: 'forged' }] }), { code: 'ACTION_INVALID_INPUT' });
            assert.equal(await server.revoke('trusted-owner'), 1);
            assert.equal(await websocketUpgradeStatus(`${origin.replace('http:', 'ws:')}${config.socketPath}?pageId=${config.pageId}&redwebVersion=1`, { headers: { Origin: origin } }), 401);
        } finally {
            client?.close();
            await server.shutdown();
        }
    }
}

module.exports = { verifyActionInput };
