'use strict';

const path = require('path');
const { BaseHandler, HttpServer, LiveHtmlServer, SocketRoute, SocketServer, page, upload } = require('../..');
const { jsx } = require('../../jsx-runtime');
const {
    request, silentLogger, waitForListening, websocketUpgradeStatus,
} = require('../helpers/network');

describe('security boundaries over real local listeners', () => {
    const servers = new Set();
    afterEach(async () => {
        await Promise.all([...servers].map(server => server.shutdown()));
        servers.clear();
    });

    async function start(Server, options) {
        const server = new Server({ port: 0, bind: '127.0.0.1', logger: silentLogger, ...options });
        servers.add(server);
        await waitForListening(server.server);
        return { server, port: server.server.address().port };
    }

    function pageId(html) {
        return JSON.parse(html.match(/<script[^>]+id="__redweb_page"[^>]*>(.*?)<\/script>/s)[1]).pageId;
    }

    test('request data is escaped in JSX text and rejects an executable URL attribute', async () => {
        class Echo {
            render({ query }) {
                return jsx('main', { children: [jsx('p', { children: query.text }),
                    jsx('a', { href: query.link, children: 'open' })] });
            }
        }
        page('/echo', { live: false })(Echo);
        const { port } = await start(LiveHtmlServer, { pages: [Echo] });
        const safe = await request({ port, path: '/echo?text=%3Cscript%3Ealert(1)%3C%2Fscript%3E&link=%2Fsafe' });
        expect(safe.status).toBe(200);
        expect(safe.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(safe.body).not.toContain('<script>alert(1)</script>');
        const unsafe = await request({ port, path: '/echo?text=hello&link=javascript%3Aalert(1)' });
        expect(unsafe.status).not.toBe(200);
        expect(unsafe.body).not.toContain('href="javascript:');
    });

    test('upload rejects foreign origins, other principals and oversized chunked bodies', async () => {
        let received = 0;
        class Vault {
            async save(file) { for await (const chunk of file.stream) received += chunk.length; }
            render() { return jsx('p', { children: 'vault' }); }
        }
        page('/vault', { authorize: context => context.principal === 'owner' })(Vault);
        upload({ maxBytes: 4, accept: 'text/plain' })(Vault.prototype, 'save', Object.getOwnPropertyDescriptor(Vault.prototype, 'save'));
        const { port } = await start(LiveHtmlServer, {
            pages: [Vault], authenticate: incoming => incoming.headers.cookie?.split('=')[1],
        });
        const document = await request({ port, path: '/vault', headers: { Cookie: 'user=owner' } });
        expect(document.status).toBe(200);
        const target = `/__redweb/upload?pageId=${pageId(document.body)}&action=save`;
        const headers = { Cookie: 'user=owner', 'content-type': 'text/plain' };
        const foreign = await request({ port, path: target, method: 'POST', body: 'ok',
            headers: { ...headers, Origin: 'https://foreign.example' } });
        const impersonator = await request({ port, path: target, method: 'POST', body: 'ok',
            headers: { ...headers, Cookie: 'user=other' } });
        const excessive = await request({ port, path: target, method: 'POST', body: '12345', headers });
        expect(foreign.status).toBe(403);
        expect(impersonator.status).toBe(403);
        expect(excessive.status).toBe(413);
        expect(received).toBe(0);
    });

    test('a page session cannot be attached by a different principal or foreign origin', async () => {
        class Private { render() { return jsx('p', { children: 'private' }); } }
        page('/private', { authorize: context => context.principal === 'owner' })(Private);
        const { port } = await start(LiveHtmlServer, {
            pages: [Private], authenticate: incoming => incoming.headers.cookie?.split('=')[1],
        });
        const document = await request({ port, path: '/private', headers: { Cookie: 'user=owner' } });
        expect(document.status).toBe(200);
        const target = `ws://127.0.0.1:${port}/__redweb/live?pageId=${pageId(document.body)}&redwebVersion=1`;
        const origin = `http://127.0.0.1:${port}`;
        expect(await websocketUpgradeStatus(target, { headers: { Origin: origin, Cookie: 'user=other' } })).not.toBe(101);
        expect(await websocketUpgradeStatus(target, { headers: { Origin: 'https://foreign.example', Cookie: 'user=owner' } })).not.toBe(101);
    });

    test('an untrusted forwarded-address header cannot impersonate the network identity by default', async () => {
        const identities = [];
        class Ping extends BaseHandler { constructor() { super('ping'); } }
        class Route extends SocketRoute {
            constructor() {
                super({ path: '/socket', handlers: [Ping], logger: silentLogger,
                    admission: { authenticate: (_request, context) => { identities.push(context.networkIdentity); return true; } } });
            }
        }
        const { port } = await start(SocketServer, { routes: [Route] });
        const status = await websocketUpgradeStatus(`ws://127.0.0.1:${port}/socket`, {
            headers: { 'X-Forwarded-For': '203.0.113.9' },
        });
        expect(status).toBe(101);
        expect(identities).toEqual(['127.0.0.1']);
    });

    test('encoded static paths cannot escape their configured public directory', async () => {
        const { port } = await start(HttpServer, { publicPaths: [path.join(__dirname, '..', 'fixtures')] });
        for (const target of ['/%2e%2e/package.json', '/%2e%2e/%2e%2e/package.json', '/..%5c..%5cpackage.json', '/%zz']) {
            const response = await request({ port, path: target });
            expect(response.status).not.toBe(200);
            expect(response.body).not.toContain('"name": "redweb"');
        }
    });
});
