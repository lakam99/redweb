'use strict';
const WebSocket = require('ws');
const { z } = require('zod');
const { connectedClients, ClientError, LiveHtmlServer, SocketRoute, page, state, defineSocketContract } = require('../..');
const { jsx } = require('../../jsx-runtime');
const { closeWebSocket, request, silentLogger, waitForCondition, waitForListening, waitForOpen } = require('../helpers/network');
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };

describe('connected clients with real HTTP, page sockets and rooms', () => {
    const servers = [], sockets = [];
    afterEach(async () => {
        await Promise.all(sockets.splice(0).map(closeWebSocket));
        await Promise.all(servers.splice(0).map(server => server.shutdown()));
    });
    async function fixture(options = {}) {
        const revoked = new Set(), commits = [], values = new Map();
        const players = connectedClients({
            identity: context => revoked.has(context.principal) ? undefined : context.principal,
            page: () => Board,
            project: (client, room, online) => options.project ? options.project(client, room, online) :
                { value: `${room}:${values.get(room) || 0}:${online.slice().sort().join(',')}` },
            errorState: text => ({ value: text }),
            reject: error => error.message === 'domain rejection' ? 'Safe rejection' : undefined,
            ...(options.raw === false ? {} : { raw: { update: state => ({ type: 'state', payload: state }), reject: text => ({ type: 'notice', payload: { text } }) } }),
            ...options.clients,
        });
        const contract = defineSocketContract('1', {
            join: z.object({ room: z.string(), reject: z.boolean().optional() }),
            move: options.schema || z.object({ value: z.number() }),
        });
        const match = players.bind(contract);
        const Join = match.handler('join', async (client, input) => {
            await client.join(input.room, () => {
                if (input.reject) throw new ClientError('Room full');
                commits.push(input.room);
            });
        });
        const Move = match.handler('move', (client, input) => {
            if (options.move) return options.move(client, input);
            values.set(client.room, input.value);
        });
        class Route extends SocketRoute {
            constructor() { super({ path: '/match', handlers: [Join, Move], protocol: match.protocol, connections: players,
                rooms: { maxRooms: 4, maxMembersPerRoom: 4, maxRoomsPerConnection: 1, ...options.rooms },
                admission: { authenticate: req => req.headers.cookie }, allowDuplicateConnections: true, logger: silentLogger }); }
        }
        class Board {
            constructor() { this.value = ''; }
            render() { return jsx('p', { children: this.value }); }
        }
        state()(Board.prototype, 'value'); page('/', { socket: Route })(Board);
        const server = new LiveHtmlServer({ pages: [Board], socketRoutes: [Route], port: 0, bind: '127.0.0.1', logger: silentLogger,
            authenticate: req => req.headers.cookie });
        servers.push(server); await waitForListening(server.server);
        const port = server.server.address().port, origin = `http://127.0.0.1:${port}`;
        async function connect(user, raw = false) {
            let url = `${origin.replace('http:', 'ws:')}/match?redwebVersion=1`;
            if (!raw) {
                const response = await request({ port, path: '/', headers: { Cookie: user } });
                const config = JSON.parse(response.body.match(/id="__redweb_page"[^>]*>(.*?)<\/script>/s)[1]);
                url += `&pageId=${config.pageId}`;
            }
            const socket = new WebSocket(url, { headers: { Cookie: user, Origin: origin } });
            const frames = []; socket.on('message', data => frames.push(JSON.parse(data)));
            sockets.push(socket); await waitForOpen(socket);
            if (!raw) await waitForCondition(() => frames.length > 0, 'page attachment');
            let sequence = 0;
            return { socket, frames, async send(type, payload) {
                const requestId = `${user}-${++sequence}`;
                socket.send(JSON.stringify({ v: '1', type, payload, requestId }));
                await waitForCondition(() => frames.some(frame => frame.requestId === requestId), 'command reply');
                return frames.find(frame => frame.requestId === requestId);
            } };
        }
        const route = server.sockets.routes.find(route => route.path === '/match');
        return { players, route, Board, connect, revoked, commits, values };
    }
    const own = (f, user) => [...f.route.clients.values()].filter(socket => socket.context.principal === user).map(socket => f.players.get(socket));

    test('a projected object cannot change a connected page prototype', async () => {
        const malicious = JSON.parse('{"__proto__":{"isAdmin":true},"value":"safe"}');
        const f = await fixture({ project: () => malicious });
        const visitor = await f.connect('alice');
        const pageInstance = [...f.route.clients.values()][0].__redwebPageSession.page;
        await visitor.send('join', { room: 'one' });
        await f.players.refresh('one');
        expect(Object.getPrototypeOf(pageInstance)).toBe(f.Board.prototype);
        expect(pageInstance.isAdmin).toBeUndefined();
    });

    test('an error-state object cannot change a connected page prototype', async () => {
        const malicious = JSON.parse('{"__proto__":{"isAdmin":true},"value":"rejected"}');
        const f = await fixture({ move: () => { throw new ClientError('Rejected'); },
            clients: { errorState: () => malicious } });
        const visitor = await f.connect('alice');
        const pageInstance = [...f.route.clients.values()][0].__redwebPageSession.page;
        await visitor.send('join', { room: 'one' });
        await visitor.send('move', { value: 1 });
        expect(Object.getPrototypeOf(pageInstance)).toBe(f.Board.prototype);
        expect(pageInstance.isAdmin).toBeUndefined();
    });

    test('projects per-connection pages, deduplicates tabs, and automatically removes only disconnected membership', async () => {
        const f = await fixture(); const a = await f.connect('alice'), tab = await f.connect('alice'), b = await f.connect('bob');
        await a.send('join', { room: 'one' }); await tab.send('join', { room: 'one' }); await b.send('join', { room: 'one' });
        await waitForCondition(() => own(f, 'alice').every(client => client.page.value === 'one:0:alice,bob'), 'private fanout');
        expect(own(f, 'alice')[0].page).not.toBe(own(f, 'alice')[1].page);
        await closeWebSocket(a.socket);
        await waitForCondition(() => f.players.rooms.members('one').length === 2, 'first tab cleanup');
        expect(own(f, 'bob')[0].page.value).toContain('alice,bob');
        await closeWebSocket(tab.socket);
        await waitForCondition(() => own(f, 'bob')[0].page.value === 'one:0:bob', 'last tab presence');
        await b.send('move', { value: 9 });
        await waitForCondition(() => own(f, 'bob')[0].page.value === 'one:9:bob', 'automatic changed state');
    });

    test('capacity rejects before domain commit, and a rejected domain join rolls back membership', async () => {
        const f = await fixture({ rooms: { maxMembersPerRoom: 1 } }); const a = await f.connect('alice'), b = await f.connect('bob');
        expect((await a.send('join', { room: 'full', reject: true })).type).toBe('error');
        expect(f.players.rooms.members('full')).toHaveLength(0); expect(f.commits).toEqual([]);
        await a.send('join', { room: 'full' });
        expect((await b.send('join', { room: 'full' })).type).toBe('error');
        expect(f.commits).toEqual(['full']);
        await b.send('join', { room: 'other' });
        await a.send('move', { value: 3 });
        expect(own(f, 'bob')[0].page.value).toBe('other:0:bob');
    });

    test('rechecks identity after asynchronous validation, without changing the admitted player', async () => {
        const started = deferred(), release = deferred(); let called = 0;
        const f = await fixture({ schema: { '~standard': { version: 1, async validate(input) { started.resolve(); await release.promise; return { value: input }; } } },
            move: () => { called++; } });
        const a = await f.connect('alice');
        a.socket.send(JSON.stringify({ v: '1', type: 'move', payload: { value: 1 }, requestId: 'stale' }));
        await started.promise; f.revoked.add('alice'); release.resolve();
        await waitForCondition(() => a.frames.some(frame => frame.requestId === 'stale'), 'revoked command');
        expect(called).toBe(0);
    });

    test('late projections cannot overwrite newer updates or publish after identity revocation', async () => {
        let pause = false; const started = deferred(), release = deferred();
        const f = await fixture({ project: async client => {
            if (pause) { pause = false; started.resolve(); await release.promise; return { value: 'obsolete' }; }
            return { value: 'current' };
        } });
        const a = await f.connect('alice'); await a.send('join', { room: 'one' });
        pause = true; const old = f.players.refresh('one'); await started.promise;
        await f.players.refresh('one'); release.resolve(); await old;
        expect(own(f, 'alice')[0].page.value).toBe('current');
        f.revoked.add('alice'); await f.players.refresh('one');
        expect(f.players.rooms.members('one')).toHaveLength(0);
    });

    test('a failed recipient cannot reject a committed sender move', async () => {
        let fail = false;
        const f = await fixture({ project: client => {
            if (fail && client.identity === 'bob') throw new Error('private failure');
            return { value: 'updated' };
        } });
        const a = await f.connect('alice'), b = await f.connect('bob');
        await a.send('join', { room: 'one' }); await b.send('join', { room: 'one' });
        fail = true; expect((await a.send('move', { value: 8 })).type).toBe('redweb:result');
        expect(f.values.get('one')).toBe(8);
        await waitForCondition(() => b.socket.readyState === WebSocket.CLOSED, 'failed recipient closed');
        expect(f.players.rooms.members('one')).toHaveLength(1);
    });

    test('raw adapters keep typed state and safe correlated rejections, while page-only groups deny raw work', async () => {
        const f = await fixture(); const a = await f.connect('alice', true);
        expect((await a.send('move', { value: 1 })).type).toBe('error');
        expect((await a.send('join', { room: 'raw' })).type).toBe('redweb:result');
        expect((await a.send('move', { value: 3 })).type).toBe('redweb:result');
        expect(a.frames.filter(frame => frame.type === 'state').at(-1).payload.value).toBe('raw:3:alice');
        const onlyPages = await fixture({ raw: false }); const b = await onlyPages.connect('bob', true);
        expect((await b.send('join', { room: 'denied' })).type).toBe('error');
        expect(onlyPages.commits).toHaveLength(0);
    });

    test.each(['projection', 'authorization'])('obsolete %s failures cannot disconnect a healthy newer generation', async mode => {
        const started = deferred(), release = deferred(); let pause = false;
        const failLater = async () => { if (pause) { pause = false; started.resolve(); await release.promise; throw new Error('old failure'); } };
        const f = await fixture({
            project: async () => { if (mode === 'projection') await failLater(); return { value: 'newer' }; },
            clients: { identity: async context => { if (mode === 'authorization') await failLater(); return context.principal; } },
        });
        const a = await f.connect('alice'); await a.send('join', { room: 'one' });
        pause = true; const old = f.players.refresh('one'); await started.promise;
        await f.players.refresh('one'); release.resolve(); await old;
        expect(a.socket.readyState).toBe(WebSocket.OPEN);
        expect(own(f, 'alice')[0].page.value).toBe('newer');
        expect(f.players.rooms.members('one')).toHaveLength(1);
    });

    test('overlapping raw commands both complete even when one projection is superseded', async () => {
        const started = deferred(), release = deferred(); let pause = false;
        const f = await fixture({ project: async client => {
            if (pause && client.identity === 'alice') { pause = false; started.resolve(); await release.promise; }
            return { value: 'state' };
        } });
        const a = await f.connect('alice', true), b = await f.connect('bob', true);
        await a.send('join', { room: 'one' }); await b.send('join', { room: 'one' });
        pause = true; const first = a.send('move', { value: 1 }); await started.promise;
        expect((await b.send('move', { value: 2 })).type).toBe('redweb:result');
        release.resolve(); expect((await first).type).toBe('redweb:result');
        expect(f.values.get('one')).toBe(2);
    });

    test('disconnect cancels a pending raw rejection adapter without waiting for it to settle', async () => {
        const started = deferred();
        const f = await fixture({ move: () => { throw new ClientError('Rejected'); }, clients: { raw: {
            update: state => ({ type: 'state', payload: state }),
            reject: () => { started.resolve(); return new Promise(() => {}); },
        } } });
        const a = await f.connect('alice', true);
        a.socket.send(JSON.stringify({ v: '1', type: 'move', payload: { value: 1 }, requestId: 'pending' }));
        await started.promise; await closeWebSocket(a.socket);
        await waitForCondition(() => f.route.inFlight.size === 0, 'cancelled handler work');
    });
});
