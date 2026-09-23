'use strict';
const { connectedClients, ClientError, defineSocketContract, SocketRoute } = require('../..');
const { AccessDenied } = require('../../src/access/AccessPolicy');
const RoomRegistry = require('../../src/ws/RoomRegistry');
const { z } = require('zod');
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

// Isolated boundary units; real transports and page ownership have separate integration tests.
function fixture(options = {}) {
    class Page {}
    const board = new Page(), errors = [], frames = [], closed = [];
    const defaults = { identity: context => context.principal, page: () => Page, project: () => ({ value: 1 }) };
    const players = connectedClients({ ...defaults, ...options });
    const route = { clients: new Map(), protocolPolicy: {}, draining: false,
        runtime: { run: task => Promise.resolve().then(task) },
        logger: { error: (...args) => errors.push(args) }, handleError: (_socket, error) => errors.push(error) };
    const rooms = new RoomRegistry(); players.attach(route, rooms);
    const controller = new AbortController();
    const socket = { clientKey: 'one', readyState: 1,
        context: { principal: 'alice', signal: controller.signal, protocol: { version: '1' } },
        page: () => board, close: (...args) => closed.push(args),
        sendProtocolError: (...args) => frames.push(args), sendEvent: (...args) => frames.push(args) };
    route.clients.set(socket.clientKey, socket);
    const client = players.get(socket);
    const contract = defineSocketContract('1', { go: z.object({}) });
    const invoke = callback => new (players.bind(contract).handler('go', callback))().handleMessage(socket, { v: '1', type: 'go', payload: {}, requestId: 'request' });
    return { players, route, rooms, controller, socket, client, defaults, board, errors, frames, closed, invoke };
}

test('validates deliberate public errors and client configuration before allocation', () => {
    for (const value of [undefined, null, '', 1, 'x'.repeat(513)]) expect(() => new ClientError(value)).toThrow(TypeError);
    expect(new ClientError('Safe text').message).toBe('Safe text');
    const f = fixture();
    for (const value of [null, 1]) expect(() => connectedClients(value)).toThrow(TypeError);
    for (const name of ['identity', 'page', 'project', 'reject', 'errorState']) {
        expect(() => connectedClients({ ...f.defaults, [name]: 1 })).toThrow(TypeError);
    }
    for (const raw of [null, {}, { update() {}, reject: false }]) expect(() => connectedClients({ ...f.defaults, raw })).toThrow(TypeError);
    expect(() => f.players.attach(f.route, f.rooms)).toThrow('one route');
    expect(() => connectedClients(f.defaults).attach(f.route, null)).toThrow('rooms');
    expect(() => connectedClients(f.defaults).attach({}, f.rooms)).toThrow('protocol');
    expect(() => connectedClients(f.defaults).get(f.socket)).toThrow(AccessDenied);
});

test('identity is admitted, revalidated, lifetime-checked and not changed by mutating caller options', async () => {
    for (const identity of [() => undefined, () => null, () => false, () => 'bob']) {
        const f = fixture({ identity }); await expect(f.players.check(f.socket)).rejects.toThrow(AccessDenied);
    }
    const f = fixture();
    expect(f.players.get(f.socket)).toBe(f.client); expect(f.client.identity).toBe('alice');
    f.route.draining = true; expect(() => f.client.identity).toThrow(AccessDenied); f.route.draining = false;
    f.route.clients.clear(); expect(() => f.client.identity).toThrow(AccessDenied); f.route.clients.set('one', f.socket);
    f.socket.readyState = 3; expect(() => f.client.page).toThrow(AccessDenied); f.socket.readyState = 1;
    f.controller.abort(); expect(() => f.client.identity).toThrow(AccessDenied);
    const options = { identity: context => context.principal };
    const immutable = fixture(options); options.identity = () => 'bob';
    await immutable.players.check(immutable.socket);
});

test('membership snapshots cannot change ownership and ambiguous rooms are not selected silently', async () => {
    const f = fixture(); expect(() => f.client.room).toThrow('Join');
    await f.client.join('one'); expect(f.client.room).toBe('one');
    const copy = f.client.rooms; copy.push('forged'); expect(f.client.rooms).toEqual(['one']);
    await f.client.join('two'); expect(() => f.client.room).toThrow('Join');
    expect(f.client.leave('one')).toBe(true); expect(f.client.leave('one')).toBe(false);
    await turn();
});

test('concurrent or asynchronous room commits fail and new memberships roll back, without removing existing membership', async () => {
    const pending = deferred(); const f = fixture({ identity: async context => { await pending.promise; return context.principal; } });
    await expect(f.client.join('one', 3)).rejects.toThrow('synchronous');
    const joining = f.client.join('one');
    await expect(f.client.join('two')).rejects.toThrow('pending'); pending.resolve(); await joining;
    await expect(f.client.join('one', () => { throw new ClientError('kept'); })).rejects.toThrow('kept');
    expect(f.client.rooms).toEqual(['one']);
    await expect(f.client.join('two', async () => { throw new Error('async side effect'); })).rejects.toThrow('synchronous');
    expect(f.client.rooms).toEqual(['one']); await turn();
});

test('safe error mapping is explicit; arbitrary error details and malformed rejection text are never sent', async () => {
    const f = fixture({ reject: error => error instanceof RangeError ? 'Safe domain error' : undefined, errorState: text => ({ notice: text }) });
    expect(await f.invoke(() => { throw new RangeError('private details'); })).toBe(false);
    expect(f.board.notice).toBe('Safe domain error'); expect(f.frames[0][1]).toBe('Safe domain error');
    await expect(f.invoke(() => { throw new Error('private'); })).rejects.toThrow('private');
    expect(f.frames).toHaveLength(1);
    for (const value of ['', 'x'.repeat(513), 5]) {
        const invalid = fixture({ reject: () => value });
        await expect(invalid.invoke(() => { throw new Error('secret'); })).rejects.toThrow('secret');
        expect(invalid.frames).toHaveLength(0);
    }
    const withoutState = fixture();
    expect(await withoutState.invoke(() => { throw new ClientError('Intentional'); })).toBe(false);
    expect(withoutState.frames[0][0]).toBe('COMMAND_REJECTED');
    expect(await withoutState.invoke(() => false)).toBe(false);
    expect(() => f.players.bind(defineSocketContract('1', { go: z.object({}) })).handler('go', null)).toThrow('callback');
});

test('refresh ignores obsolete work, tracks queued failures, and safely bounds unresponsive projections', async () => {
    const f = fixture(); f.players.changed('empty'); f.players.changed('empty'); await turn();
    f.route.draining = true; f.players.changed('empty'); await turn(); f.route.draining = false;
    f.route.runtime.run = () => Promise.reject(new Error('worker failed'));
    f.players.changed('one'); await turn(); expect(f.errors[0][0]).toContain('refresh failed');
    const bounded = fixture({ projectionTimeoutMs: 5, project: () => new Promise(() => {}) });
    bounded.rooms.join('one', bounded.socket);
    await bounded.players.refresh('one'); expect(bounded.closed).toEqual([[1011, 'Connection unavailable.']]);
    expect(bounded.rooms.members('one')).toEqual([]);
});

test('revocation during raw adaptation prevents sending, including rejection replies', async () => {
    const gate = deferred(); let identity = 'alice';
    const f = fixture({ identity: () => identity, raw: {
        update: async () => { await gate.promise; return { type: 'state', payload: {} }; },
        reject: async text => { identity = 'bob'; return { type: 'notice', payload: text }; },
    } });
    delete f.socket.page;
    f.rooms.join('one', f.socket);
    const projection = f.players.refresh('one'); await turn(); identity = 'bob'; gate.resolve(); await projection;
    expect(f.frames).toEqual([]); expect(f.closed[0][0]).toBe(1008);
    identity = 'alice';
    await expect(f.invoke(() => { throw new ClientError('Safe'); })).rejects.toThrow(AccessDenied);
    expect(f.frames).toEqual([]);
});

test('queued work can be replaced explicitly and membership can change during another recipient authorization', async () => {
    const pending = deferred();
    const f = fixture({ identity: async context => { if (context.principal === 'bob') await pending.promise; return context.principal; } });
    const bob = { ...f.socket, clientKey: 'bob', context: { ...f.socket.context, principal: 'bob' } };
    f.route.clients.set('bob', bob); f.rooms.join('one', f.socket); f.rooms.join('one', bob);
    f.players.changed('one'); const refreshing = f.players.refresh('one');
    await turn(); f.rooms.leave('one', f.socket); pending.resolve(); await refreshing;
    expect(f.closed).toEqual([]);
});

test('raw clients can omit presentation rejections and fire commands without request IDs', async () => {
    const f = fixture({ raw: { update: state => ({ type: 'state', payload: state }) } }); delete f.socket.page;
    expect(await f.invoke(() => { throw new ClientError('Rejected'); })).toBe(false);
    expect(f.frames[0][0]).toBe('COMMAND_REJECTED');
    const contract = defineSocketContract('1', { go: z.object({}) });
    const Handler = f.players.bind(contract).handler('go', () => {});
    await new Handler().handleMessage(f.socket, { v: '1', type: 'go', payload: {} });
    expect(f.frames).toHaveLength(1);
});

test('leaving a room while join authorization is pending prevents its domain commit', async () => {
    const release = deferred(); let checks = 0, committed = false;
    const f = fixture({ identity: async context => { if (++checks === 2) await release.promise; return context.principal; } });
    const joining = f.client.join('one', () => { committed = true; });
    await turn(); f.client.leave('one'); release.resolve();
    await expect(joining).rejects.toThrow(AccessDenied); expect(committed).toBe(false); await turn();
});

test('route integration validates ownership and enables existing rooms and drain tracking only when opted in', async () => {
    const f = fixture(); const contract = defineSocketContract('1', { go: z.object({}) });
    const Handler = contract.handler('go', () => {});
    const config = { path: '/owned', handlers: [Handler], protocol: contract.protocol, logger: null };
    expect(() => new SocketRoute({ ...config, connections: {} })).toThrow('connectedClients');
    expect(() => new SocketRoute({ ...config, connections: connectedClients(f.defaults), rooms: false })).toThrow('rooms');
    const group = connectedClients(f.defaults);
    const route = new SocketRoute({ ...config, connections: group });
    try {
        expect(route.rooms).toBeInstanceOf(RoomRegistry);
        expect(route.inFlight).toBeInstanceOf(Set);
        expect(() => new SocketRoute({ ...config, connections: group })).toThrow('one route');
    } finally { await route.shutdown(); }
});
