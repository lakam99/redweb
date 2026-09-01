'use strict';

const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const { AccessDenied } = require('../../src/access/AccessPolicy');
const { SocketServer, SocketRoute, BaseHandler, start, page, action } = require('../..');
const { request, waitForListening, waitForCondition, websocketUpgradeResponse, waitForOpen, closeWebSocket, nextMessage } = require('../helpers/network');
const { RedwebClient } = require('redweb-client');
const ActionInputError = require('../../src/validation/ActionInputError');

describe('safe runtime diagnostics over real HTTP and WebSockets', () => {
    class Ping extends BaseHandler { constructor() { super('ping'); } onMessage(socket) { socket.sendJson({ pong: true }); } }
    let server;
    const peers = [];
    afterEach(async () => { await Promise.all(peers.splice(0).map(closeWebSocket)); await server?.shutdown(); });
    async function bootRoute(Route) {
        server = new SocketServer({ port: 0, bind: '127.0.0.1', routes: [Route], logger: null });
        await waitForListening(server.server);
        return `ws://127.0.0.1:${server.server.address().port}/socket`;
    }
    async function raw(admission, options = {}) {
        class Route extends SocketRoute { constructor() { super({ path: '/socket', handlers: [Ping], admission, logger: null, ...options }); } }
        return bootRoute(Route);
    }
    const expectFailure = (response, status, code) => {
        expect(response.status).toBe(status);
        expect(response.headers['redweb-error']).toBe(code);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(JSON.stringify(response)).not.toContain('private-secret');
    };
    const decorateFailure = (error, mode) => {
        if (mode === 'message') error.message += ' private-secret';
        if (mode === 'object') error.code = { toString: () => 'ACCESS_DENIED' };
        if (mode === 'getter') Object.defineProperty(error, 'code', { get() { throw new Error('private-secret'); } });
        return error;
    };

    test.each([false, true])('final raw socket boundary sanitizes decorated permission errors (versioned: %s)', async versioned => {
        class Enter extends BaseHandler {
            constructor() { super('enter'); }
            async onMessage(socket, message) {
                try { await socket.enterRoom('private'); }
                catch (error) { throw decorateFailure(error, message.payload.mode); }
            }
        }
        class Room extends SocketRoute {
            constructor() { super({ path: '/socket', handlers: [Enter], rooms: { authorize: () => false }, logger: null,
                protocol: versioned ? { versions: ['1'] } : undefined }); }
        }
        const url = `${await bootRoute(Room)}?redwebVersion=1`;
        for (const mode of ['message', 'object', 'getter']) {
            const peer = new WebSocket(url); peers.push(peer); await waitForOpen(peer);
            const response = nextMessage(peer);
            peer.send(JSON.stringify({ v: '1', type: 'enter', requestId: mode, payload: { mode } }));
            const text = String((await response).data);
            expect(text).not.toContain('private-secret');
            const result = JSON.parse(text);
            if (mode === 'message') {
                expect(versioned ? result.error : result).toMatchObject({ code: 'ACCESS_DENIED' });
                expect(versioned ? result.error.message : result.error).toBe('This operation is not permitted.');
            } else expect(versioned ? result.error : result).toEqual(versioned
                ? { code: 'HANDLER_FAILED', message: 'Handler failed' } : { error: 'Handler failed' });
            await closeWebSocket(peer);
        }
    });

    test.each(['access', 'input'])('final live action boundary sanitizes decorated %s failures', async kind => {
        class Page {
            render() { return '<p>errors</p>'; }
            run(mode) { throw decorateFailure(kind === 'access' ? new AccessDenied() : new ActionInputError(), mode); }
        }
        page('/')(Page);
        action()(Page.prototype, 'run', Object.getOwnPropertyDescriptor(Page.prototype, 'run'));
        server = start(Page, { port: 0, bind: '127.0.0.1', logger: null });
        await waitForListening(server.server);
        const port = server.server.address().port;
        for (const mode of ['message', 'object', 'getter']) {
            const config = JSON.parse((await request({ port })).body.match(/id="__redweb_page">([^<]+)/)[1]);
            const client = new RedwebClient(`ws://127.0.0.1:${port}${config.socketPath}?pageId=${config.pageId}`, {
                version: '1', requestTimeoutMs: 1500,
                webSocketFactory: url => new WebSocket(url, { headers: { origin: `http://127.0.0.1:${port}` } }),
            });
            try {
                await client.connect();
                await expect(client.request('redweb:html', { kind: 'action', name: 'run', args: [mode] })).rejects.toMatchObject({
                    code: mode === 'message' ? kind === 'access' ? 'ACCESS_DENIED' : 'ACTION_INVALID_INPUT' : 'HANDLER_FAILED',
                    message: mode !== 'message' ? 'Handler failed' : kind === 'access' ? 'This operation is not permitted.' : 'Action input is invalid. Check the form values and try again.',
                });
            } finally { client.close(); }
        }
    });

    test.each([
        [{ authenticate: () => false }, 401, 'AUTHENTICATION_REQUIRED'],
        [{ origins: ['https://allowed.example'] }, 403, 'ORIGIN_DENIED'],
        [{ authenticate() { throw new Error('private-secret'); } }, 500, 'ADMISSION_FAILED'],
        [{ origins() { throw new Error('private-secret'); } }, 500, 'ADMISSION_FAILED'],
        [{ place() { throw new Error('private-secret'); } }, 500, 'ADMISSION_FAILED'],
        [{ place: () => false }, 403, 'PLACEMENT_DENIED'],
        [{ place: () => 'wss://private-secret@example.com/' }, 500, 'PLACEMENT_INVALID'],
        [{ authenticate: () => new Promise(() => {}), timeoutMs: 20 }, 503, 'ADMISSION_TIMEOUT'],
    ])('separates admission failure %# without reflecting callback details', async (admission, status, code) => {
        const url = await raw(admission);
        expectFailure(await websocketUpgradeResponse(url), status, code);
        expect(server.routes[0].clients.size).toBe(0);
    });

    test('a rejected identity can be repaired and connected without restarting the server', async () => {
        const url = await raw({ authenticate: request => request.headers.authorization === 'valid' ? { account: 'alice' } : false });
        expectFailure(await websocketUpgradeResponse(url), 401, 'AUTHENTICATION_REQUIRED');
        const peer = new WebSocket(url, { headers: { authorization: 'valid' } }); peers.push(peer);
        await waitForOpen(peer);
        expect([...server.routes[0].clients.values()][0].context.principal).toEqual({ account: 'alice' });
    });

    test('broken custom upgrade/reservation callbacks and a throwing logger cannot leak details or retain capacity', async () => {
        let mode = 'upgrade';
        class Broken extends SocketRoute {
            constructor() { super({ path: '/socket', handlers: [Ping], admission: () => true, logger: null }); }
            authorizeUpgrade(...args) { if (mode === 'upgrade') throw new Error('private-secret'); if (mode === 'denied') return false; return super.authorizeUpgrade(...args); }
            reserveUpgrade(...args) { if (mode === 'reservation') throw new Error('private-secret'); return super.reserveUpgrade(...args); }
        }
        const url = await bootRoute(Broken);
        const logs = [];
        server.logger = { error(message, error) { logs.push([message, error.message, error.code]); throw new Error('private-secret'); } };
        expectFailure(await websocketUpgradeResponse(url), 500, 'ADMISSION_FAILED');
        await waitForCondition(() => server.routes[0].pendingUpgrades === 0, 'failed upgrade cleanup');
        mode = 'reservation';
        expectFailure(await websocketUpgradeResponse(url), 500, 'ADMISSION_FAILED');
        expect(logs).toHaveLength(2);
        expect(JSON.stringify(logs)).not.toContain('private-secret');
        mode = 'denied';
        expectFailure(await websocketUpgradeResponse(url), 401, 'AUTHENTICATION_REQUIRED');
        mode = 'healthy';
        expect((await websocketUpgradeResponse(url)).status).toBe(101);
    });

    test.each(['object', 'getter', 'proxy'])('public HTTP normalizes a hostile typed error %s without throwing from its error boundary', async mode => {
        class Broken { render() {
            if (mode === 'proxy') throw new Proxy({}, { getPrototypeOf() { throw new Error('private-secret'); } });
            const error = new AccessDenied();
            if (mode === 'object') error.code = { toString: () => 'ACCESS_DENIED' };
            else Object.defineProperty(error, 'code', { get() { throw new Error('private-secret'); } });
            throw error;
        } }
        page('/', { live: false })(Broken);
        server = start(Broken, { port: 0, bind: '127.0.0.1', logger: null });
        await waitForListening(server.server);
        const response = await request({ port: server.server.address().port });
        expect(response.status).toBe(500);
        expect(JSON.parse(response.body).error).toEqual(mode === 'object'
            ? { code: 'ADMISSION_FAILED', message: 'Internal Server Error' }
            : { code: 'PAGE_FAILED', message: 'Page request failed.' });
    });

    test.each(['origins', 'authenticate'])('timed-out %s cannot start the next admission stage and stays charged until settlement', async stage => {
        let finish, laterCalls = 0;
        const options = { timeoutMs: 20, origins: () => true, authenticate: () => true, place: () => { laterCalls++; return true; } };
        if (stage === 'origins') options.authenticate = () => { laterCalls++; return true; };
        options[stage] = () => new Promise(resolve => { finish = resolve; });
        const url = await raw(options, { maxPendingUpgrades: 1 });
        expectFailure(await websocketUpgradeResponse(url), 503, 'ADMISSION_TIMEOUT');
        expectFailure(await websocketUpgradeResponse(url), 503, 'ADMISSION_CAPACITY');
        finish(true);
        await waitForCondition(() => server.routes[0].pendingUpgrades === 0, 'actual admission settlement');
        expect(laterCalls).toBe(0);
    });

    test('a synchronous deadline overrun cannot proceed into placement', async () => {
        let placements = 0;
        const url = await raw({ timeoutMs: 15, authenticate() {
            const deadline = performance.now() + 25;
            while (performance.now() < deadline) { /* Real blocking callback, not a mocked clock. */ }
            return true;
        }, place() { placements++; return true; } });
        expectFailure(await websocketUpgradeResponse(url), 503, 'ADMISSION_TIMEOUT');
        expect(placements).toBe(0);
    });

    test('protocol and drain rejection stay distinct, and placement redirects stay uncached', async () => {
        const url = await raw({ authenticate: () => true }, { protocol: { versions: ['1'] } });
        expectFailure(await websocketUpgradeResponse(url), 426, 'PROTOCOL_UNSUPPORTED');
        server.beginDrain();
        expectFailure(await websocketUpgradeResponse(url), 503, 'SERVER_DRAINING');
        await server.shutdown();
        const placed = await raw({ place: () => 'wss://node.example/socket' });
        const redirect = await websocketUpgradeResponse(placed);
        expect(redirect.status).toBe(307);
        expect(redirect.headers.location).toBe('wss://node.example/socket');
        expect(redirect.headers['cache-control']).toBe('no-store');
    });

    test('public page failures never expose Express development stacks and capacity is not an application bug', async () => {
        class Broken { render() { throw new Error('private-secret'); } }
        class Working { render() { return '<p>ready</p>'; } }
        page('/broken', { live: false })(Broken); page('/')(Working);
        server = start([Broken, Working], { port: 0, bind: '127.0.0.1', logger: null, maxSessions: 1 });
        await waitForListening(server.server);
        const port = server.server.address().port;
        const failure = await request({ port, path: '/broken' });
        expect(failure.status).toBe(500);
        expect(failure.headers['cache-control']).toBe('private, no-store');
        expect(JSON.parse(failure.body)).toEqual({ error: { code: 'PAGE_FAILED', message: 'Page request failed.' } });
        expect((await request({ port })).status).toBe(200);
        const full = await request({ port });
        expect(full.status).toBe(503);
        expect(JSON.parse(full.body).error.code).toBe('PAGE_CAPACITY');
    });

    test('a failure after middleware sends headers closes the response instead of appending an error', async () => {
        let fail;
        class Page { render() { return new Promise((_resolve, reject) => { fail = reject; }); } }
        page('/', { live: false })(Page);
        const app = express();
        app.use((_request, response, next) => { response.write('middleware prefix'); next(); });
        server = start(Page, { server: app, port: 0, bind: '127.0.0.1', logger: null });
        await waitForListening(server.server);
        const response = await new Promise((resolve, reject) => {
            const call = http.get({ host: '127.0.0.1', port: server.server.address().port }, response => {
                let body = '';
                response.on('data', data => { body += data; });
                response.on('aborted', () => resolve({ status: response.statusCode, body }));
                response.on('error', () => {});
                waitForCondition(() => fail, 'page rendering').then(() => fail(new Error('private-secret')), reject);
            });
            call.on('error', reject);
        });
        expect(response).toEqual({ status: 200, body: 'middleware prefix' });
        expect(typeof fail).toBe('function');
    });

    test.each([
        ['credentials', 401, 'AUTHENTICATION_REQUIRED'],
        ['authentication-bug', 500, 'AUTHENTICATION_FAILED'],
        ['permission', 403, 'ACCESS_DENIED'],
        ['policy-bug', 500, 'ADMISSION_FAILED'],
        ['origin-bug', 500, 'ADMISSION_FAILED'],
    ])('page upgrades retain the %s failure category', async (mode, status, code) => {
        let upgrading = false;
        class Page { render() { return '<p>private</p>'; } }
        page('/', { authorize() {
            if (upgrading && mode === 'policy-bug') throw new Error('private-secret');
            return !(upgrading && mode === 'permission');
        } })(Page);
        server = start(Page, { port: 0, bind: '127.0.0.1', logger: null,
            origins: mode === 'origin-bug' ? () => { throw new Error('private-secret'); } : undefined,
            authenticate() {
            if (upgrading && mode === 'authentication-bug') throw new Error('private-secret');
            return upgrading && mode === 'credentials' ? false : 'alice';
        } });
        await waitForListening(server.server);
        const port = server.server.address().port;
        const config = JSON.parse((await request({ port })).body.match(/id="__redweb_page">([^<]+)/)[1]);
        upgrading = true;
        expectFailure(await websocketUpgradeResponse(`ws://127.0.0.1:${port}${config.socketPath}?pageId=${config.pageId}&redwebVersion=1`,
            { headers: { origin: `http://127.0.0.1:${port}` } }), status, code);
    });
});
