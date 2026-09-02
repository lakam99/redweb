'use strict';
const RoomAccess = require('../../src/ws/RoomAccess');
const RoomRegistry = require('../../src/ws/RoomRegistry');
const requestSnapshot = require('../../src/context/RequestSnapshot');
const RouteRuntime = require('../../src/ws/RouteRuntime');
const { AccessPolicy } = require('../../src/access/AccessPolicy');

const tick = () => new Promise(setImmediate);
const context = () => ({ principal: 'alice', request: requestSnapshot({}), signal: new AbortController().signal });

describe('bounded room authorization state', () => {
    test('validates options and preserves synchronous unguarded entry', async () => {
        for (const options of [{ authorize: null }, { authorize: () => true, authorizationTimeoutMs: 0 },
            { authorize: () => true, maxPendingAuthorizations: 0 }, { authorize: () => true, maxPendingPerConnection: 1.5 },
            { authorizationTimeoutMs: 5 }, { maxPendingPerConnection: 2 }]) expect(() => new RoomRegistry(options)).toThrow();
        expect(() => new RoomRegistry({}, { contextFor: false })).toThrow('contextFor');
        const rooms = new RoomRegistry(); const socket = {};
        expect(await rooms.enter('room', socket)).toBe(true);
        expect(rooms.join('room', socket)).toBe(true);
        expect(await rooms.enter('room', null)).toBe(false);
        rooms.close(); expect(await rooms.enter('closed', socket)).toBe(false);
        const guarded = new RoomRegistry({ authorize: () => true });
        expect(() => guarded.join('room', socket)).toThrow('enterRoom');
        await expect(guarded.enter('room', socket)).rejects.toMatchObject({ code: 'ACCESS_CANCELLED' });
        await expect(new RoomAccess({ authorize: () => true }, () => ({ signal: AbortSignal.abort() })).enter('room', socket, () => true)).rejects.toMatchObject({ code: 'ACCESS_CANCELLED' });
    });

    test('deduplicates pending entry and independently limits each connection', async () => {
        let release; let commits = 0;
        const guard = new RoomAccess({ authorize: () => new Promise(resolve => { release = resolve; }), maxPendingPerConnection: 1 }, context);
        const socket = {};
        const first = guard.enter('one', socket, () => ++commits);
        expect(guard.enter('one', socket, () => { throw new Error('duplicate commit'); })).toBe(first);
        await expect(guard.enter('two', socket, () => true)).rejects.toMatchObject({ code: 'ACCESS_CAPACITY' });
        release(true);
        expect(await first).toBe(1); expect(commits).toBe(1);
        expect(guard.running).toBe(0); expect(guard.pending.size).toBe(0);
        guard.cancel(socket); guard.clear();
    });

    test('cancels before invocation and rejects reentrant entry during cancellation', async () => {
        let invoked = 0;
        const guard = new RoomAccess({ authorize: () => { invoked++; return true; } }, context);
        const socket = {};
        const first = guard.enter('one', socket, () => true);
        guard.cancel(socket, 'one');
        await expect(first).rejects.toMatchObject({ code: 'ACCESS_CANCELLED' });
        expect(invoked).toBe(0); expect(guard.running).toBe(0);
        const nested = [];
        const active = new RoomAccess({ authorize: ({ signal }) => new Promise(resolve => {
            signal.addEventListener('abort', () => {
                nested.push(active.enter('another', socket, () => true).catch(error => error.code));
                resolve(true);
            }, { once: true });
        }) }, context);
        const pending = active.enter('one', socket, () => true);
        await tick(); active.cancel(socket, 'unrelated');
        expect(active.pending.size).toBe(1);
        active.clear();
        await expect(pending).rejects.toMatchObject({ code: 'ACCESS_CANCELLED' });
        expect(await Promise.all(nested)).toEqual(['ACCESS_CANCELLED']);
        expect(active.running).toBe(0);
    });

    test('shared request snapshots derive raw upgrade paths/query and retain repeated keys safely', () => {
        const snapshot = requestSnapshot({ url: '/room?tag=a&tag=b&__proto__=safe' });
        expect(snapshot.path).toBe('/room');
        expect(snapshot.query).toEqual({ tag: ['a', 'b'], ['__proto__']: 'safe' });
        expect(Object.isFrozen(snapshot.query.tag)).toBe(true);
    });

    test('cancellation remains authoritative at every final authorization microtask boundary', async () => {
        for (let depth = 0; depth < 24; depth++) {
            let cancelled = false;
            const socket = {};
            const cancel = remaining => queueMicrotask(() => {
                if (remaining) cancel(remaining - 1);
                else { cancelled = true; guard.cancel(socket); }
            });
            const guard = new RoomAccess({ authorize: () => { cancel(depth); return true; } }, context);
            await guard.enter('private', socket, () => { expect(cancelled).toBe(false); return true; }).catch(error => expect(error.code).toBe('ACCESS_CANCELLED'));
            await tick();
            expect(guard.running).toBe(0);
        }
    });

    test('independent pending rooms release only their own bookkeeping', async () => {
        const pending = new Map(); const socket = {};
        const guard = new RoomAccess({ authorize: (_context, room) => new Promise(resolve => pending.set(room, resolve)) }, context);
        const first = guard.enter('one', socket, () => true);
        const second = guard.enter('two', socket, () => true);
        await tick(); pending.get('one')(true);
        expect(await first).toBe(true); expect(guard.pending.get(socket).size).toBe(1);
        pending.get('two')(true); expect(await second).toBe(true);
        expect(guard.pending.size).toBe(0);
    });

    test('late context creation is already cancelled after drain, while an absent policy is a no-op', async () => {
        await expect(new AccessPolicy().check()).resolves.toBeUndefined();
        const runtime = new RouteRuntime({ draining: true }, {});
        const data = runtime.ensureContext({});
        expect(data.signal.aborted).toBe(true);
        expect(data.request.path).toBe('/');
    });
});
