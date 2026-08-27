const WebSocket = require('ws');
const path = require('path');
const { RedwebClient } = require('redweb-client');
const { LiveHtmlServer, LivePage, page } = require('../..');
const { createCounterServer } = require('../../examples/live-html/counter');
const { createChatroomServer } = require('../../examples/live-html/chatroom');
const {
    closeWebSocket,
    nextMessage,
    request,
    silentLogger,
    waitForCondition,
    waitForListening,
    waitForOpen,
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

    async function connectClient(port, config) {
        const client = liveClient(port, config);
        clients.add(client);
        await client.connect();
        return client;
    }

    test('the shipped counter SSRs and emits isolated server-owned increments over the official client', async () => {
        const server = await start(createCounterServer);
        const firstPage = await getPage(server);
        expect(firstPage.response.body).toContain('Server-side counter');
        expect(firstPage.response.body).toContain('data-rw-state="count">0</output>');

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

    test('the shipped chatroom broadcasts escaped ordered HTML and supports reconnect', async () => {
        const server = await start(createChatroomServer);
        const firstPage = await getPage(server);
        const secondPage = await getPage(server);
        expect(firstPage.response.body).toContain('Chatroom');
        expect(firstPage.response.body).toContain('rw-submit="send"');

        const firstUpdates = [];
        const secondUpdates = [];
        const first = liveClient(firstPage.port, firstPage.config);
        const second = liveClient(secondPage.port, secondPage.config);
        first.on('redweb:state', message => firstUpdates.push(message.payload));
        second.on('redweb:state', message => secondUpdates.push(message.payload));
        clients.add(first);
        clients.add(second);
        await Promise.all([first.connect(), second.connect()]);
        await waitForCondition(() => firstUpdates.length === 1 && secondUpdates.length === 1, 'initial chat snapshots');
        firstUpdates.length = 0;
        secondUpdates.length = 0;

        first.send('redweb:html', {
            kind: 'action',
            name: 'send',
            args: [{ name: '<Admin>', message: '<script>alert(1)</script>' }],
        });
        await waitForCondition(() => firstUpdates.length === 1 && secondUpdates.length === 1, 'chat broadcast');
        expect(firstUpdates[0]).toEqual(secondUpdates[0]);
        expect(firstUpdates[0].html).toBe(true);
        expect(firstUpdates[0].value).toContain('&lt;Admin&gt;');
        expect(firstUpdates[0].value).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(firstUpdates[0].value).not.toContain('<script>');

        await closeLiveClient(second);
        clients.delete(second);
        await waitForCondition(
            () => server.manager.active.get(secondPage.config.pageId)?.socket === null,
            'chat disconnect before reconnect'
        );
        first.send('redweb:html', { kind: 'action', name: 'send', args: [{ name: 'Ada', message: 'Missed' }] });
        await waitForCondition(() => firstUpdates.at(-1)?.value.includes('Missed'), 'message while peer disconnected');
        const reconnected = liveClient(secondPage.port, secondPage.config);
        const reconnectUpdates = [];
        reconnected.on('redweb:state', message => reconnectUpdates.push(message.payload));
        clients.add(reconnected);
        await reconnected.connect();
        await waitForCondition(() => reconnectUpdates.length === 1, 'authoritative reconnect snapshot');
        expect(reconnectUpdates[0].value).toContain('Missed');
        expect(reconnectUpdates[0].value.indexOf('alert(1)')).toBeLessThan(reconnectUpdates[0].value.indexOf('Missed'));
    });

    test('real socket admission rejects foreign origins and unexposed members', async () => {
        const server = await start(createChatroomServer);
        const { port, config } = await getPage(server);
        const url = `ws://127.0.0.1:${port}${config.socketPath}?pageId=${config.pageId}&redwebVersion=${config.version}`;

        const foreign = new WebSocket(url, { headers: { Origin: 'https://foreign.example' } });
        rawSockets.add(foreign);
        foreign.on('error', () => {});
        const status = await new Promise(resolve => {
            foreign.once('unexpected-response', (upgradeRequest, response) => {
                upgradeRequest.on('error', () => {});
                response.on('error', () => {});
                response.resume();
                resolve(response.statusCode);
            });
        });
        expect(status).toBe(401);

        const socket = new WebSocket(url, { headers: { Origin: `http://127.0.0.1:${port}` } });
        rawSockets.add(socket);
        await waitForOpen(socket);
        socket.send(JSON.stringify({
            v: '1',
            type: 'redweb:html',
            payload: { kind: 'action', name: 'dispose', args: [] },
            requestId: 'forbidden-action',
        }));
        let rejected = await nextJson(socket);
        if (rejected.type === 'redweb:state') rejected = await nextJson(socket);
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
        const insecureOrigin = new WebSocket(
            `wss://127.0.0.1:${port}${secondConfig.socketPath}?pageId=${secondConfig.pageId}&redwebVersion=${secondConfig.version}`,
            { rejectUnauthorized: false, headers: { Origin: `http://127.0.0.1:${port}` } }
        );
        rawSockets.add(insecureOrigin);
        insecureOrigin.on('error', () => {});
        const rejectedStatus = await new Promise(resolve => insecureOrigin.once('unexpected-response', (upgradeRequest, rejectedResponse) => {
            upgradeRequest.on('error', () => {});
            rejectedResponse.on('error', () => {});
            rejectedResponse.resume();
            resolve(rejectedResponse.statusCode);
        }));
        expect(rejectedStatus).toBe(401);
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

        const stolen = new WebSocket(url, {
            headers: { Origin: `http://127.0.0.1:${port}`, authorization: 'user-2' },
        });
        rawSockets.add(stolen);
        stolen.on('error', () => {});
        const denied = await new Promise(resolve => stolen.once('unexpected-response', (upgradeRequest, deniedResponse) => {
            upgradeRequest.on('error', () => {});
            deniedResponse.on('error', () => {});
            deniedResponse.resume();
            resolve(deniedResponse.statusCode);
        }));
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
        await expect(server.shutdown()).rejects.toThrow('Live HTML shutdown failed');
        expect(Date.now() - began).toBeLessThan(1000);
        expect(renderSignal.aborted).toBe(true);
        expect(server.server.listening).toBe(false);
        expect(await hangingRequest).toHaveProperty('message');
    });
});
