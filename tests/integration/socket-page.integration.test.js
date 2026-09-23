'use strict';
const WebSocket = require('ws');
const { z } = require('zod');
const { LiveHtmlServer, SocketRoute, page, state, defineSocketContract } = require('../..');
const { jsx } = require('../../jsx-runtime');
const { closeWebSocket, request, silentLogger, waitForCondition, waitForListening, waitForOpen, websocketUpgradeStatus } = require('../helpers/network');

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
describe('typed socket page actions over actual HTTP and WebSockets', () => {
    const servers = [], sockets = [];
    afterEach(async () => {
        await Promise.all(sockets.splice(0).map(closeWebSocket));
        await Promise.all(servers.splice(0).map(server => server.shutdown()));
    });
    async function fixture(options = {}) {
        let permitted = true, called = 0, serverSocket;
        const contract = defineSocketContract('1', { move: options.schema || z.object({ cell: z.number().int() }).strict() });
        const Move = contract.handler('move', (socket, { cell }) => {
            if (options.command) return options.command(socket, cell);
            called++; serverSocket = socket;
            if (socket.page) socket.page(Board).value = cell;
            else socket.sendEvent('raw', cell);
        });
        class Match extends SocketRoute {
            constructor() { super({ path: '/match', handlers: [Move], protocol: contract.protocol, logger: silentLogger, allowDuplicateConnections: true,
                admission: { authenticate: req => req.headers.cookie === 'deny' ? false : req.headers.cookie || true }, ...options.route }); }
            connectionOpenCallback(socket) { return options.open?.(socket); }
        }
        class Other extends SocketRoute {
            constructor() { super({ path: '/other', handlers: [Move], protocol: contract.protocol, logger: silentLogger, allowDuplicateConnections: true }); }
        }
        class Board {
            constructor() { this.value = 0; }
            connected() { return options.connected?.(); }
            render() { return options.render ? options.render() : jsx('button', { 'rw-click': Move.with({ cell: this.value + 1 }), children: this.value }); }
        }
        state()(Board.prototype, 'value');
        page('/', { socket: Match, authorize: options.authorize || (() => permitted) })(Board);
        class OtherPage { render() { return jsx('p', { children: 'other' }); } }
        page('/other-page', { socket: Other })(OtherPage);
        class Raw extends SocketRoute { constructor() { super({ path: '/raw', handlers: [Move], logger: silentLogger }); } }
        const server = new LiveHtmlServer({ pages: [Board, OtherPage], socketRoutes: options.registered === false ? [Other] : [Match, Other, Raw], port: 0, bind: '127.0.0.1', logger: options.logger || silentLogger,
            authenticate: req => req.headers.cookie || true });
        servers.push(server); await waitForListening(server.server);
        const port = server.server.address().port, origin = `http://127.0.0.1:${port}`;
        async function get(path = '/', cookie = 'alice') {
            const response = await request({ port, path, headers: { Cookie: cookie } });
            expect(response.status).toBe(200);
            const config = JSON.parse(response.body.match(/<script[^>]*id="__redweb_page"[^>]*>(.*?)<\/script>/s)[1]);
            return { config, html: response.body, url: `${origin.replace('http:', 'ws:')}${config.socketPath}?pageId=${config.pageId}&redwebVersion=1` };
        }
        async function connect(url, cookie = 'alice') {
            const socket = new WebSocket(url, { headers: { Cookie: cookie, Origin: origin } });
            const frames = []; socket.on('message', data => frames.push(JSON.parse(data)));
            sockets.push(socket); await waitForOpen(socket);
            return { socket, frames };
        }
        return { server, Board, Move, get, connect, origin, get called() { return called; }, get socket() { return serverSocket; }, deny() { permitted = false; } };
    }

    test('renders typed bindings, updates a private page, correlates completion, and resumes it without replay', async () => {
        const f = await fixture(); const doc = await f.get();
        expect(doc.config.socketPath).toBe('/match'); expect(doc.html).toContain('data-rw-command=');
        const a = await f.connect(doc.url);
        await waitForCondition(() => a.frames.length, 'initial snapshot');
        a.socket.send(JSON.stringify({ v: '1', type: 'move', payload: { cell: 4 }, requestId: 'once' }));
        await waitForCondition(() => a.frames.some(frame => frame.type === 'redweb:result'), 'command result');
        await waitForCondition(() => a.frames.some(frame => frame.payload?.patches?.some(p => p.html.includes('>4</button>'))), 'rendered move');
        expect(f.called).toBe(1); expect(f.socket.page(f.Board).value).toBe(4);
        expect(() => f.socket.page(class Wrong {})).toThrow('requested page');
        const b = await f.connect((await f.get()).url);
        await waitForCondition(() => b.frames.length, 'independent page');
        expect(b.frames[0].payload.patches[0].html).toContain('>0</button>');
        await closeWebSocket(a.socket);
        await waitForCondition(() => { const s = f.server.manager.active.get(doc.config.pageId); return s && !s.socket && !s.detaching; }, 'detachment');
        expect(() => f.socket.page(f.Board)).toThrow();
        const resumed = await f.connect(doc.url);
        await waitForCondition(() => resumed.frames.length, 'resume snapshot');
        expect(resumed.frames[0].payload.patches[0].html).toContain('>4</button>'); expect(f.called).toBe(1);
    });

    test('rejects wrong route, account, origin, denied admission and duplicate page attachment', async () => {
        const f = await fixture(), doc = await f.get();
        const headers = { Cookie: 'alice', Origin: f.origin };
        for (const [url, replacement] of [[doc.url.replace('/match?', '/other?'), {}], [doc.url.replace('/match?', '/__redweb/live?'), {}],
            [doc.url, { Cookie: 'bob' }], [doc.url, { Cookie: 'deny' }], [doc.url, { Origin: 'https://evil.example' }]]) {
            expect(await websocketUpgradeStatus(url, { headers: { ...headers, ...replacement } })).not.toBe(101);
        }
        const a = await f.connect(doc.url); await waitForCondition(() => a.frames.length, 'attached');
        expect(await websocketUpgradeStatus(doc.url, { headers })).not.toBe(101);
    });

    test('commands wait for attachment and cannot execute after revocation during async validation', async () => {
        const attaching = deferred(), validation = deferred(), started = deferred();
        const f = await fixture({ connected: () => attaching.promise,
            schema: { '~standard': { version: 1, async validate(input) { started.resolve(); await validation.promise; return { value: input }; } } } });
        const a = await f.connect((await f.get()).url);
        a.socket.send(JSON.stringify({ v: '1', type: 'move', payload: { cell: 7 }, requestId: 'denied' }));
        expect(f.called).toBe(0); attaching.resolve(); await started.promise;
        f.deny(); validation.resolve();
        await waitForCondition(() => a.frames.some(frame => frame.type === 'error'), 'authorization rejection');
        expect(f.called).toBe(0);
    });

    test.each([{ type: 'redweb:html', payload: { kind: 'state', name: 'value', value: 99 } },
        { type: 'move', payload: { cell: 'bad' } }])('rejects forged input $type without updating state', async message => {
        const f = await fixture(), a = await f.connect((await f.get()).url);
        a.socket.send(JSON.stringify({ v: '1', ...message, requestId: 'bad' }));
        await waitForCondition(() => a.frames.some(frame => frame.type === 'error'), 'rejection');
        expect(f.called).toBe(0);
    });

    test('page-bound socket routes reject raw clients without a page session', async () => {
        const f = await fixture();
        expect(await websocketUpgradeStatus(`${f.origin.replace('http:', 'ws:')}/match?redwebVersion=1`,
            { headers: { Origin: f.origin, Cookie: 'alice' } })).not.toBe(101);
    });

    test('an explicit async false rejects a command without acknowledging success or closing its socket', async () => {
        const f = await fixture({ command: async (socket, cell) => {
            if (cell === 0) { socket.sendProtocolError('MOVE_REJECTED', 'Choose another square.', { requestId: 'rejected' }); return false; }
        } });
        const a = await f.connect((await f.get()).url);
        a.socket.send(JSON.stringify({ v: '1', type: 'move', payload: { cell: 0 }, requestId: 'rejected' }));
        a.socket.send(JSON.stringify({ v: '1', type: 'move', payload: { cell: 1 }, requestId: 'accepted' }));
        await waitForCondition(() => a.frames.some(frame => frame.requestId === 'accepted'), 'later successful command');
        expect(a.frames.filter(frame => frame.requestId === 'rejected').map(frame => frame.type)).toEqual(['error']);
        expect(a.frames.find(frame => frame.requestId === 'accepted').type).toBe('redweb:result');
        expect(a.socket.readyState).toBe(WebSocket.OPEN);
    });

    test('broken upgrade authorization is sanitized rather than exposing callback details', async () => {
        let broken = false;
        const f = await fixture({ authorize: () => { if (broken) throw new Error('private policy details'); return true; } });
        const doc = await f.get(); broken = true;
        expect(await websocketUpgradeStatus(doc.url, { headers: { Cookie: 'alice', Origin: f.origin } })).toBe(500);
    });

    test('unexpected command authorization failures propagate to the socket runtime', async () => {
        let broken = false;
        const f = await fixture({ authorize: () => { if (broken) throw new Error('policy unavailable'); return true; } });
        const a = await f.connect((await f.get()).url);
        await waitForCondition(() => a.frames.length, 'initial snapshot');
        broken = true;
        const route = f.server.sockets.routes.find(candidate => candidate.path === '/match');
        const socket = [...route.clients.values()][0];
        await expect(route.handleMessage(socket, { v: '1', type: 'move', payload: { cell: 1 } }))
            .rejects.toThrow('Authorization policy failed.');
    });

    test.each([{ protocol: false }, { protocol: { versions: ['2'] } }, { protocol: { versions: ['1'], queryParameter: 'version' } }])('rejects incompatible page protocol %j', async route => {
        await expect(fixture({ route })).rejects.toThrow('protocol version 1');
    });

    test('rejects reserved handlers and missing registration', async () => {
        class Reserved extends require('../../src/ws/BaseHandler').BaseHandler { constructor() { super('redweb:patch'); } }
        await expect(fixture({ route: { handlers: [Reserved] } })).rejects.toThrow('reserve');
        await expect(fixture({ registered: false })).rejects.toThrow('registered');
        await expect(fixture({ route: { allowDuplicateConnections: false } })).rejects.toThrow('allowDuplicateConnections');
    });

    test('anonymous route admission still requires page identity and binary cannot dispatch a page command', async () => {
        const f = await fixture({ route: { admission: undefined } });
        const a = await f.connect((await f.get()).url);
        await waitForCondition(() => a.frames.length, 'snapshot');
        a.socket.send(Buffer.from('binary'));
        await waitForCondition(() => a.socket.readyState === WebSocket.CLOSED, 'binary rejection');
        expect(f.called).toBe(0);
        expect(await websocketUpgradeStatus(`${f.origin.replace('http:', 'ws:')}/match?redwebVersion=1`,
            { headers: { Origin: f.origin } })).not.toBe(101);
    });

    test('denied page commands and fan-out cannot publish private updates', async () => {
        const f = await fixture(), a = await f.connect((await f.get()).url);
        a.socket.send(JSON.stringify({ v: '1', type: 'move', payload: { cell: 2 } }));
        await waitForCondition(() => f.called === 1, 'valid command');
        f.deny();
        a.socket.send(JSON.stringify({ v: '1', type: 'move', payload: { cell: 3 }, requestId: 'forbidden' }));
        await waitForCondition(() => a.frames.some(frame => frame.requestId === 'forbidden'), 'denied command');
        expect(f.called).toBe(1);
    });

    test('disconnect during attachment prevents commands and initialization hooks', async () => {
        const gate = deferred(), entered = deferred();
        const f = await fixture({ connected: () => { entered.resolve(); return gate.promise; } });
        const a = await f.connect((await f.get()).url);
        await entered.promise;
        a.socket.send(JSON.stringify({ v: '1', type: 'move', payload: { cell: 4 } }));
        await closeWebSocket(a.socket);
        await waitForCondition(() => [...f.server.manager.active.values()].every(s => !s.socket && !s.detaching), 'cancelled attachment');
        gate.resolve();
        expect(f.called).toBe(0);
    });

    test('disconnect during validation retains the authorization fence', async () => {
        const gate = deferred(), entered = deferred();
        const f = await fixture({ schema: { '~standard': { version: 1, async validate(input) {
            entered.resolve(); await gate.promise; return { value: input };
        } } } });
        const a = await f.connect((await f.get()).url);
        a.socket.send(JSON.stringify({ v: '1', type: 'move', payload: { cell: 4 } }));
        await entered.promise; await closeWebSocket(a.socket);
        await waitForCondition(() => [...f.server.manager.active.values()].every(s => !s.socket && !s.detaching), 'closed session');
        gate.resolve();
        // Completion of queued work is observed directly, not through a fixed sleep.
        const route = f.server.sockets.routes.find(route => route.path === '/match');
        await route.shutdown();
        expect(f.called).toBe(0);
    });

    test('attachment failure never runs application commands', async () => {
        const f = await fixture({ connected: () => { throw new Error('private failure'); } });
        const a = await f.connect((await f.get()).url);
        a.socket.send(JSON.stringify({ v: '1', type: 'move', payload: { cell: 4 } }));
        await waitForCondition(() => a.socket.readyState === WebSocket.CLOSED, 'failed attachment');
        expect(f.called).toBe(0);
    });

    test('page connection closed by its opening callback never initializes handlers', async () => {
        const f = await fixture({ open: async socket => { socket.close(); await require('events').once(socket, 'close'); } });
        const a = await f.connect((await f.get()).url);
        await waitForCondition(() => a.socket.readyState === WebSocket.CLOSED, 'closed opening callback');
        await f.server.shutdown();
        expect(f.called).toBe(0);
    });

    test('non-TSX attached pages fail closed without retaining a session', async () => {
        const f = await fixture({ render: () => '<p>Not reactive TSX</p>' });
        const response = await request({ port: f.server.server.address().port, headers: { Cookie: 'alice' } });
        expect(response.status).toBe(500); expect(f.server.manager.pending.size).toBe(0);
    });

    test('a cancelled publication cannot close the replacement connection', async () => {
        const entered = deferred(), gate = deferred(); let block = false;
        const f = await fixture({ authorize: async () => {
            if (block) { block = false; entered.resolve(); await gate.promise; return false; }
            return true;
        } });
        const doc = await f.get(), a = await f.connect(doc.url);
        await waitForCondition(() => a.frames.length, 'first snapshot');
        const session = f.server.manager.active.get(doc.config.pageId);
        block = true; session.page.value = 8; await entered.promise;
        await closeWebSocket(a.socket);
        await waitForCondition(() => !session.socket && !session.detaching, 'old connection release');
        const b = await f.connect(doc.url); gate.resolve();
        await waitForCondition(() => b.frames.some(frame => frame.payload?.patches?.some(p => p.html.includes('>8</button>'))), 'fresh authorized snapshot');
        expect(b.socket.readyState).toBe(WebSocket.OPEN);
    });

    test('denied background publication closes the connection even when the application logger throws', async () => {
        const logged = deferred();
        const f = await fixture({ logger: { ...silentLogger, error(error) { logged.resolve(error); throw new Error('logger unavailable'); } } });
        const doc = await f.get(), a = await f.connect(doc.url);
        await waitForCondition(() => a.frames.length, 'authorized snapshot');
        const session = f.server.manager.active.get(doc.config.pageId);
        f.deny(); session.page.value = 99;
        await logged.promise;
        await waitForCondition(() => a.socket.readyState === WebSocket.CLOSED, 'rejected publication closure');
        expect(a.frames.some(frame => frame.payload?.patches?.some(patch => patch.html.includes('>99</button>')))).toBe(false);
    });
});
