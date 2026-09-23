'use strict';

const fs = require('fs');
const path = require('path');
const { BaseHandler, HttpServer, SocketRoute, SocketServer } = require('../..');
const { VerificationWorkspace } = require('../../scripts/lib/VerificationWorkspace');
const { browserCandidates, launchBrowserWithRetry, stopBrowser, openPage } = require('../../scripts/verify-live-html-browser');
const { BrowserPages } = require('../../scripts/lib/BrowserPages');
const { request, silentLogger, waitForListening, withTimeout } = require('../helpers/network');

test('headed browser cannot use ambient cookies for cross-origin socket or HTTP mutations', async () => {
    const executable = process.env.REDWEB_BROWSER || browserCandidates.find(fs.existsSync);
    if (!executable) throw new Error('A Chromium browser is required for headed security integration.');
    await new VerificationWorkspace().run(async execution => {
        const profile = path.join(execution.directory, 'browser');
        fs.mkdirSync(profile);
        const { browser, endpoint } = await launchBrowserWithRetry(executable, profile, { headless: false });
        const tabs = new BrowserPages(execution, openPage, withTimeout);
        let mutations = 0, socketCookieSeen = false, postCookieSeen = false;
        let target, foreign;
        try {
            class Ping extends BaseHandler {
                constructor() { super('ping'); }
                onMessage(socket) { socket.sendJson({ type: 'pong' }); }
            }
            class Route extends SocketRoute {
                constructor() { super({ path: '/socket', handlers: [Ping], logger: silentLogger }); }
            }
            const http = new HttpServer({ listen: false, port: 0, bind: '127.0.0.1', publicPaths: [],
                services: [
                    { method: 'get', serviceName: '/seed', function: (_incoming, response) =>
                        response.set('Set-Cookie', 'session=owner; Path=/; SameSite=Lax').send('<p>seeded</p>') },
                    { method: 'post', serviceName: '/change', function: (incoming, response) => {
                        if (incoming.headers.cookie?.includes('session=owner')) mutations += 1;
                        response.sendStatus(204);
                    } },
                ], logger: silentLogger });
            target = new SocketServer({ server: http.server, routes: [Route], listen: true,
                closeServerOnShutdown: true, port: 0, bind: '127.0.0.1', logger: silentLogger });
            target.server.on('upgrade', incoming => {
                if (incoming.url === '/socket' && incoming.headers.cookie?.includes('session=owner')) socketCookieSeen = true;
            });
            target.server.on('request', incoming => {
                if (incoming.url === '/change' && incoming.headers.cookie?.includes('session=owner')) postCookieSeen = true;
            });
            await waitForListening(target.server);
            foreign = new HttpServer({ port: 0, bind: '127.0.0.1', publicPaths: [],
                services: [{ method: 'get', serviceName: '/', function: (_incoming, response) =>
                    response.send('<!doctype html><title>Other origin</title>') }], logger: silentLogger });
            await waitForListening(foreign.server);
            const targetPort = target.server.address().port;
            const foreignPort = foreign.server.address().port;
            const tab = await tabs.open(new URL(endpoint).port, `http://127.0.0.1:${targetPort}/seed`);
            expect(await tab.evaluate('document.cookie')).toContain('session=owner');
            await tab.command('Page.navigate', { url: `http://127.0.0.1:${foreignPort}/` });
            expect(await tab.evaluate('document.title')).toBe('Other origin');
            const outcome = await tab.evaluate(`new Promise(resolve => {
                const socket = new WebSocket('ws://127.0.0.1:${targetPort}/socket');
                socket.onopen = () => { socket.close(); resolve('opened'); };
                socket.onerror = () => resolve('blocked');
            })`);
            expect(outcome).toBe('blocked');
            expect(socketCookieSeen).toBe(true);
            await tab.evaluate(`fetch('http://127.0.0.1:${targetPort}/change', {
                method: 'POST', mode: 'no-cors', credentials: 'include', body: 'change',
            }).then(() => true)`);
            expect(postCookieSeen).toBe(true);
            expect(mutations).toBe(0);
            const sameOrigin = await request({ port: targetPort, path: '/change', method: 'POST',
                headers: { Cookie: 'session=owner', Origin: `http://127.0.0.1:${targetPort}` }, body: 'change' });
            expect(sameOrigin.status).toBe(204);
            expect(mutations).toBe(1);
        } finally {
            try { await tabs.close(); } finally {
                try { await stopBrowser(browser.child); } finally {
                    await Promise.all([foreign?.shutdown(), target?.shutdown()]);
                }
            }
        }
    });
}, 30000);
