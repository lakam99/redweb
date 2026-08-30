const WebSocket = require('ws');
const path = require('path');
const { RedwebClient } = require('redweb-client');
const { LiveHtmlServer, LivePage, codeBlock, component, defineSite, html, page, start: startPages } = require('../..');
const { CounterPage } = require('../../examples/live-html/counter');
const { createChatroomPage } = require('../../examples/live-html/chatroom');
const { CardsPage } = require('../../examples/live-html/cards');
const { ComponentsPage } = require('../../examples/live-html/components');
const { JsxPage } = require('../../examples/live-html/jsx-page');
const createCounterServer = options => startPages(CounterPage, options);
const createChatroomServer = options => startPages(createChatroomPage(), options);
const createCardsServer = options => startPages(CardsPage, options);
const createComponentsServer = options => startPages(ComponentsPage, options);
const createJsxServer = options => startPages(JsxPage, options);
class StaticReferencePage {
    render() { return '<html><body><h1>Static reference</h1></body></html>'; }
}
page('/reference', {
    live: false,
    shared: true,
    head: { title: 'Redweb Reference', description: 'Static API documentation' },
    cache: { maxAge: 60, staleWhileRevalidate: 30, immutable: true },
})(StaticReferencePage);
class DefaultStaticPage {
    render() { return '<p>Default cache</p>'; }
}
page('/default-reference', { live: false })(DefaultStaticPage);
class MutableStaticPage {
    render() { return '<p>Mutable cache</p>'; }
}
page('/mutable-reference', { live: false, cache: { maxAge: 60 } })(MutableStaticPage);
const createStaticReferenceServer = options => startPages([StaticReferencePage, DefaultStaticPage, MutableStaticPage], options);
const referenceSite = defineSite({
    origin: 'https://docs.example.test',
    layout: (content, context) => html`<body><nav>${context.request.path}</nav><main>${content}</main></body>`,
});
class SiteReferencePage {
    render() { return html`<h1>${'Site reference'}</h1>`; }
}
referenceSite.page('/site-reference', { head: { title: 'Site Reference' } })(SiteReferencePage);
const createSiteReferenceServer = options => startPages(SiteReferencePage, options);
class AuthenticatedStaticPage {
    name = '';
    loading({ principal }) { this.name = String(principal); }
    render() { return '<p>{{ name }}</p>'; }
}
page('/private-reference', { live: false, cache: { maxAge: 3600 } })(AuthenticatedStaticPage);
const createAuthenticatedStaticServer = options => startPages(AuthenticatedStaticPage, options);
class LiteralFragmentPage {
    secret = 'must not bind';
    render() { return html`<p>${'{{ secret }}'}</p>${codeBlock('{{ missing }}')}`; }
}
page('/literal-fragment')(LiteralFragmentPage);
const createLiteralFragmentServer = options => startPages(LiteralFragmentPage, options);
const {
    closeWebSocket,
    nextMessage,
    request,
    silentLogger,
    waitForCondition,
    waitForListening,
    waitForOpen,
    websocketUpgradeStatus,
} = require('../helpers/network');

function pageConfig(html) {
    const match = html.match(/<script type="application\/json" id="__redweb_page">([^<]+)<\/script>/);
    if (!match) throw new Error('Live HTML bootstrap was not rendered.');
    return JSON.parse(match[1]);
}

function liveClient(port, config) {
    const origin = `http://127.0.0.1:${port}`;
    return new RedwebClient(`ws://127.0.0.1:${port}${config.socketPath}?pageId=${config.pageId}`, {
        version: config.version,
        webSocketFactory: url => new WebSocket(url, { headers: { Origin: origin } }),
    });
}

async function nextJson(socket) {
    const message = await nextMessage(socket);
    return JSON.parse(message.data.toString());
}

function closeLiveClient(client) {
    if (client.state === 'closed' || client.state === 'idle') {
        client.close();
        return Promise.resolve();
    }
    return new Promise(resolve => {
        const unsubscribe = client.onClose(() => {
            unsubscribe();
            resolve();
        });
        client.close();
    });
}

describe('Live HTML integration without mocks', () => {
    const servers = new Set();
    const clients = new Set();
    const rawSockets = new Set();

    afterEach(async () => {
        await Promise.all([...clients].map(closeLiveClient));
        clients.clear();
        await Promise.all([...rawSockets].map(closeWebSocket));
        rawSockets.clear();
        await Promise.all([...servers].map(server => server.shutdown()));
        servers.clear();
    });

    async function start(factory, options = {}) {
        const server = factory({
            port: 0,
            bind: '127.0.0.1',
            logger: silentLogger,
            sessionTtlMs: 1000,
            ...options,
        });
        servers.add(server);
        await waitForListening(server.server);
        return server;
    }

    async function getPage(server) {
        const port = server.server.address().port;
        const response = await request({ port, path: '/' });
        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toContain('text/html');
        return { port, response, config: pageConfig(response.body) };
    }

    test('serves compiled TSX and routes its server action over real HTTP and WebSocket connections', async () => {
        const server = await start(createJsxServer);
        const port = server.server.address().port;
        const response = await request({ port, path: '/jsx' });
        expect(response.status).toBe(200);
        expect(response.body).toContain('<h1>Redweb JSX</h1>');
        expect(response.body).toContain('<article class="counter-card">');
        expect(response.body).toContain('<output>0</output>');
        const config = pageConfig(response.body);
        const updates = [];
        const client = liveClient(port, config);
        client.on('redweb:patch', message => updates.push(message.payload));
        clients.add(client);
        await client.connect();
        await waitForCondition(() => updates.length === 1, 'JSX state snapshot');
        expect(updates[0].patches[0].html).toContain('<output>0</output>');
        expect(updates[0].states).toEqual([]);
        await client.request('redweb:html', { kind: 'action', name: 'increment', args: [] });
        await waitForCondition(() => updates.length === 2, 'JSX action state update');
        expect(updates[1].patches[0].html).toContain('<output>1</output>');
        expect(updates[1].states).toEqual([]);
    });

    async function connectClient(port, config) {
        const client = liveClient(port, config);
        clients.add(client);
        await client.connect();
        return client;
    }

    test('serves a site layout and generated metadata through a real HTTP listener', async () => {
        const server = await start(createSiteReferenceServer);
        const port = server.server.address().port;
        const response = await request({ port, path: '/site-reference' });
        expect(response.status).toBe(200);
        expect(response.body).toContain('<body><nav>/site-reference</nav><main><h1>Site reference</h1></main></body>');
        expect(response.body).toContain('<title>Site Reference</title>');
        expect(response.body).toContain('<link rel="canonical" href="https://docs.example.test/site-reference">');
        expect(response.body).not.toContain('__redweb_page');
    });

    test('the shipped counter SSRs and emits isolated server-owned increments over the official client', async () => {
        const server = await start(createCounterServer);
        const firstPage = await getPage(server);
        expect(firstPage.response.body).toContain('Server-side counter');
        expect(firstPage.response.body).toContain('data-rw-state="count">0</output>');
        const stylesheetPath = firstPage.response.body.match(/<link rel="stylesheet" href="([^"]+)">/)?.[1];
        expect(stylesheetPath).toMatch(/^\/__redweb\/css\/[a-f0-9]{64}\.css$/);
        const stylesheet = await request({ port: firstPage.port, path: stylesheetPath });
        expect(stylesheet.status).toBe(200);
        expect(stylesheet.headers['content-type']).toContain('text/css');
        expect(stylesheet.headers['cache-control']).toBe('public, max-age=31536000, immutable');
        expect(stylesheet.body).toContain('color: #67e8f9');

        const runtime = await request({ port: firstPage.port, path: firstPage.config.runtimePath });
        const browserClient = await request({ port: firstPage.port, path: '/__redweb/client.js' });
        expect(runtime.status).toBe(200);
        expect(runtime.body).toContain("new RedwebClient");
        expect(browserClient.status).toBe(200);
        expect(browserClient.body).toContain('RedwebClient = class');

        const firstUpdates = [];
        const first = liveClient(firstPage.port, firstPage.config);
        first.on('redweb:state', message => firstUpdates.push(message.payload));
        clients.add(first);
        await first.connect();
        await waitForCondition(() => firstUpdates.length >= 3, 'initial state and two server counter updates', 3500);
        expect(firstUpdates.slice(0, 3)).toEqual([
            { name: 'count', value: '0', html: false },
            { name: 'count', value: '1', html: false },
            { name: 'count', value: '2', html: false },
        ]);

        const secondPage = await getPage(server);
        const secondUpdates = [];
        const second = liveClient(secondPage.port, secondPage.config);
        second.on('redweb:state', message => secondUpdates.push(message.payload));
        clients.add(second);
        await second.connect();
        await waitForCondition(() => secondUpdates.length >= 1, 'isolated second counter update', 2500);
        expect(secondUpdates[0].value).toBe('0');
        expect(server.manager.active.size).toBe(2);

        const firstSession = server.manager.active.get(firstPage.config.pageId);
        await closeLiveClient(first);
        clients.delete(first);
        await waitForCondition(() => firstSession.socket === null, 'counter disconnect cleanup');
        expect(firstSession.page.ticker).toBeNull();
    });

    test('the component chatroom joins once, tracks presence, broadcasts safely, and reconnects', async () => {
        const server = await start(createChatroomServer);
        const firstPage = await getPage(server);
        const secondPage = await getPage(server);
        expect(firstPage.response.body).toContain('Join the chatroom');
        expect(firstPage.response.body).toMatch(/<form[^>]*rw-submit="join"[^>]*data-rw-component="chat"/);
        expect(firstPage.response.body).not.toContain('rw-submit="send"');

        const firstUpdates = [];
        const secondUpdates = [];
        const latest = updates => updates.at(-1);
        const feedback = (updates, text) => waitForCondition(() => latest(updates)?.html.includes(text), text);
        const first = liveClient(firstPage.port, firstPage.config);
        const second = liveClient(secondPage.port, secondPage.config);
        first.on('redweb:patch', message => firstUpdates.push(...message.payload.patches));
        second.on('redweb:patch', message => secondUpdates.push(...message.payload.patches));
        clients.add(first);
        clients.add(second);
        await Promise.all([first.connect(), second.connect()]);
        await waitForCondition(() => firstUpdates.length === 1 && secondUpdates.length === 1, 'initial chat snapshots');
        expect(latest(firstUpdates)).toMatchObject({ id: 'root' });
        expect(latest(firstUpdates).html).toMatch(/<form[^>]*rw-submit="join"[^>]*data-rw-component="chat"/);
        firstUpdates.length = 0;
        secondUpdates.length = 0;

        expect(await first.request('redweb:html', {
            kind: 'action', component: 'chat', name: 'send', args: [{ message: 'too early' }],
        })).toMatchObject({ payload: false });
        expect(await first.request('redweb:html', {
            kind: 'action', component: 'chat', name: 'join', args: [{ name: '   ' }],
        })).toMatchObject({ payload: false });
        await feedback(firstUpdates, 'Choose a visible display name');
        expect(firstUpdates.at(-1).html).toContain('Choose a visible display name');
        await first.request('redweb:html', {
            kind: 'action', component: 'chat', name: 'join', args: [{ name: '<Admin>' }],
        });
        await second.request('redweb:html', {
            kind: 'action', component: 'chat', name: 'join', args: [{ name: 'Ada' }],
        });
        await waitForCondition(
            () => latest(firstUpdates)?.html.includes('Online · 2') &&
                latest(secondUpdates)?.html.includes('Online · 2'),
            'two joined chat participants'
        );
        expect(latest(firstUpdates).html).toContain('&lt;Admin&gt;');
        expect(latest(firstUpdates).html).toContain('Ada');
        expect(latest(firstUpdates).html).toMatch(/<form[^>]*rw-submit="send"[^>]*data-rw-component="chat"/);
        firstUpdates.length = 0;
        secondUpdates.length = 0;

        await first.request('redweb:html', {
            kind: 'action', component: 'chat', name: 'send',
            args: [{ message: '<script>alert(1)</script>' }],
        });
        await waitForCondition(() => firstUpdates.length === 1 && secondUpdates.length === 1, 'chat broadcast');
        for (const update of [firstUpdates[0], secondUpdates[0]]) {
            expect(update).toMatchObject({ id: 'c63686174' });
            expect(update.html).toContain('&lt;Admin&gt;');
            expect(update.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
            expect(update.html).not.toContain('<script>');
        }
        const updateCount = firstUpdates.length;
        await first.request('redweb:html', {
            kind: 'action', component: 'chat', name: 'send', args: [{ message: '   ' }],
        });
        expect(firstUpdates).toHaveLength(updateCount);

        await closeLiveClient(second);
        clients.delete(second);
        await waitForCondition(
            () => server.manager.active.get(secondPage.config.pageId)?.socket === null,
            'chat disconnect before reconnect'
        );
        await waitForCondition(() => latest(firstUpdates)?.html.includes('Online · 1'), 'presence after disconnect');
        first.send('redweb:html', {
            kind: 'action', component: 'chat', name: 'send', args: [{ message: 'Missed' }],
        });
        await waitForCondition(() => latest(firstUpdates)?.html.includes('Missed'), 'message while peer disconnected');
        const reconnected = liveClient(secondPage.port, secondPage.config);
        const reconnectUpdates = [];
        reconnected.on('redweb:patch', message => reconnectUpdates.push(...message.payload.patches));
        clients.add(reconnected);
        await reconnected.connect();
        await waitForCondition(() => latest(reconnectUpdates)?.html.includes('Missed'), 'authoritative reconnect snapshot');
        const reconnectedMessages = latest(reconnectUpdates).html;
        expect(reconnectedMessages.indexOf('alert(1)')).toBeLessThan(reconnectedMessages.indexOf('Missed'));
        await waitForCondition(() => latest(reconnectUpdates)?.html.includes('Online · 2'), 'reconnected presence');

        await reconnected.request('redweb:html', {
            kind: 'action', component: 'chat', name: 'leave', args: [],
        });
        await waitForCondition(() => reconnectUpdates.at(-1)?.html.includes('Join the chatroom'), 'leave screen');
        expect(await reconnected.request('redweb:html', {
            kind: 'action', component: 'chat', name: 'send', args: [{ message: 'after leave' }],
        })).toMatchObject({ payload: false });

        expect(await first.request('redweb:html', {
            kind: 'action', component: 'chat', name: 'join', args: [{ name: 'Again' }],
        })).toMatchObject({ payload: false });

        const invalidPage = await getPage(server);
        const invalid = liveClient(invalidPage.port, invalidPage.config);
        const invalidUpdates = [];
        invalid.on('redweb:patch', message => invalidUpdates.push(...message.payload.patches));
        clients.add(invalid);
        await invalid.connect();
        expect(await invalid.request('redweb:html', {
            kind: 'action', component: 'chat', name: 'join', args: [{ name: ['array'] }],
        })).toMatchObject({ payload: false });
        await feedback(invalidUpdates, 'Display name must be text.');
        expect(latest(invalidUpdates)?.html).toContain('Display name must be text.');
        expect(await invalid.request('redweb:html', {
            kind: 'action', component: 'chat', name: 'join', args: [{ name: 'hidden\u200bname' }],
        })).toMatchObject({ payload: false });
        await feedback(invalidUpdates, 'Choose a visible display name');
        expect(latest(invalidUpdates)?.html).toContain('Choose a visible display name');

        const duplicatePage = await getPage(server);
        const duplicate = liveClient(duplicatePage.port, duplicatePage.config);
        const duplicateUpdates = [];
        duplicate.on('redweb:patch', message => duplicateUpdates.push(...message.payload.patches));
        clients.add(duplicate);
        await duplicate.connect();
        expect(await duplicate.request('redweb:html', {
            kind: 'action', component: 'chat', name: 'join', args: [{ name: '<ADMIN>' }],
        })).toMatchObject({ payload: false });
        await feedback(duplicateUpdates, 'That display name is already in use.');
        expect(duplicateUpdates.at(-1)?.html).toContain('That display name is already in use.');

        const isolatedServer = await start(createChatroomServer);
        const isolatedPage = await getPage(isolatedServer);
        const isolatedUpdates = [];
        const isolated = liveClient(isolatedPage.port, isolatedPage.config);
        isolated.on('redweb:patch', message => isolatedUpdates.push(...message.payload.patches));
        clients.add(isolated);
        await isolated.connect();
        expect(await isolated.request('redweb:html', {
            kind: 'action', component: 'chat', name: 'join', args: [{ name: '<ADMIN>' }],
        })).toMatchObject({ payload: true });
        await waitForCondition(() => latest(isolatedUpdates)?.html.includes('Online · 1'), 'isolated room join');
        expect(latest(isolatedUpdates).html).not.toContain('alert(1)');
    });

    test('the Live HTML heartbeat removes a half-open browser from component presence', async () => {
        const server = await start(createChatroomServer, { heartbeat: { intervalMs: 20, timeoutMs: 20 } });
        const firstPage = await getPage(server);
        const secondPage = await getPage(server);
        const updates = [];
        const first = liveClient(firstPage.port, firstPage.config);
        first.on('redweb:patch', message => updates.push(...message.payload.patches));
        clients.add(first);
        await first.connect();
        await first.request('redweb:html', {
            kind: 'action', component: 'chat', name: 'join', args: [{ name: 'Observer' }],
        });

        const url = `ws://127.0.0.1:${secondPage.port}${secondPage.config.socketPath}` +
            `?pageId=${secondPage.config.pageId}&redwebVersion=${secondPage.config.version}`;
        const halfOpen = new WebSocket(url, { headers: { Origin: `http://127.0.0.1:${secondPage.port}` } });
        rawSockets.add(halfOpen);
        await waitForOpen(halfOpen);
        halfOpen.send(JSON.stringify({
            v: secondPage.config.version,
            type: 'redweb:html',
            requestId: 'join-half-open',
            payload: { kind: 'action', component: 'chat', name: 'join', args: [{ name: 'Sleeper' }] },
        }));
        await waitForCondition(
            () => updates.some(update => update.html.includes('Online · 2')),
            'half-open participant join'
        );

        halfOpen._socket.pause();
        await waitForCondition(
            () => updates.at(-1)?.html.includes('Online · 1'),
            'heartbeat-driven presence removal',
            1000
        );
        expect(server.manager.active.get(secondPage.config.pageId)?.socket).toBeNull();
        halfOpen._socket.resume();
    });

    test('the shipped card collection persists across renders and replaces its safe server-rendered items', async () => {
        const server = await start(createCardsServer);
        const page = await getPage(server);
        expect(page.response.body.match(/<article class="card">/g)).toHaveLength(2);
        expect(page.response.body).toContain('data-rw-state="cards" data-rw-html');

        const updates = [];
        const client = liveClient(page.port, page.config);
        client.on('redweb:state', message => updates.push(message.payload));
        clients.add(client);
        await client.connect();
        await waitForCondition(() => updates.length === 1, 'initial card collection');
        expect(updates[0].value.match(/<article class="card">/g)).toHaveLength(2);

        client.send('redweb:html', { kind: 'action', name: 'add', args: [] });
        await waitForCondition(() => updates.length === 2, 'updated card collection');
        expect(updates[1].html).toBe(true);
        expect(updates[1].value.match(/<article class="card">/g)).toHaveLength(3);
        expect(updates[1].value).toContain('Card 3');

        const refreshed = await getPage(server);
        expect(refreshed.response.body.match(/<article class="card">/g)).toHaveLength(3);
        expect(refreshed.response.body).toContain('Card 3');

        const refreshedUpdates = [];
        const refreshedClient = liveClient(refreshed.port, refreshed.config);
        refreshedClient.on('redweb:state', message => refreshedUpdates.push(message.payload));
        clients.add(refreshedClient);
        await refreshedClient.connect();
        await waitForCondition(() => refreshedUpdates.length === 1, 'persisted card collection snapshot');
        expect(refreshedUpdates[0].value.match(/<article class="card">/g)).toHaveLength(3);
        expect(refreshedUpdates[0].value).toContain('Card 3');
    });

    test('reusable components isolate server state and route actions to the owning instance', async () => {
        const server = await start(createComponentsServer);
        const page = await getPage(server);
        expect(page.response.body.match(/data-rw-component="primary"/g)).toHaveLength(2);
        expect(page.response.body.match(/data-rw-component="secondary"/g)).toHaveLength(2);
        expect(page.response.body).toContain('data-rw-state="count" data-rw-component="primary">0</output>');
        expect(page.response.body).toContain('data-rw-state="count" data-rw-component="secondary">0</output>');

        const updates = [];
        const client = liveClient(page.port, page.config);
        client.on('redweb:state', message => updates.push(message.payload));
        clients.add(client);
        await client.connect();
        await waitForCondition(() => updates.length === 2, 'component state snapshots');
        expect(updates).toEqual([
            { component: 'primary', name: 'count', value: '0', html: false },
            { component: 'secondary', name: 'count', value: '0', html: false },
        ]);

        await client.request('redweb:html', { kind: 'action', component: 'primary', name: 'increment', args: [] });
        await waitForCondition(() => updates.length === 3, 'component action state update');
        expect(updates[2]).toEqual({ component: 'primary', name: 'count', value: '1', html: false });
        const session = server.manager.active.get(page.config.pageId);
        expect(session.page.primary.count).toBe(1);
        expect(session.page.secondary.count).toBe(0);
    });

    test('keeps shared component render contexts isolated across concurrent requests', async () => {
        let firstStarted;
        let releaseFirst;
        const started = new Promise(resolve => { firstStarted = resolve; });
        const release = new Promise(resolve => { releaseFirst = resolve; });
        class RequestComponent {
            async loading({ query }) {
                if (query.id === 'a') {
                    firstStarted();
                    await release;
                }
            }
            render({ query }) { return html`<p>${String(query.id)}</p>`; }
        }
        component()(RequestComponent);
        class SharedComponentPage {
            request = new RequestComponent();
            render() { return html`${this.request}`; }
        }
        page('/shared-component-context', { shared: true })(SharedComponentPage);
        const server = await start(options => startPages(SharedComponentPage, options));
        const port = server.server.address().port;
        const first = request({ port, path: '/shared-component-context?id=a' });
        await started;
        const second = await request({ port, path: '/shared-component-context?id=b' });
        releaseFirst();
        const firstResult = await first;
        expect(firstResult.body).toContain('<p>a</p>');
        expect(firstResult.body).not.toContain('<p>b</p>');
        expect(second.body).toContain('<p>b</p>');
        expect(second.body).not.toContain('<p>a</p>');
    });

    test('renders an owned component returned directly by a page', async () => {
        class DirectComponent {
            render() { return html`<main>Direct component</main>`; }
        }
        component()(DirectComponent);
        class DirectComponentPage {
            content = new DirectComponent();
            render() { return this.content; }
        }
        page('/direct-component')(DirectComponentPage);
        const server = await start(options => startPages(DirectComponentPage, options));
        const response = await request({ port: server.server.address().port, path: '/direct-component' });
        expect(response.status).toBe(200);
        expect(response.body).toContain('<main>Direct component</main>');
        expect(response.body).not.toContain('[object Object]');
    });

    test('rejects a real reconnect until delayed disconnect lifecycle work finishes', async () => {
        let beginDisconnect;
        let finishDisconnect;
        const disconnectStarted = new Promise(resolve => { beginDisconnect = resolve; });
        const disconnectReleased = new Promise(resolve => { finishDisconnect = resolve; });
        const lifecycle = [];
        class DelayedReconnectPage {
            connected() { lifecycle.push('connected'); }
            async disconnected() {
                lifecycle.push('disconnect:start');
                beginDisconnect();
                await disconnectReleased;
                lifecycle.push('disconnect:end');
            }
            render() { return html`<main>Reconnect lifecycle</main>`; }
        }
        page('/delayed-reconnect')(DelayedReconnectPage);
        const server = await start(options => startPages(DelayedReconnectPage, options));
        const port = server.server.address().port;
        const response = await request({ port, path: '/delayed-reconnect' });
        const config = pageConfig(response.body);
        const first = liveClient(port, config);
        clients.add(first);
        await first.connect();
        await closeLiveClient(first);
        clients.delete(first);
        await disconnectStarted;

        const session = server.manager.active.get(config.pageId);
        expect(session.detaching).toBeInstanceOf(Promise);
        const url = `ws://127.0.0.1:${port}${config.socketPath}?pageId=${config.pageId}&redwebVersion=${config.version}`;
        expect(await websocketUpgradeStatus(url, {
            headers: { Origin: `http://127.0.0.1:${port}` },
        })).toBe(401);
        expect(lifecycle).toEqual(['connected', 'disconnect:start']);

        finishDisconnect();
        await waitForCondition(() => session.detaching === null, 'disconnect lifecycle completion');
        const second = liveClient(port, config);
        clients.add(second);
        await second.connect();
        expect(lifecycle).toEqual(['connected', 'disconnect:start', 'disconnect:end', 'connected']);
    });

    test('serves non-live documentation with metadata, ETags, and no browser runtime', async () => {
        const server = await start(createStaticReferenceServer);
        const port = server.server.address().port;
        const first = await request({ port, path: '/reference' });
        expect(first.status).toBe(200);
        expect(first.body).toContain('<title>Redweb Reference</title>');
        expect(first.body).toContain('<meta name="description" content="Static API documentation">');
        expect(first.body).not.toContain('__redweb_page');
        expect(first.headers['cache-control']).toBe('public, max-age=60, stale-while-revalidate=30, immutable');
        expect(first.headers.etag).toMatch(/^"[A-Za-z0-9_-]+"$/);

        const cached = await request({ port, path: '/reference', headers: { 'If-None-Match': first.headers.etag } });
        expect(cached.status).toBe(304);
        expect(cached.body).toBe('');
        expect((await request({ port, path: '/reference', headers: { 'If-None-Match': `W/${first.headers.etag}` } })).status)
            .toBe(304);
        expect((await request({ port, path: '/reference', headers: { 'If-None-Match': '*' } })).status).toBe(304);
        expect((await request({
            port,
            path: '/reference',
            method: 'HEAD',
            headers: { 'If-None-Match': `"other", W/${first.headers.etag}` },
        })).status).toBe(304);
        const defaultCache = await request({ port, path: '/default-reference' });
        expect(defaultCache.headers['cache-control']).toBe('public, max-age=0, must-revalidate');
        const mutableCache = await request({ port, path: '/mutable-reference' });
        expect(mutableCache.headers['cache-control']).toBe('public, max-age=60');
        expect((await request({ port, path: '/__redweb/runtime.js' })).status).toBe(404);
    });

    test('never publicly caches authenticated non-live output for different principals', async () => {
        const server = await start(createAuthenticatedStaticServer, {
            authenticate: request => request.headers['x-user'],
        });
        const port = server.server.address().port;
        const first = await request({ port, path: '/private-reference', headers: { 'X-User': 'Ada' } });
        const second = await request({ port, path: '/private-reference', headers: { 'X-User': 'Grace' } });
        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(first.body).toContain('<p>Ada</p>');
        expect(second.body).toContain('<p>Grace</p>');
        expect(first.headers['cache-control']).toBe('private, no-store');
        expect(second.headers['cache-control']).toBe('private, no-store');
    });

    test('serves composed HTML fragments without reparsing documentation braces', async () => {
        const server = await start(createLiteralFragmentServer);
        const response = await request({ port: server.server.address().port, path: '/literal-fragment' });
        expect(response.status).toBe(200);
        expect(response.body).toContain('<p>{{ secret }}</p>');
        expect(response.body).toContain('{{ missing }}');
        expect(response.body).not.toContain('must not bind');
    });

    test('serves non-live documentation while the live session registry is full', async () => {
        class CapacityLivePage { render() { return '<p>live</p>'; } }
        class CapacityDocsPage { render() { return '<p>docs available</p>'; } }
        page('/capacity-live')(CapacityLivePage);
        page('/capacity-docs', { live: false })(CapacityDocsPage);
        const server = await start(options => new LiveHtmlServer({
            pages: [CapacityLivePage, CapacityDocsPage],
            maxSessions: 1,
            ...options,
        }));
        const port = server.server.address().port;
        expect((await request({ port, path: '/capacity-live' })).status).toBe(200);
        expect(server.manager.pending.size).toBe(1);
        const docs = await request({ port, path: '/capacity-docs' });
        expect(docs.status).toBe(200);
        expect(docs.body).toContain('docs available');
    });

    test('real socket admission rejects foreign origins and unexposed members', async () => {
        const server = await start(createChatroomServer);
        const { port, config } = await getPage(server);
        const url = `ws://127.0.0.1:${port}${config.socketPath}?pageId=${config.pageId}&redwebVersion=${config.version}`;

        const status = await websocketUpgradeStatus(url, {
            headers: { Origin: 'https://foreign.example' },
        });
        expect(status).toBe(403);

        const socket = new WebSocket(url, { headers: { Origin: `http://127.0.0.1:${port}` } });
        rawSockets.add(socket);
        await waitForOpen(socket);
        socket.send(JSON.stringify({
            v: '1',
            type: 'redweb:html',
            payload: { kind: 'action', name: 'dispose', args: [] },
            requestId: 'forbidden-action',
        }));
        const snapshots = [];
        let rejected;
        while (!rejected && snapshots.length < 4) {
            const message = await nextJson(socket);
            if (message.type === 'error') rejected = message;
            else snapshots.push(message);
        }
        expect(snapshots.every(message => message.type === 'redweb:patch' && message.payload.patches.every(patch => patch.id === 'root'))).toBe(true);
        expect(rejected.type).toBe('error');
        expect(rejected.error.code).toBe('HANDLER_FAILED');
        expect(rejected.requestId).toBe('forbidden-action');
    });

    test('serves the complete Live HTML flow over real HTTPS and WSS', async () => {
        const server = await start(createCounterServer, {
            ssl: {
                key: path.join(__dirname, '..', 'fixtures', 'localhost.key'),
                cert: path.join(__dirname, '..', 'fixtures', 'localhost.crt'),
            },
        });
        const port = server.server.address().port;
        const response = await request({ protocol: 'https:', port, path: '/' });
        const config = pageConfig(response.body);
        expect(response.status).toBe(200);
        const updates = [];
        const client = new RedwebClient(`wss://127.0.0.1:${port}${config.socketPath}?pageId=${config.pageId}`, {
            version: config.version,
            webSocketFactory: url => new WebSocket(url, {
                rejectUnauthorized: false,
                headers: { Origin: `https://127.0.0.1:${port}` },
            }),
        });
        clients.add(client);
        client.on('redweb:state', message => updates.push(message.payload));
        await client.connect();
        await waitForCondition(() => updates.some(update => update.value === '1'), 'secure counter update', 2500);
        expect(server.server.constructor.name).toBe('Server');

        const secondResponse = await request({ protocol: 'https:', port, path: '/' });
        const secondConfig = pageConfig(secondResponse.body);
        const rejectedStatus = await websocketUpgradeStatus(
            `wss://127.0.0.1:${port}${secondConfig.socketPath}?pageId=${secondConfig.pageId}&redwebVersion=${secondConfig.version}`,
            {
                rejectUnauthorized: false,
                headers: { Origin: `http://127.0.0.1:${port}` },
            }
        );
        expect(rejectedStatus).toBe(403);
    });

    test('binds a page token to the same authenticated HTTP and WebSocket principal', async () => {
        const server = await start(createCounterServer, {
            authenticate: requestValue => requestValue.headers.authorization || false,
        });
        const port = server.server.address().port;
        expect((await request({ port, path: '/' })).status).toBe(401);
        const response = await request({ port, path: '/', headers: { authorization: 'user-1' } });
        const config = pageConfig(response.body);
        const url = `ws://127.0.0.1:${port}${config.socketPath}?pageId=${config.pageId}&redwebVersion=${config.version}`;

        const denied = await websocketUpgradeStatus(url, {
            headers: { Origin: `http://127.0.0.1:${port}`, authorization: 'user-2' },
        });
        expect(denied).toBe(401);

        const owner = new WebSocket(url, {
            headers: { Origin: `http://127.0.0.1:${port}`, authorization: 'user-1' },
        });
        rawSockets.add(owner);
        await waitForOpen(owner);
        expect((await nextJson(owner)).type).toBe('redweb:state');
    });

    test('closes the real listener even when an asynchronous page cleanup rejects', async () => {
        class RejectingCleanupPage extends LivePage {
            render() { return '<p>cleanup</p>'; }
            async disposed() { throw new Error('cleanup rejected'); }
        }
        page('/')(RejectingCleanupPage);
        const server = await start(options => new LiveHtmlServer({ pages: [RejectingCleanupPage], ...options }));
        const port = server.server.address().port;
        expect((await request({ port, path: '/' })).status).toBe(200);
        servers.delete(server);
        await expect(server.shutdown()).rejects.toThrow('Live HTML shutdown failed');
        expect(server.server.listening).toBe(false);
    });

    test('bounds a non-cooperative disposed hook and still closes the real listener', async () => {
        class HangingCleanupPage extends LivePage {
            render() { return '<p>cleanup</p>'; }
            disposed() { return new Promise(() => {}); }
        }
        page('/')(HangingCleanupPage);
        const server = await start(options => new LiveHtmlServer({
            pages: [HangingCleanupPage],
            ...options,
            shutdownTimeoutMs: 25,
        }));
        const port = server.server.address().port;
        expect((await request({ port, path: '/' })).status).toBe(200);
        servers.delete(server);
        const began = Date.now();
        await expect(server.shutdown()).rejects.toThrow('Live HTML shutdown failed');
        expect(Date.now() - began).toBeLessThan(1000);
        expect(server.server.listening).toBe(false);
    });

    test('holds the hard session cap across concurrent slow HTTP renders', async () => {
        let loadingStarted;
        let releaseLoading;
        const started = new Promise(resolve => { loadingStarted = resolve; });
        class SlowHttpPage extends LivePage {
            loading() {
                loadingStarted();
                return new Promise(resolve => { releaseLoading = resolve; });
            }
            render() { return '<p>ready</p>'; }
        }
        page('/')(SlowHttpPage);
        const server = await start(options => new LiveHtmlServer({ pages: [SlowHttpPage], maxSessions: 1, ...options }));
        const port = server.server.address().port;
        const first = request({ port, path: '/' });
        await started;
        const rejected = await request({ port, path: '/' });
        expect(rejected.status).toBe(503);
        releaseLoading();
        expect((await first).status).toBe(200);
        expect(server.manager.pending.size).toBe(1);
    });

    test('bounds shutdown and closes the listener when an HTTP render ignores cancellation', async () => {
        let loadingStarted;
        let renderSignal;
        const started = new Promise(resolve => { loadingStarted = resolve; });
        class NonCooperativePage extends LivePage {
            loading(context) {
                renderSignal = context.signal;
                loadingStarted();
                return new Promise(() => {});
            }
            render() { return '<p>never</p>'; }
        }
        page('/')(NonCooperativePage);
        const server = await start(options => new LiveHtmlServer({
            pages: [NonCooperativePage],
            ...options,
            shutdownTimeoutMs: 25,
        }));
        const port = server.server.address().port;
        const hangingRequest = request({ port, path: '/' }).then(value => value, error => error);
        await started;
        servers.delete(server);
        const began = Date.now();
        await expect(server.shutdown()).resolves.toBeUndefined();
        expect(Date.now() - began).toBeLessThan(1000);
        expect(renderSignal.aborted).toBe(true);
        expect(server.server.listening).toBe(false);
        expect((await hangingRequest).status).toBe(500);
    });
});
