'use strict';

const fs = require('fs');
const path = require('path');
const { once } = require('events');
const WebSocket = require('ws');
const { RedwebClient } = require('redweb-client');
const { start, page, state, action, SocketServer, SocketRoute, BaseHandler } = require('../..');
const { jsx } = require('../../jsx-runtime');
const { ReactivePage, SharedReactivePage } = require('../fixtures/reactive-pages');
const ReactiveRenderer = require('../../src/htmx/ReactiveRenderer');
const { request, waitForListening, waitForCondition, waitForOpen, silentLogger } = require('../helpers/network');

function standardFixture() {
    const ts = require('typescript');
    const filename = path.resolve(__dirname, '../fixtures/inspection-page.tsx');
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
        jsxImportSource: '../..', experimentalDecorators: false,
    } });
    const exports = {};
    // Execute this trusted fixture with the same real module registry as the test.
    new Function('require', 'exports', output.outputText)(require, exports);
    return exports;
}

let server;
const clients = [];
afterEach(async () => {
    for (const client of clients.splice(0)) client.close();
    await server?.shutdown();
    server = null;
});

async function boot(Page = ReactivePage, options = {}) {
    server = start(Page, { port: 0, bind: '127.0.0.1', logger: silentLogger, development: { inspect: true }, ...options });
    await waitForListening(server.server);
}

async function visitor(config) {
    const port = server.server.address().port;
    const response = config ? null : await request({ port, headers: { Cookie: 'credential-secret' }, path: '/?private=query-secret' });
    config ||= JSON.parse(response.body.match(/id="__redweb_page">([^<]+)/)[1]);
    const origin = `http://127.0.0.1:${port}`;
    const client = new RedwebClient(`${origin.replace('http:', 'ws:')}${config.socketPath}?pageId=${config.pageId}`, {
        version: config.version, reconnect: false,
        webSocketFactory: url => new WebSocket(url, { origin, headers: { Cookie: 'credential-secret' } }),
    });
    clients.push(client);
    await client.connect();
    await waitForCondition(() => [...server.manager.active.values()].some(session => session.id === config.pageId && session.socket), 'registered visitor');
    return { client, config };
}

test('standard metadata is observed without construction, values, or an inspection endpoint', async () => {
    const fixture = standardFixture();
    await boot(fixture.InspectionPage, { authenticate: () => 'principal-secret' });
    expect(fixture.constructions).toBe(0);
    const before = server.inspect();
    expect(before.pages.registrations.items[0].instanceMetadata).toBe('unobserved');
    expect(before.pages.registrations.items[0].actions.items).toEqual([]);
    expect(fixture.constructions).toBe(0);
    const response = await request({ port: server.server.address().port });
    const config = JSON.parse(response.body.match(/id="__redweb_page">([^<]+)/)[1]);
    expect(server.inspect().pages.connections.pending).toBe(1);
    const first = await visitor(config);
    expect(fixture.constructions).toBe(1);
    await first.client.request('redweb:html', { kind: 'action', component: 'counter', name: 'increment', args: [] });
    await waitForCondition(() => server.inspect().history.items.some(event => event.kind === 'state-invalidated'), 'invalidation history');
    const snapshot = server.inspect();
    const registration = snapshot.pages.registrations.items[0];
    expect(registration.actions.items).toEqual(['nothing']);
    expect(registration.states.items).toEqual(['password', 'unused']);
    expect(registration.instances.items[0].components.items[0]).toMatchObject({ id: 'counter', actions: { items: ['increment'] }, states: { items: ['count'] } });
    expect(snapshot.pages.connections.connected).toBe(1);
    expect(snapshot.history.items.filter(event => event.kind === 'state-invalidated')).toHaveLength(2);
    const serialized = JSON.stringify(snapshot);
    for (const secret of ['state-secret', 'credential-secret', 'principal-secret', 'query-secret', first.config.pageId, '<output>']) expect(serialized).not.toContain(secret);
    const instance = [...server.manager.active.values()][0].page;
    Object.defineProperty(instance, 'password', { get() { throw new Error('Inspection read a state value'); } });
    expect(server.inspect().pages.available).toBe(true);
    expect(Object.isFrozen(snapshot.pages.registrations.items)).toBe(true);
    expect((await request({ port: server.server.address().port, path: '/__redweb/inspect' })).status).toBe(404);
    await server.revoke('principal-secret');
    expect(server.inspect().pages.sessions.total).toBe(0);
});

test('shared instances deduplicate while connections, retention, reconnect and shutdown remain distinct', async () => {
    await boot(SharedReactivePage);
    const first = await visitor(), second = await visitor();
    expect(server.inspect().pages.registrations.items[0].instances.total).toBe(1);
    expect(server.inspect().pages.connections.connected).toBe(2);
    const renderer = [...server.manager.active.values()][0].renderer;
    expect(renderer.constructor).not.toBe(ReactiveRenderer);
    const originalRenderId = server.inspect().pages.sessions.items.find(item => item.render).render;
    first.client.close();
    await waitForCondition(() => server.inspect().pages.connections.retained === 1, 'retained reconnect session');
    expect(server.inspect().pages.connections.connected).toBe(1);
    await visitor(first.config);
    expect(server.inspect().pages.connections.connected).toBe(2);
    expect(server.inspect().pages.sessions.items.map(item => item.render)).toContain(originalRenderId);
    await second.client.request('redweb:html', { kind: 'action', name: 'nothing', args: [] });
    await waitForCondition(() => server.inspect().history.items.some(event => event.kind === 'state-invalidated' && event.affectedOwners.total === 0), 'unused state cause');
    await server.shutdown();
    expect(server.inspect().pages.connections).toEqual({ connected: 0, pending: 0, detaching: 0, retained: 0 });
    expect(server.inspect().pages.closing).toBe(true);
});

test('disabled inspection uses the original renderer and adds no listeners or browser resources', async () => {
    await boot(ReactivePage, { development: undefined });
    const counts = { request: server.server.listenerCount('request'), upgrade: server.server.listenerCount('upgrade') };
    const first = await visitor();
    expect(server.inspect()).toBeNull();
    expect([...server.manager.active.values()][0].renderer.constructor).toBe(ReactiveRenderer);
    expect(server.server.listenerCount('request')).toBe(counts.request);
    expect(server.server.listenerCount('upgrade')).toBe(counts.upgrade);
    await first.client.request('redweb:html', { kind: 'action', name: 'nothing', args: [] });
});

test('raw route inspection follows dynamic handlers/routes without materializing socket context', async () => {
    class Echo extends BaseHandler { constructor() { super('echo'); } onMessage() {} }
    class Route extends SocketRoute { constructor() { super({ path: '/first', handlers: [Echo], allowDuplicateConnections: true }); } }
    class Second extends SocketRoute { constructor() { super({ path: '/second', handlers: [Echo], rooms: true, sessions: true }); } }
    server = new SocketServer({ port: 0, bind: '127.0.0.1', routes: [Route], logger: silentLogger, development: { inspect: true } });
    await waitForListening(server.server);
    const socket = new WebSocket(`ws://127.0.0.1:${server.server.address().port}/first`);
    clients.push(socket);
    await waitForOpen(socket);
    const connection = [...server.routes[0].clients.values()][0];
    expect(server.routes[0].runtime.contexts.has(connection)).toBe(false);
    server.addRoute(Second);
    const secondSocket = new WebSocket(`ws://127.0.0.1:${server.server.address().port}/second`);
    clients.push(secondSocket);
    await waitForOpen(secondSocket);
    const secondConnection = [...server.routes[1].clients.values()][0];
    secondConnection.joinRoom('hidden-room');
    secondConnection.createSession('hidden-session', { value: 'hidden-value' });
    const snapshot = server.inspect();
    expect(snapshot.pages.registrations.total).toBe(0);
    expect(snapshot.sockets.routes.items).toMatchObject([{ path: '/first', handlers: { items: ['echo'] }, registeredConnections: 1 }, { path: '/second' }]);
    expect(server.routes[0].runtime.contexts.has(connection)).toBe(false);
    expect(snapshot.sockets.routes.items[1]).toMatchObject({ rooms: 1, sessions: 1 });
    for (const secret of ['hidden-room', 'hidden-session', 'hidden-value']) expect(JSON.stringify(snapshot)).not.toContain(secret);
    let getterCalls = 0;
    const handler = server.routes[0].handlers[0];
    Object.defineProperty(handler, 'name', { configurable: true, get() { getterCalls++; return 'secret-handler'; } });
    expect(server.inspect().sockets.routes.items[0].handlers.items).toEqual(['[unavailable]']);
    expect(getterCalls).toBe(0);
    Object.defineProperty(handler, 'name', { configurable: true, writable: true, value: 'echo' });
    const closed = once(socket, 'close'); socket.close(); await closed;
    await waitForCondition(() => server.inspect().sockets.routes.items[0].registeredConnections === 0, 'route disconnect');
    server.beginDrain();
    expect(server.inspect().sockets.draining).toBe(true);
});

test('static pages remain uninstantiated until requested and create no socket inspector', async () => {
    let constructions = 0;
    class StaticPage { constructor() { constructions++; } render() { return '<h1>Static</h1>'; } }
    page('/', { live: false })(StaticPage);
    await boot(StaticPage);
    expect(server.inspect().pages.registrations.items[0].live).toBe(false);
    expect(server.inspect().sockets.routes.total).toBe(0);
    expect(constructions).toBe(0);
    expect((await request({ port: server.server.address().port })).status).toBe(200);
    expect(constructions).toBe(1);
    expect(server.inspect().pages.registrations.items[0].instanceMetadata).toBe('unobserved');
});

test('disconnecting an in-flight render reports supersession, not delivery, and tracks detaching', async () => {
    let finishRender, finishDisconnect;
    class SlowPage {
        count = 0;
        bump() { this.count++; }
        render() {
            const content = jsx('output', { children: this.count });
            return this.count ? new Promise(resolve => { finishRender = () => resolve(content); }) : content;
        }
        disconnected() { return new Promise(resolve => { finishDisconnect = resolve; }); }
    }
    state()(SlowPage.prototype, 'count');
    action()(SlowPage.prototype, 'bump', Object.getOwnPropertyDescriptor(SlowPage.prototype, 'bump'));
    page('/')(SlowPage);
    await boot(SlowPage);
    const person = await visitor();
    try {
        await person.client.request('redweb:html', { kind: 'action', name: 'bump', args: [] });
        await waitForCondition(() => Boolean(finishRender), 'slow render started');
        person.client.close();
        await waitForCondition(() => server.inspect().pages.connections.detaching === 1, 'disconnect hook');
        await waitForCondition(() => server.inspect().history.items.some(event => event.kind === 'flush-superseded'), 'superseded render');
    } finally {
        finishRender?.(); finishDisconnect?.();
    }
    await waitForCondition(() => server.inspect().pages.connections.retained === 1, 'retained after hook');
});

test('render failures are diagnosed without retaining or exposing the application exception', async () => {
    class BrokenPage {
        count = 0;
        bump() { this.count++; }
        render() {
            if (this.count) throw new Error('sensitive-render-error');
            return jsx('output', { children: this.count });
        }
    }
    state()(BrokenPage.prototype, 'count');
    action()(BrokenPage.prototype, 'bump', Object.getOwnPropertyDescriptor(BrokenPage.prototype, 'bump'));
    page('/')(BrokenPage);
    await boot(BrokenPage);
    const person = await visitor();
    await person.client.request('redweb:html', { kind: 'action', name: 'bump', args: [] });
    await waitForCondition(() => server.inspect().history.items.some(event => event.kind === 'flush-failed'), 'failure diagnosis');
    expect(JSON.stringify(server.inspect())).not.toContain('sensitive-render-error');
});

test('application class-name, constructor and replaced method accessors are never evaluated by inspection', async () => {
    const fixture = standardFixture();
    await boot(fixture.InspectionPage);
    await visitor();
    const session = [...server.manager.active.values()][0];
    const Counter = session.page.counter.constructor;
    let getterCalls = 0;
    Object.defineProperty(Counter, 'name', { configurable: true, get() { getterCalls++; return 'private-class-secret'; } });
    Object.defineProperty(Counter.prototype, 'increment', { configurable: true, get() { getterCalls++; return () => {}; } });
    // Invalidate the metadata cache so this verifies fresh resolution as well.
    state()(Counter.prototype, 'other');
    const snapshot = server.inspect();
    expect(snapshot.pages.registrations.items[0].instances.items[0].components.items[0].actions.items).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toContain('private-class-secret');
    expect(getterCalls).toBe(0);
    Object.defineProperty(session.page.counter, 'constructor', { configurable: true, get() { getterCalls++; return Counter; } });
    Object.defineProperty(session.page, 'constructor', { configurable: true, get() { getterCalls++; return fixture.InspectionPage; } });
    expect(server.inspect().pages.available).toBe(true);
    await session.renderer.flush();
    expect(getterCalls).toBe(0);
});
