'use strict';
const WebSocket = require('ws');
const express = require('express');
const { RedwebClient } = require('redweb-client');
const { start, page, action, state, component, exportStatic, defineSite } = require('../..');
const { jsx } = require('../../jsx-runtime');
const { request, waitForListening, waitForCondition, websocketUpgradeStatus, silentLogger } = require('../helpers/network');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const delay = () => new Promise(resolve => setTimeout(resolve, 30));
const expose = (Type, name, options) => action(options)(Type.prototype, name, Object.getOwnPropertyDescriptor(Type.prototype, name));

describe('protected pages and revocation over real HTTP/WebSockets', () => {
    let server;
    const clients = [];
    afterEach(async () => { clients.splice(0).forEach(client => client.close()); await server?.shutdown(); });
    async function boot(Type, options = {}) {
        server = start(Type, { port: 0, bind: '127.0.0.1', logger: silentLogger, authenticate: req => req.headers.authorization, ...options });
        await waitForListening(server.server);
        return server.server.address().port;
    }
    const get = (principal = 'alice', route = '/') => request({ port: server.server.address().port, path: route, headers: { authorization: principal } });
    function url(config) { return `ws://127.0.0.1:${server.server.address().port}${config.socketPath}?pageId=${config.pageId}&redwebVersion=1`; }
    async function connect(principal = 'alice', config, route = '/') {
        if (!config) config = JSON.parse((await get(principal, route)).body.match(/id="__redweb_page">([^<]+)/)[1]);
        const frames = [];
        const client = new RedwebClient(url(config), { version: '1', requestTimeoutMs: 1000,
            webSocketFactory: address => new WebSocket(address, { headers: { Origin: `http://127.0.0.1:${server.server.address().port}`, authorization: principal } }),
        });
        for (const type of ['redweb:patch', 'redweb:state']) client.on(type, message => frames.push(message));
        clients.push(client);
        await client.connect();
        return { client, frames, config };
    }
    const invoke = (visitor, name = 'run', args = []) => visitor.client.request('redweb:html', { kind: 'action', name, args });
    const deniedUpgrade = config => websocketUpgradeStatus(url(config), { headers: { Origin: `http://127.0.0.1:${server.server.address().port}`, authorization: 'alice' } });

    test('denies before construction/loading and keeps protected static responses private without 304', async () => {
        let constructors = 0, loads = 0;
        class Page { constructor() { constructors += 1; } loading() { loads += 1; } render() { return '<p>private report</p>'; } }
        page('/', { live: false, cache: { maxAge: 600 }, authorize: context => context.principal === 'alice' })(Page);
        const port = await boot(Page);
        expect((await request({ port })).status).toBe(401);
        const denial = await get('bob');
        expect(denial.status).toBe(403);
        expect(denial.headers['cache-control']).toBe('private, no-store');
        expect(constructors).toBe(0);
        expect(loads).toBe(0);
        const allowed = await get();
        expect(allowed.status).toBe(200);
        expect(allowed.headers.etag).toBeUndefined();
        expect(allowed.headers['cache-control']).toBe('private, no-store');
        expect((await request({ port, headers: { authorization: 'alice', 'if-none-match': '*' } })).status).toBe(200);
        expect(loads).toBe(2);
    });

    test('page policies alone disable public caching and sanitize broken or overdue checks', async () => {
        let mode = 'allow';
        class Page { render() { return '<p>policy controlled</p>'; } }
        page('/', { live: false, authorize: () => {
            if (mode === 'bug') throw new Error('private policy secret');
            if (mode === 'timeout') return new Promise(() => {});
            return true;
        }, authorizationTimeoutMs: 10 })(Page);
        const port = await boot(Page, { authenticate: undefined });
        const response = await request({ port, headers: { 'if-none-match': '*' } });
        expect(response.status).toBe(200);
        expect(response.headers['cache-control']).toBe('private, no-store');
        mode = 'bug';
        expect(JSON.parse((await request({ port })).body).error).toEqual({ code: 'PAGE_FAILED', message: 'Page request failed.' });
        mode = 'timeout';
        const overdue = await request({ port });
        expect(overdue.status).toBe(503);
        expect(JSON.parse(overdue.body).error.code).toBe('ACCESS_TIMEOUT');
    });

    test('preserves the original immutable resource request across actions and reconnects', async () => {
        let original, loaded, connected;
        const app = express();
        app.use((req, _res, next) => { original = req; next(); });
        class Page {
            loading(context) { loaded = context; }
            connected(context) { connected = context; }
            render() { return '<p>resource</p>'; }
            run(context) { return { principal: context.principal, resource: context.params.resource, name: context.query.name, path: context.request.path }; }
        }
        page('/private/:resource', { authorize: context => context.params.resource === '42' })(Page);
        expose(Page, 'run');
        await boot(Page, { server: app });
        const visitor = await connect('alice', undefined, '/private/42?name=original');
        await waitForCondition(() => connected, 'connected hook');
        expect(connected.request).toBe(loaded.request);
        expect(connected.request).not.toBe(original);
        expect(Reflect.set(loaded.query, 'name', 'forged')).toBe(false);
        expect(Reflect.set(loaded.request.headers, 'authorization', 'forged')).toBe(false);
        expect(loaded.request.get('Authorization')).toBe('alice');
        original.query.name = 'mutated application request';
        const expected = { principal: 'alice', resource: '42', name: 'original', path: '/private/42' };
        expect((await invoke(visitor)).payload).toEqual(expected);
        visitor.client.close();
        await waitForCondition(() => ![...server.manager.active.values()][0]?.socket, 'normal disconnect');
        const reconnected = await connect('alice', visitor.config);
        expect((await invoke(reconnected)).payload).toEqual(expected);
    });

    test('rechecks page permission for actions and browser-writable state', async () => {
        let permitted = true, instance, calls = 0;
        class Page { constructor() { instance = this; this.value = 0; } render() { return '<p>{{value}}</p>'; } run() { calls += 1; return calls; } }
        state({ writable: true })(Page.prototype, 'value');
        page('/', { authorize: () => permitted })(Page);
        expose(Page, 'run');
        await boot(Page);
        const visitor = await connect();
        permitted = false;
        await expect(invoke(visitor)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
        await expect(visitor.client.request('redweb:html', { kind: 'state', name: 'value', value: 99 })).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
        expect(calls).toBe(0);
        expect(instance.value).toBe(0);
        permitted = true;
        expect((await invoke(visitor)).payload).toBe(1);
    });

    test.each([false, true])('revoke synchronously blocks future %s reactive updates and old tokens, without affecting another identity', async reactive => {
        const instances = new Map();
        class Page {
            value = 0;
            loading(context) {
                instances.set(context.principal, this);
                context.signal.addEventListener('abort', () => {
                    this.value = 777;
                    // A callback may touch more than the currently-aborted instance.
                    for (const entry of instances.values()) entry.value = 888;
                }, { once: true });
            }
            render() { return reactive ? jsx('output', { children: this.value }) : '<output>{{value}}</output>'; }
            run() { this.value += 1; return this.value; }
        }
        page('/', { authorize: context => Boolean(context.principal) })(Page);
        state()(Page.prototype, 'value'); expose(Page, 'run');
        await boot(Page);
        const alice = await connect('alice'), anotherAlice = await connect('alice'), bob = await connect('bob');
        await waitForCondition(() => alice.frames.length && anotherAlice.frames.length && bob.frames.length, 'initial snapshots');
        alice.frames.length = 0;
        anotherAlice.frames.length = 0;
        const revoked = server.revoke('alice');
        instances.get('alice').value = 999;
        expect([...server.manager.active.values()].some(session => session.principal === 'alice')).toBe(false);
        expect(await revoked).toBe(2);
        await delay();
        expect(alice.frames).toEqual([]);
        expect(anotherAlice.frames).toEqual([]);
        expect(await deniedUpgrade(alice.config)).toBe(401);
        expect((await invoke(bob)).payload).toBe(889);
        expect(await server.revoke('nobody')).toBe(0);
    });

    test('revocation invalidates unresolved identity checks without constructing a page', async () => {
        let finish, constructors = 0;
        class Page { constructor() { constructors += 1; } render() { return '<p>secret</p>'; } }
        page('/')(Page);
        await boot(Page, { authenticate: () => new Promise(resolve => { finish = resolve; }) });
        const response = get();
        await waitForCondition(() => finish, 'identity lookup');
        expect(await server.revoke('alice')).toBe(1);
        expect((await response).status).toBe(503);
        finish('alice'); await delay();
        expect(constructors).toBe(0);
        expect(server.manager.pending.size).toBe(0);
    });

    test('revocation cancels loading and prevents a late HTTP page or session', async () => {
        let finish, signal, renders = 0;
        class Page { loading(context) { signal = context.signal; return new Promise(resolve => { finish = resolve; }); } render() { renders += 1; return '<p>secret</p>'; } }
        page('/', { authorize: () => true })(Page);
        await boot(Page);
        const response = get();
        await waitForCondition(() => finish, 'loading');
        await server.revoke('alice');
        expect(signal.aborted).toBe(true);
        expect((await response).status).toBe(503);
        finish(); await delay();
        expect(renders).toBe(0);
        expect(server.manager.pending.size).toBe(0);
    });

    test('a browser abandoning HTTP cancels its render and releases capacity', async () => {
        let signal;
        class Page { loading(context) { signal = context.signal; return new Promise(() => {}); } render() { return '<p>not delivered</p>'; } }
        page('/')(Page);
        const port = await boot(Page);
        const pending = http.get({ host: '127.0.0.1', port, headers: { authorization: 'alice' } });
        pending.on('error', () => {});
        await waitForCondition(() => signal, 'HTTP loading');
        pending.destroy();
        await waitForCondition(() => signal.aborted && server.manager.rendering === 0, 'abandoned render released');
        expect(server.manager.lifetimes.size).toBe(0);
    });

    test.each([0, 20])('shutdown remains bounded when loading and disposal ignore cancellation (budget %ims)', async shutdownTimeoutMs => {
        let entered = false;
        class Page { loading() { entered = true; return new Promise(() => {}); } disposed() { return new Promise(() => {}); } render() { return '<p>never</p>'; } }
        page('/')(Page);
        await boot(Page, { shutdownTimeoutMs });
        const pending = get().catch(error => error);
        await waitForCondition(() => entered, 'loading');
        const stopping = server; server = undefined;
        const began = Date.now();
        const failure = await stopping.shutdown().catch(error => error);
        expect(failure.message).toBe('Live HTML shutdown failed.');
        if (shutdownTimeoutMs === 0) {
            expect(failure.errors.some(error => error.errors?.some(cause =>
                cause.code === 'LIVE_HTML_SHUTDOWN_TIMEOUT' && cause.message === 'Live HTML render cleanup exceeded shutdownTimeoutMs.'))).toBe(true);
        }
        expect(Date.now() - began).toBeLessThan(1000);
        await pending;
        expect(stopping.server.listening).toBe(false);
    });

    test('revocation during connection hooks prevents child snapshots and token resurrection', async () => {
        let finish, childConnections = 0;
        class Child { value = 'secret'; connected() { childConnections += 1; } render() { return '<p>{{value}}</p>'; } }
        component()(Child); state()(Child.prototype, 'value');
        class Page { child = new Child(); connected() { return new Promise(resolve => { finish = resolve; }); } render() { return '<p>connecting</p>'; } }
        page('/', { authorize: () => true })(Page);
        await boot(Page);
        const visitor = await connect();
        await waitForCondition(() => finish, 'connection hook');
        await server.revoke('alice');
        finish(); await delay();
        expect(childConnections).toBe(0);
        expect(visitor.frames).toEqual([]);
        expect(await deniedUpgrade(visitor.config)).toBe(401);
    });

    test('revocation fences asynchronous action validation, including unguarded action methods', async () => {
        let finish, calls = 0;
        class Page { render() { return '<p>action</p>'; } run() { calls += 1; } }
        page('/', { authorize: () => true })(Page);
        expose(Page, 'run', { input: { '~standard': { version: 1, validate: value => new Promise(resolve => { finish = () => resolve({ value }); }) } } });
        await boot(Page);
        const visitor = await connect();
        const response = invoke(visitor, 'run', ['input']).catch(error => error);
        await waitForCondition(() => finish, 'action validation');
        await server.revoke('alice');
        await response;
        finish(); await delay();
        expect(calls).toBe(0);
    });

    test('no browser state write occurs after revocation across asynchronous policy microtask boundaries', async () => {
        let instance, ticks, atRevocation, revoked;
        class Page { value = 0; constructor() { instance = this; } render() { return '<p>{{value}}</p>'; } }
        state({ writable: true })(Page.prototype, 'value');
        page('/', { authorize: () => {
            if (ticks !== undefined) {
                let pending = Promise.resolve();
                for (let i = 0; i < ticks; i += 1) pending = pending.then(() => {});
                ticks = undefined;
                pending.then(() => { atRevocation = instance.value; revoked = server.revoke('alice'); });
            }
            return true;
        } })(Page);
        await boot(Page);
        for (let turn = 0; turn < 16; turn += 1) {
            const visitor = await connect();
            atRevocation = undefined; revoked = undefined; ticks = turn;
            visitor.client.send('redweb:html', { kind: 'state', name: 'value', value: 99 });
            await waitForCondition(() => revoked, 'scheduled revocation');
            await revoked;
            await delay();
            expect(instance.value).toBe(atRevocation);
        }
    });

    test('revocation cancels an in-flight upgrade policy and rejects its eventual approval', async () => {
        let block = false, finish;
        class Page { render() { return '<p>private</p>'; } }
        page('/', { authorize: () => block ? new Promise(resolve => { finish = resolve; }) : true })(Page);
        await boot(Page);
        const config = JSON.parse((await get()).body.match(/id="__redweb_page">([^<]+)/)[1]);
        block = true;
        const admission = deniedUpgrade(config);
        await waitForCondition(() => finish, 'upgrade policy');
        await server.revoke('alice');
        expect(await admission).toBe(503);
        finish(true);
        block = false;
        expect(await deniedUpgrade(config)).toBe(401);
    });

    test('revocation suppresses a pending reactive render after its application promise completes', async () => {
        let instance, finish;
        class Page {
            value = 0;
            constructor() { instance = this; }
            async render() {
                const value = this.value;
                if (value === 99) await new Promise(resolve => { finish = resolve; });
                return jsx('output', { children: value });
            }
        }
        page('/', { authorize: () => true })(Page); state()(Page.prototype, 'value');
        await boot(Page);
        const visitor = await connect();
        await waitForCondition(() => visitor.frames.length, 'snapshot');
        visitor.frames.length = 0;
        instance.value = 99;
        await waitForCondition(() => finish, 'reactive render');
        await server.revoke('alice');
        finish(); await delay();
        expect(visitor.frames).toEqual([]);
    });

    test.each(['reject', 'hang'])('revocation stays effective when application disposal will %s', async mode => {
        class Page { render() { return '<p>private</p>'; } disposed() { if (mode === 'reject') throw new Error('private cleanup error'); return new Promise(() => {}); } }
        page('/', { authorize: () => true })(Page);
        await boot(Page, { shutdownTimeoutMs: 25 });
        const visitor = await connect();
        const began = Date.now();
        await expect(server.revoke('alice')).rejects.toMatchObject({ code: 'REVOCATION_CLEANUP_FAILED' });
        expect(Date.now() - began).toBeLessThan(500);
        expect(await deniedUpgrade(visitor.config)).toBe(401);
        expect(server.manager.active.size).toBe(0);
    });

    test.each(['reject', 'hang'])('revocation includes an existing disconnect hook that will %s', async mode => {
        let complete;
        class Page {
            render() { return '<p>private</p>'; }
            disconnected() { return new Promise((resolve, reject) => { complete = error => error ? reject(error) : resolve(); }); }
        }
        page('/', { authorize: () => true })(Page);
        await boot(Page, { shutdownTimeoutMs: 25 });
        const visitor = await connect();
        visitor.client.close();
        await waitForCondition(() => complete, 'disconnect hook');
        const revoked = expect(server.revoke('alice')).rejects.toMatchObject({ code: 'REVOCATION_CLEANUP_FAILED' });
        if (mode === 'reject') complete(new Error('private disconnect error'));
        await revoked;
        complete();
        await delay();
        expect(await deniedUpgrade(visitor.config)).toBe(401);
    });

    test('contains policy/application secrets and bounds hung identity lookup', async () => {
        class Page { render() { const error = new Error('private database password'); error.code = 'secret-code'; throw error; } }
        page('/', { authorize: () => true })(Page);
        await boot(Page);
        const failed = await get();
        expect(failed.status).toBe(500);
        expect(JSON.parse(failed.body)).toEqual({ error: { code: 'PAGE_FAILED', message: 'Page request failed.' } });
        await server.shutdown();
        await boot(Page, { authenticate: () => new Promise(() => {}), authenticationTimeoutMs: 10 });
        expect(JSON.parse((await get()).body).error.code).toBe('AUTHENTICATION_TIMEOUT');
    });

    test('rejects protected shared pages and static exports before construction/output', async () => {
        expect(() => page('/', { shared: true, authorize: () => true })).toThrow('connection scope');
        let constructors = 0;
        class Page { constructor() { constructors += 1; } render() { return '<p>secret</p>'; } }
        page('/', { live: false, authorize: () => true })(Page);
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'redweb-private-export-'));
        try {
            for (const exportPages of [exportStatic, defineSite().export]) {
                await expect(exportPages(Page, { outDir: path.join(directory, 'output') })).rejects.toThrow('cannot be exported');
            }
            expect(constructors).toBe(0);
            expect(fs.existsSync(path.join(directory, 'output'))).toBe(false);
        } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    });
});
