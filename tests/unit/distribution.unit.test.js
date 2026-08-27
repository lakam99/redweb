const DistributionBridge = require('../../src/ws/DistributionBridge');

function adapter(overrides = {}) {
    return {
        publish() {},
        subscribe() {},
        ...overrides,
    };
}

describe('bounded distribution bridge', () => {
    test.each([
        [null, '`distribution`'],
        [[], '`distribution`'],
        [{}, 'adapter'],
        [{ adapter: {}, channel: 'game' }, 'adapter.publish'],
        [{ adapter: { publish() {} }, channel: 'game' }, 'adapter.subscribe'],
        [{ adapter: adapter({ start: true }), channel: 'game' }, 'adapter.start'],
        [{ adapter: adapter({ unsubscribe: true }), channel: 'game' }, 'adapter.unsubscribe'],
        [{ adapter: adapter({ close: true }), channel: 'game' }, 'adapter.close'],
        [{ adapter: adapter(), channel: '' }, 'channel'],
        [{ adapter: adapter(), channel: 'game', nodeId: '' }, 'nodeId'],
        [{ adapter: adapter(), channel: 'game', nodeId: 'x'.repeat(257) }, 'nodeId'],
        [{ adapter: adapter(), channel: 'game', maxEventBytes: 0 }, 'maxEventBytes'],
        [{ adapter: adapter(), channel: 'game', maxSeenEvents: 1.5 }, 'maxSeenEvents'],
        [{ adapter: adapter(), channel: 'game', seenTtlMs: -1 }, 'seenTtlMs'],
        [{ adapter: adapter(), channel: 'game', lifecycleTimeoutMs: 0 }, 'lifecycleTimeoutMs'],
        [{ adapter: adapter(), channel: 'game', publishTimeoutMs: 0 }, 'publishTimeoutMs'],
        [{ adapter: adapter(), channel: 'game', maxConcurrentPublishes: 0 }, 'maxConcurrentPublishes'],
        [{ adapter: adapter(), channel: 'game', maxConcurrentEvents: 1.5 }, 'maxConcurrentEvents'],
        [{ adapter: adapter(), channel: 'game', required: 'yes' }, 'distribution.required'],
    ])('validates distribution options %#', (options, message) => {
        expect(() => new DistributionBridge(options, () => {})).toThrow(message);
    });

    test('validates event callback and clock dependencies', () => {
        expect(() => new DistributionBridge({ adapter: adapter(), channel: 'game' }, null)).toThrow('onEvent');
        expect(() => new DistributionBridge({ adapter: adapter(), channel: 'game' }, () => {}, null, null)).toThrow('`clock`');
    });

    test('starts, publishes bounded envelopes, and contains adapter failures', async () => {
        const calls = [];
        const errors = [];
        const bridge = new DistributionBridge({
            adapter: adapter({
                async start() { calls.push('start'); },
                subscribe(channel, listener) { calls.push(['subscribe', channel]); this.listener = listener; },
                async publish(channel, event) { calls.push(['publish', channel, JSON.parse(event)]); },
            }),
            channel: 'match',
            nodeId: 'node-a',
            maxEventBytes: 256,
        }, event => calls.push(['event', event]), { error: (_message, error) => errors.push(error.message) });
        expect(await bridge.ready).toBe(true);
        expect(bridge.isReady()).toBe(true);
        expect(await bridge.publish('', {})).toBe(false);
        expect(await bridge.publish('state', { score: 1 })).toBe(true);
        expect(calls[0]).toBe('start');
        expect(calls[1]).toEqual(['subscribe', 'match']);
        expect(calls[2][0]).toBe('publish');
        expect(calls[2][2]).toMatchObject({ source: 'node-a', type: 'state', payload: { score: 1 } });

        const circular = {};
        circular.self = circular;
        expect(await bridge.publish('circular', circular)).toBe(false);
        expect(await bridge.publish('large', 'x'.repeat(300))).toBe(false);

        bridge.adapter.publish = () => Promise.reject(new Error('publish failed'));
        expect(await bridge.publish('state', {})).toBe(false);
        expect(errors).toContain('publish failed');
        await bridge.close();
        expect(bridge.isReady()).toBe(false);
        expect(await bridge.publish('closed', {})).toBe(false);
    });

    test('validates, deduplicates, expires, and bounds received events without reflection', async () => {
        let now = 0;
        const events = [];
        const errors = [];
        const bridge = new DistributionBridge({
            adapter: adapter(),
            channel: 'game',
            nodeId: 'local',
            maxEventBytes: 200,
            maxSeenEvents: 2,
            seenTtlMs: 10,
        }, event => {
            events.push(event.id);
            if (event.type === 'reject') return Promise.reject(new Error('event failed'));
        }, { error: (_message, error) => errors.push(error.message) }, () => now);
        await bridge.ready;
        expect(bridge.receive('{')).toBe(false);
        expect(bridge.receive('x'.repeat(201))).toBe(false);
        expect(bridge.receive(null)).toBe(false);
        expect(bridge.receive({ id: '', source: 'remote', type: 'x' })).toBe(false);
        expect(bridge.receive({ id: '1', source: '', type: 'x' })).toBe(false);
        expect(bridge.receive({ id: '1', source: 'remote', type: '' })).toBe(false);
        expect(bridge.receive({ id: 'x'.repeat(257), source: 'remote', type: 'x' })).toBe(false);
        expect(bridge.receive({ id: '1', source: 'x'.repeat(257), type: 'x' })).toBe(false);
        expect(bridge.receive({ id: '1', source: 'remote', type: 'x'.repeat(257) })).toBe(false);
        expect(bridge.receive({ id: 'self', source: 'local', type: 'x' })).toBe(false);

        const first = { id: 'one', source: 'remote', type: 'state', payload: 1 };
        expect(bridge.receive(JSON.stringify(first))).toBe(true);
        expect(bridge.receive(first)).toBe(false);
        expect(bridge.receive({ id: 'two', source: 'remote', type: 'reject' })).toBe(true);
        await new Promise(setImmediate);
        expect(events).toEqual(['one', 'two']);
        expect(errors).toContain('event failed');
        expect(bridge.receive({ id: 'three', source: 'remote', type: 'state' })).toBe(true);
        expect(bridge.seen.size).toBe(2);
        expect(bridge.seen.has('one')).toBe(false);

        now = 10;
        expect(bridge.receive({ id: 'two', source: 'remote', type: 'state' })).toBe(true);
        expect(bridge.receive(first)).toBe(true);
        expect(bridge.seen.size).toBe(2);
        await bridge.close();
        expect(bridge.receive({ id: 'closed', source: 'remote', type: 'x' })).toBe(false);
    });

    test('contains startup timeout and performs every bounded cleanup operation', async () => {
        const calls = [];
        const errors = [];
        const timedOut = new DistributionBridge({
            adapter: adapter({ start: () => new Promise(() => {}), close: () => calls.push('close') }),
            channel: 'game',
            lifecycleTimeoutMs: 1,
        }, () => {}, { error: (_message, error) => errors.push(error.message) });
        expect(await timedOut.ready).toBe(false);
        expect(errors[0]).toContain('timed out');
        await timedOut.close();
        expect(calls).toEqual(['close']);

        const cleanup = new DistributionBridge({
            adapter: adapter({
                subscribe() { return () => { calls.push('unsubscribe'); throw new Error('unsubscribe failed'); }; },
                close() { calls.push('failed-close'); return Promise.reject(new Error('close failed')); },
            }),
            channel: 'game',
            lifecycleTimeoutMs: 50,
        }, () => {});
        await cleanup.ready;
        await expect(cleanup.close()).rejects.toMatchObject({ errors: expect.any(Array) });
        await cleanup.close();
        expect(calls).toEqual(expect.arrayContaining(['unsubscribe', 'failed-close']));
    });

    test('uses adapter unsubscribe when subscribe does not return one', async () => {
        const calls = [];
        const bridge = new DistributionBridge({
            adapter: adapter({
                unsubscribe: channel => calls.push(channel),
                close: () => {},
            }),
            channel: 'game',
        }, () => {});
        await bridge.ready;
        await bridge.close();
        expect(calls).toEqual(['game']);
    });

    test('stops startup cleanly when closed while the adapter is starting', async () => {
        let releaseStart;
        const bridge = new DistributionBridge({
            adapter: adapter({ start: () => new Promise(resolve => { releaseStart = resolve; }) }),
            channel: 'game',
        }, () => {});
        await new Promise(setImmediate);
        const closing = bridge.close();
        releaseStart();
        expect(await bridge.ready).toBe(false);
        await closing;
    });

    test('does not publish when close races with subscription readiness', async () => {
        let releaseSubscription;
        const bridge = new DistributionBridge({
            adapter: adapter({
                subscribe: () => new Promise(resolve => { releaseSubscription = resolve; }),
            }),
            channel: 'game',
        }, () => {});
        await new Promise(setImmediate);
        const publishing = bridge.publish('state', {});
        releaseSubscription();
        const closing = bridge.close();
        expect(await publishing).toBe(false);
        await closing;
    });

    test('bounds and times out concurrent publishes without retaining a backlog', async () => {
        const errors = [];
        const bridge = new DistributionBridge({
            adapter: adapter({ publish: () => new Promise(() => {}) }),
            channel: 'game',
            maxConcurrentPublishes: 1,
            publishTimeoutMs: 2,
            lifecycleTimeoutMs: 20,
        }, () => {}, { error: (_message, error) => errors.push(error.message) });
        await bridge.ready;
        const first = bridge.publish('state', {});
        expect(bridge.publishes.size).toBe(1);
        expect(await bridge.publish('second', {})).toBe(false);
        expect(await first).toBe(false);
        await new Promise(setImmediate);
        expect(bridge.publishes.size).toBe(0);
        expect(errors).toContain('Distribution adapter publish timed out.');
        await bridge.close();
    });

    test('bounds inbound concurrency and unsubscribes before draining handlers', async () => {
        const calls = [];
        let release;
        const blocked = new Promise(resolve => { release = resolve; });
        const bridge = new DistributionBridge({
            adapter: adapter({
                subscribe: () => () => calls.push('unsubscribe'),
                close: () => calls.push('close'),
            }),
            channel: 'game',
            maxConcurrentEvents: 1,
            lifecycleTimeoutMs: 50,
        }, async () => { calls.push('event-start'); await blocked; calls.push('event-end'); });
        await bridge.ready;
        expect(bridge.receive({ id: 'one', source: 'remote', type: 'state' })).toBe(true);
        expect(bridge.receive({ id: 'two', source: 'remote', type: 'state' })).toBe(false);
        await new Promise(setImmediate);
        const closing = bridge.close();
        await new Promise(setImmediate);
        expect(calls).toEqual(['event-start', 'unsubscribe']);
        release();
        await closing;
        expect(calls).toEqual(['event-start', 'unsubscribe', 'event-end', 'close']);
    });

    test('bounds close when an inbound handler does not cooperate', async () => {
        const bridge = new DistributionBridge({
            adapter: adapter(),
            channel: 'game',
            lifecycleTimeoutMs: 2,
        }, () => new Promise(() => {}));
        await bridge.ready;
        bridge.receive({ id: 'one', source: 'remote', type: 'state' });
        await expect(bridge.close()).rejects.toMatchObject({ errors: expect.any(Array) });
    });
});
