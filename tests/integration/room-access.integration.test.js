'use strict';

const WebSocket = require('ws');
const { SocketServer, SocketRoute, BaseHandler } = require('../..');
const { waitForListening, waitForOpen, waitForCondition, closeWebSocket, websocketUpgradeStatus } = require('../helpers/network');

describe('protected rooms over real WebSockets', () => {
    let server, peers;
    beforeEach(() => { peers = []; });
    afterEach(async () => { await Promise.all(peers.map(peer => closeWebSocket(peer))); await server?.shutdown(); });

    async function fixture(authorize, options = {}) {
        class Enter extends BaseHandler {
            constructor() { super('enter'); }
            async onMessage(socket, message) { socket.sendJson({ joined: await socket.enterRoom(message.payload.room), requestId: message.requestId }); }
        }
        class Publish extends BaseHandler {
            constructor() { super('publish'); }
            onMessage(socket, message) { socket.sendJson({ sent: socket.roomBroadcast(message.payload.room, { notice: message.payload.text }), requestId: message.requestId }); }
        }
        class Leave extends BaseHandler {
            constructor() { super('leave'); }
            onMessage(socket, message) { socket.sendJson({ left: socket.leaveRoom(message.payload.room), requestId: message.requestId }); }
        }
        class Ping extends BaseHandler {
            constructor() { super('ping'); }
            onMessage(socket) { socket.sendJson({ pong: true }); }
        }
        class BinaryEnter extends BaseHandler {
            constructor() { super('binary-enter'); }
            acceptsBinary() { return true; }
            async onBinaryMessage(socket) { await socket.enterRoom('private'); }
        }
        class Rooms extends SocketRoute {
            constructor() {
                super({ path: '/rooms', handlers: [Enter, Publish, Leave, Ping, BinaryEnter], logger: null, allowDuplicateConnections: true,
                    admission: { authenticate: request => request.headers['x-account'] }, protocol: { versions: ['1'] },
                    ...options, rooms: { authorize, ...options.rooms } });
            }
        }
        server = new SocketServer({ port: 0, bind: '127.0.0.1', routes: [Rooms], logger: null });
        await waitForListening(server.server);
        const route = server.routes[0];
        async function connect(account = 'alice') {
            const peer = new WebSocket(`ws://127.0.0.1:${server.server.address().port}/rooms?redwebVersion=1&tag=a&tag=b`, { headers: { 'x-account': account } });
            peers.push(peer); peer.messages = [];
            peer.on('message', data => peer.messages.push(JSON.parse(data.toString())));
            await waitForOpen(peer);
            await waitForCondition(() => route.clients.size > 0, 'server connection');
            return peer;
        }
        const send = (peer, type, room, requestId = type, extra = {}) => peer.send(JSON.stringify({ v: '1', type, requestId, payload: { room, ...extra } }));
        const response = async (peer, requestId) => {
            await waitForCondition(() => peer.messages.some(message => message.requestId === requestId), requestId);
            return peer.messages.find(message => message.requestId === requestId);
        };
        return { route, connect, send, response };
    }

    test('rejects unsupported middleware request data before admission and recovers for a valid upgrade', async () => {
        let admissions = 0;
        const { route, connect } = await fixture(() => true, {
            admission: { authenticate() { admissions += 1; return 'alice'; } },
        });
        const unsupportedBody = request => { request.body = new Date(); };
        server.server.prependListener('upgrade', unsupportedBody);
        expect(await websocketUpgradeStatus(`ws://127.0.0.1:${server.server.address().port}/rooms?redwebVersion=1`)).toBe(400);
        expect(admissions).toBe(0);
        expect(route.clients.size).toBe(0);
        server.server.removeListener('upgrade', unsupportedBody);
        await connect();
        expect(admissions).toBe(1);
    });

    test('idle contexts preserve original identity and materialize cancelled after real disconnect or drain', async () => {
        const { route, connect } = await fixture(() => true, {
            admission: { authenticate(request) { const account = request.headers['x-account']; request.headers['x-account'] = 'changed'; return account; } },
        });
        const peer = await connect();
        const member = [...route.clients.values()][0];
        expect(route.runtime.contexts.get(member).context).toBeNull();
        expect(route.runtime.contexts.get(member).controller).toBeNull();
        await closeWebSocket(peer);
        await waitForCondition(() => route.clients.size === 0, 'idle disconnect');
        expect(member.context.principal).toBe('alice');
        expect(member.context.request.get('x-account')).toBe('alice');
        expect(member.context.signal.aborted).toBe(true);
        expect(member.context).toBe(member.context);
        await connect('bob');
        const drained = [...route.clients.values()][0];
        expect(route.runtime.contexts.get(drained).context).toBeNull();
        await server.shutdown();
        expect(drained.context.principal).toBe('bob');
        expect(drained.context.signal.aborted).toBe(true);
    });

    test('shares immutable original request fields, guards every entry point and requires membership to publish', async () => {
        const contexts = [];
        const { route, connect, send, response } = await fixture((context, room) => {
            contexts.push(context);
            return context.principal === 'alice' && room === 'private';
        }, { admission: { authenticate(request) { const original = request.headers['x-account']; request.headers['x-account'] = 'mutated'; return original; } } });
        const alice = await connect(); const bob = await connect('bob');
        send(alice, 'enter', 'private', 'allowed');
        expect(await response(alice, 'allowed')).toMatchObject({ joined: true });
        send(bob, 'enter', 'private', 'denied');
        expect(await response(bob, 'denied')).toMatchObject({ error: { code: 'ACCESS_DENIED' } });
        expect(bob.readyState).toBe(WebSocket.OPEN);
        expect(contexts[0]).toMatchObject({ principal: 'alice', request: { path: '/rooms', query: { tag: ['a', 'b'] } } });
        expect(contexts[0].request.get('x-account')).toBe('alice');
        expect(Object.isFrozen(contexts[0].request.headers)).toBe(true);
        const member = route.rooms.members('private')[0];
        expect(() => { member.context.principal = 'bob'; }).toThrow();
        expect(() => { member.context = {}; }).toThrow();
        member.context.metadata.applicationValue = 1;
        expect(member.context.metadata.applicationValue).toBe(1);
        expect(() => member.joinRoom('other')).toThrow('enterRoom');
        expect(() => route.rooms.join('other', member)).toThrow('enterRoom');
        send(bob, 'publish', 'private', 'cannot-publish', { text: 'forged' });
        expect(await response(bob, 'cannot-publish')).toMatchObject({ sent: 0 });
        send(alice, 'publish', 'private', 'published', { text: 'private update' });
        expect(await response(alice, 'published')).toMatchObject({ sent: 1 });
        expect(alice.messages).toContainEqual({ notice: 'private update' });
        expect(bob.messages.some(message => message.notice)).toBe(false);
        route.rooms.leaveAll(member);
        expect(route.rooms.broadcast('private', { notice: 'revoked' })).toBe(0);
        expect(alice.messages.some(message => message.notice === 'revoked')).toBe(false);
    });

    test('leave cancels pending entry, and simultaneous approvals cannot overfill a room', async () => {
        const pending = [];
        const { route, connect, send, response } = await fixture(context => new Promise(resolve => pending.push({ context, resolve })), { rooms: { maxMembersPerRoom: 1 } });
        const alice = await connect(); const bob = await connect('bob');
        send(alice, 'enter', 'private', 'cancelled');
        await waitForCondition(() => pending.length === 1, 'pending permission');
        send(alice, 'leave', 'private', 'leave');
        expect(await response(alice, 'leave')).toMatchObject({ left: false });
        expect(await response(alice, 'cancelled')).toMatchObject({ error: { code: 'ACCESS_CANCELLED' } });
        expect(pending[0].context.signal.aborted).toBe(true);
        pending[0].resolve(true);
        send(alice, 'enter', 'private', 'first'); send(bob, 'enter', 'private', 'second');
        await waitForCondition(() => pending.length === 3, 'both permissions');
        pending[1].resolve(true); pending[2].resolve(true);
        const results = [await response(alice, 'first'), await response(bob, 'second')];
        expect(results.map(result => result.joined).sort()).toEqual([false, true]);
        expect(route.rooms.members('private')).toHaveLength(1);
    });

    test('timed-out work remains charged until its real policy settles, then capacity recovers', async () => {
        const pending = [];
        const { route, connect, send, response } = await fixture(context => new Promise(resolve => pending.push({ context, resolve })),
            { rooms: { authorizationTimeoutMs: 25, maxPendingAuthorizations: 1, maxPendingPerConnection: 1 } });
        const alice = await connect(); const bob = await connect('bob');
        send(alice, 'enter', 'private', 'timeout');
        expect(await response(alice, 'timeout')).toMatchObject({ error: { code: 'ACCESS_TIMEOUT' } });
        expect(pending[0].context.signal.aborted).toBe(true);
        send(bob, 'enter', 'private', 'capacity');
        expect(await response(bob, 'capacity')).toMatchObject({ error: { code: 'ACCESS_CAPACITY' } });
        expect(pending).toHaveLength(1); expect(route.rooms.size).toBe(0);
        pending[0].resolve(true);
        await waitForCondition(() => route.rooms.access.running === 0, 'policy settlement');
        send(bob, 'enter', 'private', 'recovered');
        await waitForCondition(() => pending.length === 2, 'new permission');
        pending[1].resolve(true);
        expect(await response(bob, 'recovered')).toMatchObject({ joined: true });
    });

    test('replacement, disconnect and draining invalidate permission before abort listeners can publish', async () => {
        const pending = []; const publications = [];
        const { route, connect, send, response } = await fixture(context => new Promise(resolve => {
            pending.push({ context, resolve });
            context.signal.addEventListener('abort', () => publications.push(route.rooms.broadcast('private', { notice: 'late' })), { once: true });
        }), { allowDuplicateConnections: false });
        const first = await connect(); send(first, 'enter', 'private', 'old');
        await waitForCondition(() => pending.length === 1, 'old permission');
        const replacement = await connect();
        await waitForCondition(() => pending[0].context.signal.aborted, 'replacement cancellation');
        pending[0].resolve(true);
        send(replacement, 'enter', 'private', 'new');
        await waitForCondition(() => pending.length === 2, 'replacement permission');
        pending[1].resolve(true);
        expect(await response(replacement, 'new')).toMatchObject({ joined: true });
        const member = route.rooms.members('private')[0];
        member.context.signal.addEventListener('abort', () => publications.push(route.rooms.broadcast('private', { notice: 'late' })), { once: true });
        await closeWebSocket(replacement);
        await waitForCondition(() => member.context.signal.aborted, 'disconnect signal');
        const third = await connect(); send(third, 'enter', 'private', 'drain');
        await waitForCondition(() => pending.length === 3, 'draining permission');
        route.beginDrain(); pending[2].resolve(true);
        expect(await response(third, 'drain')).toMatchObject({ error: { code: 'ACCESS_CANCELLED' } });
        expect(route.rooms.size).toBe(0); expect(publications.every(count => count === 0)).toBe(true);
    });

    test('policy bugs are sanitized and are not disguised as recoverable denials', async () => {
        const { connect, send, response } = await fixture(() => { throw new Error('database-password-secret'); }, { exposeErrors: true });
        const peer = await connect(); send(peer, 'enter', 'private', 'failure');
        const result = await response(peer, 'failure');
        expect(result).toMatchObject({ error: { code: 'HANDLER_FAILED', message: 'Authorization policy failed.' } });
        expect(JSON.stringify(result)).not.toContain('database-password-secret');
    });

    test('leaveAll removes every subscription before any authorization abort callback runs', async () => {
        let block = false, started = false, published;
        const { route, connect, send, response } = await fixture(({ signal }) => {
            if (!block) return true;
            started = true;
            return new Promise(resolve => signal.addEventListener('abort', () => {
                published = route.rooms.broadcast('second', { notice: 'revocation leak' });
                resolve(true);
            }, { once: true }));
        });
        const peer = await connect();
        send(peer, 'enter', 'first', 'first'); expect(await response(peer, 'first')).toMatchObject({ joined: true });
        send(peer, 'enter', 'second', 'second'); expect(await response(peer, 'second')).toMatchObject({ joined: true });
        block = true; send(peer, 'enter', 'first', 'pending');
        await waitForCondition(() => started, 'pending reauthorization');
        const member = route.rooms.members('first')[0];
        expect(route.rooms.leaveAll(member)).toBe(2);
        expect(await response(peer, 'pending')).toMatchObject({ error: { code: 'ACCESS_CANCELLED' } });
        expect(published).toBe(0);
        expect(peer.messages.some(message => message.notice)).toBe(false);
    });

    test('nested cancellation cannot remove the outer entry guard and resurrect membership', async () => {
        const pending = []; let member; let reentry;
        const { route, connect, send, response } = await fixture(({ signal }, room) => new Promise(resolve => {
            pending.push(room);
            signal.addEventListener('abort', () => {
                if (room === 'first') {
                    member.leaveRoom('second');
                    reentry = member.enterRoom('first').catch(error => error.code);
                }
                resolve(true);
            }, { once: true });
        }));
        const peer = await connect(); member = [...route.clients.values()][0];
        send(peer, 'enter', 'first', 'first'); send(peer, 'enter', 'second', 'second');
        await waitForCondition(() => pending.length === 2, 'two pending entries');
        member.leaveRoom('first');
        expect(await reentry).toBe('ACCESS_CANCELLED');
        expect(await response(peer, 'first')).toMatchObject({ error: { code: 'ACCESS_CANCELLED' } });
        expect(await response(peer, 'second')).toMatchObject({ error: { code: 'ACCESS_CANCELLED' } });
        expect(route.rooms.size).toBe(0);
    });

    test('unversioned and binary handlers receive recoverable permission diagnostics', async () => {
        const { connect, send, response } = await fixture(() => false, { protocol: false });
        const peer = await connect(); send(peer, 'enter', 'private');
        await waitForCondition(() => peer.messages.length === 1, 'unversioned denial');
        expect(peer.messages[0]).toMatchObject({ code: 'ACCESS_DENIED', error: 'This operation is not permitted.' });
        peer.send(Buffer.from([1]));
        await waitForCondition(() => peer.messages.length === 2, 'binary denial');
        expect(peer.messages[1]).toEqual(peer.messages[0]);
        send(peer, 'ping');
        await waitForCondition(() => peer.messages.some(message => message.pong), 'connection recovery');
        expect(peer.readyState).toBe(WebSocket.OPEN);
    });

    test('serialization cannot publish after revocation, including sender and recipient removal', async () => {
        const { route, connect } = await fixture(() => true);
        await connect(); await connect('bob');
        const [alice, bob] = [...route.clients.values()];
        await route.rooms.enter('private', alice); await route.rooms.enter('private', bob);
        expect(route.rooms.broadcastFrom(undefined, 'private', { notice: 'absent sender' })).toBe(0);
        expect(route.rooms.broadcastFrom({}, 'private', { notice: 'invalid sender' })).toBe(0);
        expect(alice.roomBroadcast('private', { notice: 'peer' }, { except: alice })).toBe(1);
        expect(alice.roomBroadcast('private', { toJSON() { route.rooms.leaveAll(alice); return { notice: 'invalid sender' }; } })).toBe(0);
        expect(route.rooms.broadcast('private', { toJSON() { route.rooms.clear(); return { notice: 'invalid recipient' }; } })).toBe(0);
        await route.rooms.enter('private', bob);
        expect(route.rooms.broadcast('private', { toJSON() { route.rooms.close(); return { notice: 'closed' }; } })).toBe(0);
    });

    test('nested clear cannot release the outer guard while authorization callbacks are running', async () => {
        let member, other, reentry, waiting = false;
        const { route, connect, send, response } = await fixture(({ signal }) => new Promise(resolve => {
            waiting = true;
            signal.addEventListener('abort', () => {
                route.rooms.clear();
                reentry = other.enterRoom('new');
                resolve(true);
            }, { once: true });
        }));
        const peer = await connect(); await connect('bob');
        [member, other] = [...route.clients.values()];
        send(peer, 'enter', 'private', 'pending');
        await waitForCondition(() => waiting, 'policy waiting');
        route.rooms.clear();
        expect(await reentry).toBe(false);
        expect(await response(peer, 'pending')).toMatchObject({ error: { code: 'ACCESS_CANCELLED' } });
        expect(route.rooms.size).toBe(0);
        expect(route.rooms.has('new', other)).toBe(false);
    });
});
