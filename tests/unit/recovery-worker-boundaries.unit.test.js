'use strict';

const { RecoveryWorkerBoundary } = require('../helpers/RecoveryWorkerBoundary');

async function boundary(options, assertion) {
    const worker = new RecoveryWorkerBoundary(options);
    try { await assertion(worker); } finally { worker.collect(); }
}

test.each([true, false])('server dispatch preserves policy, handler replies and ordered cleanup (already listening=%s)', listening =>
    boundary({ role: 'server', listening, flags: ['--trace-gc'], barrierCleanupAfter: 20 }, async worker => {
        expect(await worker.request('start')).toEqual({ result: { url: 'ws://127.0.0.1:12345/reconnect' } });
        expect(worker.route.settings).toMatchObject({ path: '/reconnect', orderedMessages: true,
            limits: { maxConnections: 100, maxPendingMessages: 4 },
            rooms: { maxRooms: 8, maxMembersPerRoom: 100, maxRoomsPerConnection: 1 },
            sessions: { ttlMs: 250, sweepIntervalMs: 50, maxSessions: 1400 } });
        worker.deliver(3); worker.deliver(8);
        expect(worker.messages).toEqual([{ ready: 3 }, { ready: 8 }]);
        expect([...worker.route.sessions.values()]).toEqual([{ id: 3 }, { id: 8 }]);
        expect(await worker.request('barrier')).toEqual({ result: { received: 2 } });
        expect(worker.time).toBe(20);
        const sample = await worker.request('sample', { phase: 'warm' });
        expect(sample.result).toMatchObject({ received: 2, registries: { clients: 0, rooms: 0, sessions: 0 } });
        expect(worker.gcs).toBe(2);
        expect(worker.stdout).toContain('[rw-phase warm sampled heap=1000 bytecode=50]');
        expect(await worker.request('stop')).toEqual({ result: { stopped: true } });
        worker.disconnect(); expect(worker.exits).toEqual([]); expect(worker.stops).toBe(1);
    }));

test('client batches preserve exact ordered IDs, counters, bounded closes and code markers', () =>
    boundary({ flags: ['--log-code'] }, async worker => {
        for (const start of [0, 2]) {
            expect(await worker.request('batch', { url: 'ws://unit.invalid/reconnect', start, count: 2 }))
                .toEqual({ result: { sent: start + 2, received: start + 2, clients: 0 } });
        }
        expect(worker.messages.map(message => message.id)).toEqual([0, 1, 2, 3]);
        expect(worker.sockets.map(socket => [socket.readyState, socket.closeCalls])).toEqual([[3, 1], [3, 1], [3, 1], [3, 1]]);
        for (const phase of ['warm', 'storm-5', 'other']) {
            expect((await worker.request('sample', { phase })).result).toMatchObject({ sent: 4, received: 4, registries: { clients: 0 } });
        }
        expect(worker.gcs).toBe(6); expect(worker.stdout).toBe('');
        expect(await worker.request('stop')).toEqual({ result: { stopped: true } });
        worker.disconnect(); expect(worker.exits).toEqual([]);
    }));

test.each([
    [{ failReplyAt: 1 }, 'Unit worker failure'],
    [{ wrongReply: true }, 'AssertionError'],
    [{ malformedReply: true }, 'SyntaxError'],
    [{ failCloseAt: 0 }, 'Unit worker failure'],
    [{ incompleteClose: true }, 'Client close did not complete'],
])('failed batch owns every acquisition and rejects success: %j', (options, message) =>
    boundary(options, async worker => {
        const result = await worker.request('batch', { url: 'ws://unit.invalid/reconnect', start: 0, count: 2 });
        expect(result.error).toContain(message); expect(result).not.toHaveProperty('result');
        expect(worker.sockets).toHaveLength(2);
        expect(worker.sockets.map(socket => socket.closeCalls)).toEqual([1, 1]);
        if (options.failCloseAt === undefined && !options.incompleteClose) expect(worker.sockets.every(socket => socket.readyState === 3)).toBe(true);
    }));

test('one failed open waits for a late acquisition before closing every owned socket', async () => {
    let release;
    const openGate = new Promise(resolve => { release = resolve; });
    await boundary({ failOpenAt: 0, openGate }, async worker => {
        const pending = worker.request('batch', { url: 'ws://unit.invalid/reconnect', start: 0, count: 2 });
        let result;
        try {
            await new Promise(setImmediate);
            expect(worker.sockets).toHaveLength(2);
            expect(worker.sockets.map(socket => socket.closeCalls)).toEqual([undefined, undefined]);
            expect(worker.replies).toEqual([]);
        } finally { release(); result = await pending; }
        expect(result.error).toContain('Unit worker failure');
        expect(worker.sockets.map(socket => [socket.readyState, socket.closeCalls])).toEqual([[3, 1], [3, 1]]);
    });
});

test.each(['barrier', 'registries', 'stop'])('server rejects %s failure without a successful reply', mode =>
    boundary({ role: 'server', stuckRegistry: true, stopError: mode === 'stop' }, async worker => {
        await worker.request('start'); worker.deliver(1);
        const result = await worker.request(mode === 'registries' ? 'sample' : mode);
        expect(result.error).toContain(mode === 'barrier' ? 'Server connection cleanup timed out'
            : mode === 'registries' ? 'Recovery registries are not empty' : 'Unit worker failure');
        if (mode === 'barrier') expect(worker.time).toBe(10000);
        worker.disconnect(); expect(worker.exits).toEqual([0]);
    }));

test('snapshots require enabled, empty, active client ownership and redact failures', () =>
    boundary({ heapDirectory: 'unit-owned-directory' }, async worker => {
        expect(await worker.request('snapshot', { phase: 'warm' })).toEqual({ result: { phase: 'warm', pid: 123 } });
        worker.options.snapshotError = true;
        expect(await worker.request('snapshot', { phase: 'storm-5' })).toEqual({ error: 'Private heap capture failed' });
        worker.options.snapshotError = false; worker.options.incompleteClose = true;
        await worker.request('batch', { url: 'ws://unit.invalid/reconnect', start: 0, count: 1 });
        expect(await worker.request('snapshot')).toEqual({ error: 'Private heap capture failed' });
        expect(worker.captures).toEqual(['warm']);
    }));

test('stopped and non-capture workers refuse private snapshot commands', async () => {
    for (const options of [{}, { heapDirectory: 'unit-owned-directory' }]) {
        await boundary(options, async worker => {
            await worker.request('stop');
            expect(await worker.request('snapshot')).toEqual({ error: 'Private heap capture failed' });
        });
    }
});

test('unknown commands are failures; unexpected coordinator loss exits the worker', () =>
    boundary({}, async worker => {
        expect((await worker.request('unknown')).error).toContain('Unknown diagnostic command: unknown');
        worker.disconnect(); expect(worker.exits).toEqual([0]);
    }));
