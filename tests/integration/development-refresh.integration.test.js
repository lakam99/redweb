'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const { RedwebClient } = require('redweb-client');
const { start, page, exportStatic } = require('../..');
const { ReactivePage } = require('../fixtures/reactive-pages');
const { request, waitForListening, waitForCondition, silentLogger } = require('../helpers/network');

const endpoints = ['/__redweb/development', '/__redweb/development.js', '/__redweb/development.css'];
class StaticPage { render() { return '<main><h1>Static page</h1></main>'; } }
page('/', { live: false })(StaticPage);
let server;
afterEach(async () => { await server?.shutdown(); server = null; });

async function boot(Page = StaticPage, options = {}) {
    server = start(Page, { port: 0, bind: '127.0.0.1', logger: silentLogger, ...options });
    await waitForListening(server.server);
    return server.server.address().port;
}

test('default and explicitly disabled servers have no refresh documents or resources', async () => {
    const port = await boot();
    const response = await request({ port });
    expect(response.body).not.toContain('__redweb_dev');
    expect(response.headers.etag).toBeDefined();
    for (const endpoint of endpoints) expect((await request({ port, path: endpoint })).status).toBe(404);
});

test('enabled refresh serves only same-origin loopback resources and disables HTML caching', async () => {
    const port = await boot(StaticPage, { development: { refresh: true } });
    const response = await request({ port, headers: { 'If-None-Match': '*' } });
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers.etag).toBeUndefined();
    expect(response.body).toContain(`development.js?revision=${server.manager.revision}`);
    const revision = await request({ port, path: endpoints[0] });
    expect(JSON.parse(revision.body)).toEqual({ revision: server.manager.revision });
    for (const endpoint of endpoints) {
        const asset = await request({ port, path: endpoint, headers: { Origin: `http://127.0.0.1:${port}`, 'Sec-Fetch-Site': 'same-origin' } });
        expect(asset.status).toBe(200);
        expect(asset.headers['cache-control']).toBe('private, no-store');
        expect(asset.headers['access-control-allow-origin']).toBeUndefined();
        expect(asset.headers['x-content-type-options']).toBe('nosniff');
        for (const headers of [{ Host: `evil.test:${port}` }, { Origin: 'null' }, { Origin: 'https://example.test' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
            expect((await request({ port, path: endpoint, headers })).status).toBe(404);
        }
    }
    const nonlocal = await request({ port, headers: { Host: `evil.test:${port}`, 'X-Forwarded-Host': `127.0.0.1:${port}` } });
    expect(nonlocal.body).not.toContain('__redweb_dev');
    expect(nonlocal.headers.etag).toBeDefined();
});

test('reactive root patches retain the same process revision and developer host', async () => {
    const port = await boot(ReactivePage, { development: { refresh: true, inspect: true } });
    const response = await request({ port });
    const config = JSON.parse(response.body.match(/id="__redweb_page">([^<]+)/)[1]);
    const client = new RedwebClient(`ws://127.0.0.1:${port}${config.socketPath}?pageId=${config.pageId}`, {
        version: config.version, reconnect: false, webSocketFactory: url => new WebSocket(url, { origin: `http://127.0.0.1:${port}` }),
    });
    const patches = [];
    client.on('redweb:patch', message => patches.push(...message.payload.patches));
    try {
        await client.connect();
        await waitForCondition(() => patches.length > 0, 'initial root snapshot');
        expect(patches.find(patch => patch.id === 'root').html).toContain(`development.js?revision=${server.manager.revision}`);
        patches.length = 0;
        await client.request('redweb:html', { kind: 'action', name: 'reverse', args: [] });
        await waitForCondition(() => patches.some(patch => patch.id === 'root'), 'root update');
        expect(patches.find(patch => patch.id === 'root').html).toContain('<rw-dev-refresh id="__redweb_dev">');
        expect(server.inspect().pages.connections.connected).toBe(1);
    } finally { client.close(); }
});

test('static exports remain script-free even inside the generated development environment', async () => {
    const previous = process.env.REDWEB_DEV_REFRESH;
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-refresh-export-'));
    try {
        process.env.REDWEB_DEV_REFRESH = '1';
        const result = await exportStatic(StaticPage, { outDir: workspace });
        const document = fs.readFileSync(result.pages[0], 'utf8');
        expect(document).not.toContain('__redweb_dev');
        expect(document).not.toContain('<script');
    } finally {
        if (previous === undefined) delete process.env.REDWEB_DEV_REFRESH; else process.env.REDWEB_DEV_REFRESH = previous;
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});
