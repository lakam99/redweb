'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { once } = require('events');
const { spawnSync } = require('child_process');
const WebSocket = require('ws');
const { RedwebClient } = require('redweb-client');

/** Compile both decorator ABIs against the nominated package and exercise real listeners. */
async function verifyActionInput(packageRoot, workspace) {
    for (const experimentalDecorators of [false, true]) {
        const target = path.join(workspace, `action-${experimentalDecorators ? 'legacy' : 'standard'}`);
        fs.mkdirSync(path.join(target, 'node_modules'), { recursive: true });
        fs.symlinkSync(packageRoot, path.join(target, 'node_modules/redweb'), 'junction');
        fs.symlinkSync(path.dirname(require.resolve('zod/package.json')), path.join(target, 'node_modules/zod'), 'junction');
        fs.copyFileSync(path.resolve(__dirname, '../../tests/fixtures/action-consumer.ts'), path.join(target, 'consumer.ts'));
        fs.writeFileSync(path.join(target, 'tsconfig.json'), JSON.stringify({
            extends: 'redweb/tsconfig.json',
            compilerOptions: { experimentalDecorators, esModuleInterop: true, outDir: 'dist' },
            files: ['consumer.ts'],
        }));
        const compilation = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', target], { encoding: 'utf8', timeout: 30000, windowsHide: true });
        assert.equal(compilation.status, 0, compilation.stdout || compilation.stderr);
        fs.unlinkSync(path.join(target, 'consumer.ts'));
        const { ValidatedPage } = require(path.join(target, 'dist/consumer.js'));
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
            assert.deepEqual((await invoke([{ amount: '3' }])).payload, { total: 3, principal: 'trusted-owner' });
            assert.deepEqual((await invoke([{ amount: '2' }])).payload, { total: 5, principal: 'trusted-owner' });
        } finally {
            client?.close();
            await server.shutdown();
        }
    }
}

module.exports = { verifyActionInput };
