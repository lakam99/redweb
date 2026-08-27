const { EventEmitter } = require('events');
const { AdmissionPolicy, ADMISSION_CONTEXT, PLACEMENT_REDIRECT } = require('../../src/ws/AdmissionPolicy');
const HeartbeatMonitor = require('../../src/ws/HeartbeatMonitor');
const TaskQueue = require('../../src/ws/TaskQueue');
const TokenBucket = require('../../src/ws/TokenBucket');
const TransportPolicy = require('../../src/ws/TransportPolicy');
const { broadcast, sendJson, sendPayload } = require('../../src/ws/util');

function rawSocket() {
    const socket = new EventEmitter();
    socket.destroyed = false;
    return socket;
}

function route() {
    return { resolveRemoteAddress: () => '127.0.0.1' };
}

describe('production multiplayer policies', () => {
    test.each([
        [null, 'function or an object'],
        [7, 'function or an object'],
        [{ authenticate: true }, '`admission.authenticate`'],
        [{ place: true }, '`admission.place`'],
        [{ origins: {} }, '`admission.origins`'],
        [{ origins: [''] }, 'non-empty string'],
        [{ origins: [7] }, 'non-empty string'],
        [{ authenticate() {}, timeoutMs: 0 }, '`admission.timeoutMs`'],
        [{ authenticate() {}, timeoutMs: 1.5 }, '`admission.timeoutMs`'],
        [{}, 'requires `authenticate`'],
    ])('validates admission configuration %#', (options, message) => {
        expect(() => new AdmissionPolicy(options)).toThrow(message);
    });

    test('admits sync or async principals with network context and exact origins', async () => {
        const requests = [
            { headers: { origin: 'https://game.example' } },
            { headers: { origin: 'https://game.example' } },
        ];
        const contexts = [];
        const policy = new AdmissionPolicy({
            origins: ['https://game.example'],
            authenticate(request, context) {
                contexts.push(context);
                return request === requests[0] ? { playerId: 'one' } : Promise.resolve({ playerId: 'two' });
            },
        });
        for (const request of requests) {
            expect(await policy.authorize(request, rawSocket(), route())).toBe(true);
            expect(request[ADMISSION_CONTEXT].principal.playerId).toMatch(/one|two/);
        }
        expect(contexts).toHaveLength(2);
        expect(contexts[0]).toMatchObject({ networkIdentity: '127.0.0.1', route: expect.any(Object) });
        expect(contexts[0].signal).toBeInstanceOf(AbortSignal);
    });

    test('rejects disallowed, missing, false, throwing, closed, and timed-out admission', async () => {
        const exact = new AdmissionPolicy({ origins: ['https://game.example'] });
        expect(await exact.authorize({ headers: {} }, rawSocket(), route())).toBe(false);
        expect(await exact.authorize({ headers: { origin: 'https://evil.example' } }, rawSocket(), route())).toBe(false);

        const originFunction = new AdmissionPolicy({ origins: async origin => origin === 'allowed' });
        expect(await originFunction.authorize({ headers: { origin: 'allowed' } }, rawSocket(), route())).toBe(true);
        expect(await originFunction.authorize({ headers: { origin: 'denied' } }, rawSocket(), route())).toBe(false);

        const denied = new AdmissionPolicy(() => false);
        expect(await denied.authorize({ headers: {} }, rawSocket(), route())).toBe(false);
        const throwing = new AdmissionPolicy(() => { throw new Error('secret'); });
        expect(await throwing.authorize({ headers: {} }, rawSocket(), route())).toBe(false);

        const destroyed = rawSocket();
        destroyed.destroyed = true;
        expect(await new AdmissionPolicy(() => true).authorize({ headers: {} }, destroyed, route())).toBe(false);

        const closing = rawSocket();
        const closePolicy = new AdmissionPolicy({ authenticate: () => new Promise(() => {}), timeoutMs: 100 });
        const closeResult = closePolicy.authorize({ headers: {} }, closing, route());
        closing.emit('close');
        expect(await closeResult).toBe(false);

        let timeoutSignal;
        const timeoutPolicy = new AdmissionPolicy({
            timeoutMs: 1,
            authenticate(_request, context) {
                timeoutSignal = context.signal;
                return new Promise(() => {});
            },
        });
        expect(await timeoutPolicy.authorize({ headers: {} }, rawSocket(), route())).toBe(false);
        expect(timeoutSignal.aborted).toBe(true);
    });

    test('places authenticated principals before upgrade with safe bounded redirects', async () => {
        const request = { headers: {} };
        const redirecting = new AdmissionPolicy({
            authenticate: () => ({ playerId: 'player' }),
            place: async (principal, _request, context) => {
                expect(principal).toEqual({ playerId: 'player' });
                expect(context.networkIdentity).toBe('127.0.0.1');
                return 'wss://node-2.example/game';
            },
        });
        expect(await redirecting.authorize(request, rawSocket(), route())).toBe(false);
        expect(request[PLACEMENT_REDIRECT]).toBe('wss://node-2.example/game');

        for (const value of [false, 'javascript:alert(1)', 'wss://good.example/\r\nBad: value', 'x'.repeat(2049), 'not a url']) {
            const policy = new AdmissionPolicy({ place: () => value });
            expect(await policy.authorize({ headers: {} }, rawSocket(), route())).toBe(false);
        }

        const accepted = { headers: {} };
        expect(await new AdmissionPolicy({ place: () => true }).authorize(accepted, rawSocket(), route())).toBe(true);
        expect(accepted[ADMISSION_CONTEXT]).toEqual({ principal: undefined });

        let placementAborted = false;
        const timedPlacement = new AdmissionPolicy({
            timeoutMs: 1,
            place(_principal, _request, { signal }) {
                signal.addEventListener('abort', () => { placementAborted = true; }, { once: true });
                return new Promise(() => {});
            },
        });
        expect(await timedPlacement.authorize({ headers: {} }, rawSocket(), route())).toBe(false);
        expect(placementAborted).toBe(true);
    });

    test('token buckets refill monotonically and validate costs and options', () => {
        expect(() => new TokenBucket({ capacity: 0, refillPerSecond: 1 })).toThrow('`capacity`');
        expect(() => new TokenBucket({ capacity: Infinity, refillPerSecond: 1 })).toThrow('`capacity`');
        expect(() => new TokenBucket({ capacity: 1, refillPerSecond: -1 })).toThrow('`refillPerSecond`');
        expect(() => new TokenBucket({ capacity: 1, refillPerSecond: Infinity })).toThrow('`refillPerSecond`');
        expect(() => new TokenBucket({ capacity: 1, refillPerSecond: 1 }, null)).toThrow('`clock`');

        const times = [100, 100, 100, 90, 1100, 2100];
        const bucket = new TokenBucket({ capacity: 2, refillPerSecond: 1 }, () => times.shift());
        expect(bucket.consume()).toBe(true);
        expect(bucket.consume()).toBe(true);
        expect(bucket.consume()).toBe(false);
        expect(bucket.consume()).toBe(true);
        expect(bucket.consume(2)).toBe(false);
        expect(() => bucket.consume(0)).toThrow('`cost`');
        expect(() => bucket.consume(Infinity)).toThrow('`cost`');
    });

    test('bounded task queues serialize work, contain errors, and clean up deterministically', async () => {
        expect(() => new TaskQueue(0)).toThrow('`maxPending`');
        expect(() => new TaskQueue(1.5)).toThrow('`maxPending`');
        expect(() => new TaskQueue(1, null)).toThrow('`onError`');
        const calls = [];
        let release;
        const blocked = new Promise(resolve => { release = resolve; });
        const queue = new TaskQueue(1, async error => {
            calls.push(error.message);
            throw new Error('reporting failed');
        });
        expect(() => queue.enqueue(null)).toThrow('functions');
        expect(queue.enqueue(async () => { calls.push('start'); await blocked; calls.push('end'); })).toBe(true);
        expect(queue.pending).toBe(1);
        expect(queue.enqueue(() => { throw new Error('task failed'); })).toBe(true);
        expect(queue.enqueue(() => calls.push('overflow'))).toBe(false);
        const idle = queue.whenIdle();
        release();
        await idle;
        expect(calls).toEqual(['start', 'end', 'task failed']);
        expect(queue.pending).toBe(0);
        await queue.whenIdle();
        queue.close();
        queue.close();
        expect(queue.enqueue(() => {})).toBe(false);

        let finish;
        const closing = new TaskQueue(2);
        closing.enqueue(() => new Promise(resolve => { finish = resolve; }));
        closing.enqueue(() => calls.push('cleared'));
        const closingIdle = closing.whenIdle();
        closing.close();
        finish();
        await closingIdle;
        expect(calls).not.toContain('cleared');

        const defaultReporter = new TaskQueue(1);
        defaultReporter.enqueue(() => { throw new Error('contained'); });
        await defaultReporter.whenIdle();
    });

    test('one heartbeat monitor manages pong, timeout, errors, detach, and idempotent stop', () => {
        expect(() => new HeartbeatMonitor({ intervalMs: 0, timeoutMs: 1 })).toThrow('intervalMs');
        expect(() => new HeartbeatMonitor({ intervalMs: 1.5, timeoutMs: 1 })).toThrow('intervalMs');
        expect(() => new HeartbeatMonitor({ intervalMs: 1, timeoutMs: 0 })).toThrow('timeoutMs');
        expect(() => new HeartbeatMonitor({ intervalMs: 1, timeoutMs: 1.5 })).toThrow('timeoutMs');
        expect(() => new HeartbeatMonitor({ intervalMs: 1, timeoutMs: 1 }, null, null)).toThrow('`clock`');

        let now = 0;
        const errors = [];
        const logger = { error: (_message, error) => errors.push(error.message) };
        const monitor = new HeartbeatMonitor({ intervalMs: 10, timeoutMs: 5 }, logger, () => now);
        const healthy = new EventEmitter();
        healthy.pings = 0;
        healthy.ping = () => { healthy.pings += 1; };
        const unresponsive = new EventEmitter();
        unresponsive.terminated = 0;
        unresponsive.ping = () => {};
        unresponsive.terminate = () => { unresponsive.terminated += 1; };
        monitor.attach(healthy);
        monitor.attach(healthy);
        monitor.attach(unresponsive);
        expect(monitor.detach(new EventEmitter())).toBe(false);
        monitor.tick();
        expect(healthy.pings).toBe(1);
        now = 2;
        healthy.emit('pong');
        now = 5;
        monitor.tick();
        expect(unresponsive.terminated).toBe(1);
        now = 10;
        monitor.tick();
        expect(healthy.pings).toBe(2);
        expect(monitor.detach(healthy)).toBe(true);

        const brokenPing = new EventEmitter();
        brokenPing.ping = () => { throw new Error('ping failed'); };
        monitor.attach(brokenPing);
        monitor.tick();
        now = 20;
        monitor.tick();
        const brokenTerminate = new EventEmitter();
        brokenTerminate.ping = () => {};
        brokenTerminate.terminate = () => { throw new Error('terminate failed'); };
        monitor.attach(brokenTerminate);
        monitor.tick();
        now = 25;
        monitor.tick();
        expect(errors).toEqual(expect.arrayContaining(['ping failed', 'terminate failed']));
        monitor.attach(new EventEmitter());
        monitor.stop();
        monitor.stop();
        expect(monitor.sockets.size).toBe(0);
    });

    test.each([
        [null, '`limits`'],
        [{ maxConnections: 0 }, 'maxConnections'],
        [{ maxConnections: 1.5 }, 'maxConnections'],
        [{ maxBufferedBytes: -1 }, 'maxBufferedBytes'],
        [{ maxBufferedBytes: 1.5 }, 'maxBufferedBytes'],
        [{ maxPendingMessages: 0 }, 'maxPendingMessages'],
        [{ slowConsumerAction: 'queue' }, 'slowConsumerAction'],
        [{ messageRate: [] }, 'messageRate'],
        [{ messageRate: { capacity: 1, refillPerSecond: 0, action: 'wait' } }, 'messageRate.action'],
    ])('validates transport configuration %#', (limits, message) => {
        expect(() => new TransportPolicy(limits)).toThrow(message);
    });

    test('transport policy bounds rates, queues, and slow consumers', async () => {
        const policy = new TransportPolicy({
            maxConnections: 2,
            maxBufferedBytes: 5,
            maxPendingMessages: 2,
            messageRate: { capacity: 1, refillPerSecond: 0 },
        }, true);
        const errors = [];
        const runtime = policy.createRuntime(error => errors.push(error));
        expect(policy.acceptsMessage(runtime)).toBe(true);
        expect(policy.acceptsMessage(runtime)).toBe(false);
        expect(policy.acceptsMessage()).toBe(true);
        expect(runtime.queue).toBeInstanceOf(TaskQueue);

        const socket = { bufferedAmount: 0, close: jest.fn() };
        expect(policy.acceptsSend(socket, 5)).toBe(true);
        socket.bufferedAmount = 1;
        expect(policy.acceptsSend(socket, 5)).toBe(false);
        expect(socket.close).toHaveBeenCalledWith(1013, 'Slow consumer');

        const dropping = new TransportPolicy({ maxBufferedBytes: 0, slowConsumerAction: 'drop' });
        const dropSocket = { close: jest.fn() };
        expect(dropping.acceptsSend(dropSocket, 1)).toBe(false);
        expect(dropSocket.close).not.toHaveBeenCalled();
        expect(new TransportPolicy().acceptsSend({}, Number.MAX_SAFE_INTEGER)).toBe(true);
        expect(new TransportPolicy().createRuntime()).toEqual({ limiter: null, queue: null });
    });

    test('send helpers apply one shared policy and contain direct send failures', () => {
        const policy = { acceptsSend: jest.fn(() => true) };
        const sent = [];
        const open = { readyState: 1, bufferedAmount: 0, send: payload => sent.push(payload) };
        const failing = { readyState: 1, send: () => { throw new Error('send failed'); } };
        expect(sendPayload(open, 'abc', policy)).toBe(true);
        expect(sendJson(open, { ok: true }, policy)).toBe(true);
        expect(sendPayload(failing, 'abc', policy)).toBe(false);
        expect(broadcast([open, failing], { event: true }, policy)).toBe(1);
        policy.acceptsSend.mockReturnValue(false);
        expect(sendPayload(open, 'blocked', policy)).toBe(false);
        expect(policy.acceptsSend).toHaveBeenCalled();
        expect(sent).toHaveLength(3);
    });
});
