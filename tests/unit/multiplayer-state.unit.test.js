const { EventEmitter } = require('events');
const FixedStepService = require('../../src/ws/FixedStepService');
const Metrics = require('../../src/ws/Metrics');
const RoomRegistry = require('../../src/ws/RoomRegistry');
const SessionRegistry = require('../../src/ws/SessionRegistry');

function socket(id) {
    const value = new EventEmitter();
    value.id = id;
    value.readyState = 1;
    value.sent = [];
    value.closed = [];
    value.send = payload => value.sent.push(payload);
    value.close = (...args) => value.closed.push(args);
    value.context = { connectionId: id, principal: null, session: null, metadata: {} };
    return value;
}

describe('route-scoped multiplayer state', () => {
    test.each([
        [null, '`rooms`'],
        [[], '`rooms`'],
        [{ maxRooms: 0 }, 'maxRooms'],
        [{ maxMembersPerRoom: 1.5 }, 'maxMembersPerRoom'],
        [{ maxRoomsPerConnection: 0 }, 'maxRoomsPerConnection'],
        [{ maxRoomIdLength: -1 }, 'maxRoomIdLength'],
    ])('validates room limits %#', (options, message) => {
        expect(() => new RoomRegistry(options)).toThrow(message);
    });

    test('validates injected room functions and room identifiers', () => {
        expect(() => new RoomRegistry({}, { hasConnection: true })).toThrow('`hasConnection`');
        expect(() => new RoomRegistry({}, { onChange: true })).toThrow('`onChange`');
        const rooms = new RoomRegistry({ maxRoomIdLength: 3 });
        expect(() => rooms.join('', {})).toThrow('Room IDs');
        expect(() => rooms.members('long')).toThrow('Room IDs');
        expect(() => rooms.has(null, {})).toThrow('Room IDs');
        expect(() => rooms.broadcast('long', {})).toThrow('Room IDs');
        expect(() => rooms.leave('', {})).toThrow('Room IDs');
    });

    test('joins idempotently, enforces every bound, broadcasts once, and reclaims empty rooms', () => {
        const connected = new Set();
        const changes = [];
        const rooms = new RoomRegistry({
            maxRooms: 2,
            maxMembersPerRoom: 2,
            maxRoomsPerConnection: 2,
            maxRoomIdLength: 16,
        }, {
            hasConnection: member => connected.has(member),
            onChange: (action, roomId, member) => changes.push([action, roomId, member.id]),
        });
        const first = socket('first');
        const second = socket('second');
        const third = socket('third');
        connected.add(first);
        connected.add(second);
        connected.add(third);

        expect(rooms.join('red', {})).toBe(false);
        expect(rooms.join('red', first)).toBe(true);
        expect(rooms.join('red', first)).toBe(true);
        expect(rooms.join('red', second)).toBe(true);
        expect(rooms.join('red', third)).toBe(false);
        expect(rooms.join('blue', first)).toBe(true);
        expect(rooms.join('green', second)).toBe(false);
        expect(rooms.join('blue', second)).toBe(true);
        expect(rooms.join('red', third)).toBe(false);
        expect(rooms.has('red', first)).toBe(true);
        expect(rooms.members('red')).toEqual([first, second]);
        expect(rooms.members('missing')).toEqual([]);
        expect(rooms.broadcast('missing', { type: 'none' })).toBe(0);
        expect(rooms.broadcast('red', { type: 'all' })).toBe(2);
        expect(rooms.broadcast('red', { type: 'peer' }, { except: first })).toBe(1);
        expect(JSON.parse(first.sent[0])).toEqual({ type: 'all' });
        expect(second.sent.map(payload => JSON.parse(payload))).toEqual([{ type: 'all' }, { type: 'peer' }]);

        expect(rooms.leave('red', third)).toBe(false);
        expect(rooms.leave('red', first)).toBe(true);
        expect(rooms.leaveAll(first)).toBe(1);
        expect(rooms.leaveAll(first)).toBe(0);
        expect(rooms.leaveAll(second)).toBe(2);
        expect(rooms.size).toBe(0);
        expect(changes).toHaveLength(8);
        rooms.clear();

        const defaults = new RoomRegistry();
        const defaultMember = socket('default');
        expect(defaults.join('room', defaultMember)).toBe(true);
        expect(defaults.leave('room', defaultMember)).toBe(true);

        const membershipBound = new RoomRegistry({ maxRooms: 3, maxRoomsPerConnection: 1 });
        expect(membershipBound.join('one', defaultMember)).toBe(true);
        expect(membershipBound.join('two', defaultMember)).toBe(false);
        expect(membershipBound.close()).toBe(true);
        expect(membershipBound.close()).toBe(false);
        expect(membershipBound.join('late', defaultMember)).toBe(false);
        expect(membershipBound.broadcast('late', {})).toBe(0);
    });

    test.each([
        [null, '`sessions`'],
        [[], '`sessions`'],
        [{ ttlMs: 0 }, 'ttlMs'],
        [{ maxSessions: 1.5 }, 'maxSessions'],
        [{ maxSessionIdLength: 0 }, 'maxSessionIdLength'],
        [{ sweepIntervalMs: -1 }, 'sweepIntervalMs'],
    ])('validates session limits %#', (options, message) => {
        expect(() => new SessionRegistry(options)).toThrow(message);
    });

    test('sessions resume atomically and stale sockets cannot release replacements', () => {
        let now = 0;
        const errors = [];
        const sessions = new SessionRegistry({
            ttlMs: 10,
            maxSessions: 2,
            maxSessionIdLength: 8,
            sweepIntervalMs: 1000,
        }, { error: (_message, error) => errors.push(error.message) }, () => now);
        expect(() => sessions.create('', {})).toThrow('Session IDs');
        expect(() => sessions.get('too-long-id')).toThrow('Session IDs');
        expect(() => sessions.assign('one', {}, null)).toThrow('socket is required');

        const first = socket('first');
        const second = socket('second');
        expect(sessions.create('one', { score: 1 }, first)).toBe(true);
        expect(sessions.create('one', {})).toBe(false);
        expect(sessions.create('two', { score: 2 })).toBe(true);
        expect(sessions.create('three', {})).toBe(false);
        expect(sessions.get('one')).toEqual({ score: 1 });
        expect(first.context.session.id).toBe('one');

        expect(sessions.resume('one', second)).toEqual({ score: 1 });
        expect(first.closed).toEqual([[4000, 'Session resumed elsewhere']]);
        expect(first.context.session).toBeNull();
        expect(second.context.session.id).toBe('one');
        expect(sessions.release(first)).toBe(false);
        expect(sessions.get('one')).toEqual({ score: 1 });
        expect(sessions.release(second)).toBe(true);
        expect(sessions.release(second)).toBe(false);

        now = 10;
        expect(sessions.resume('one', first)).toBeNull();
        expect(sessions.remove('missing')).toBe(false);
        expect(sessions.remove('two')).toBe(true);
        expect(sessions.size).toBe(0);

        const broken = socket('broken');
        broken.close = () => { throw new Error('close failed'); };
        expect(sessions.create('old', {}, broken)).toBe(true);
        expect(sessions.resume('old', second)).toEqual({});
        expect(errors).toContain('close failed');
        sessions.stop();
        sessions.stop();
        expect(second.context.session).toBeNull();
        expect(sessions.create('late', {})).toBe(false);
        expect(sessions.resume('old', second)).toBeNull();
        expect(sessions.remove('old')).toBe(false);
        expect(sessions.get('old')).toBeUndefined();
    });

    test('session reassignment releases prior ownership and expiry sweeps bounded state', () => {
        let now = 0;
        const sessions = new SessionRegistry({ ttlMs: 5, maxSessions: 3, sweepIntervalMs: 1000 }, null, () => now);
        const owner = socket('owner');
        sessions.create('first', 1, owner);
        sessions.create('second', 2);
        sessions.resume('second', owner);
        expect(sessions.get('first')).toBe(1);
        expect(owner.__redwebSessionId).toBe('second');
        now = 5;
        sessions.sweep();
        expect(sessions.get('first')).toBeUndefined();
        expect(sessions.get('second')).toBe(2);
        expect(sessions.remove('second')).toBe(true);
        expect(owner.context.session).toBeNull();
        sessions.stop();
    });

    test('sessions handle missing records and sockets without framework context', () => {
        const defaults = new SessionRegistry();
        clearInterval(defaults.timer);
        defaults.timer = null;
        defaults.stop();
        expect(() => new SessionRegistry({}, null, null)).toThrow('`clock`');

        let now = 0;
        const sessions = new SessionRegistry({ ttlMs: 5, sweepIntervalMs: 1000 }, null, () => now);
        const plain = socket('plain');
        delete plain.context;
        expect(sessions.resume('missing', plain)).toBeNull();
        expect(sessions.create('plain', 1, plain)).toBe(true);
        const replacement = socket('replacement');
        delete replacement.context;
        expect(sessions.resume('plain', replacement)).toBe(1);
        expect(sessions.release(replacement)).toBe(true);

        const missingOwner = socket('missing-owner');
        delete missingOwner.context;
        missingOwner.__redwebSessionId = 'absent';
        expect(sessions.release(missingOwner)).toBe(false);

        expect(sessions.create('remove', 2, plain)).toBe(true);
        expect(sessions.remove('remove')).toBe(true);
        expect(sessions.create('retained', 3)).toBe(true);
        expect(sessions.create('active', 4, plain)).toBe(true);
        sessions.stop();
        expect(sessions.size).toBe(0);
    });

    test.each([
        [null, '`metrics`'],
        [[], '`metrics`'],
        [{ increment: true }, 'metrics.increment'],
        [{ gauge: true }, 'metrics.gauge'],
        [{ observe: true }, 'metrics.observe'],
        [{}, 'at least one'],
    ])('validates metrics sinks %#', (sink, message) => {
        expect(() => new Metrics(sink, '/game')).toThrow(message);
    });

    test('metrics remain vendor-neutral, bounded, optional, and failure-contained', async () => {
        const calls = [];
        const errors = [];
        const metrics = new Metrics({
            increment: (name, value, attributes) => calls.push(['increment', name, value, attributes]),
            gauge: () => { throw new Error('sync metric failure'); },
            observe: () => Promise.reject(new Error('async metric failure')),
        }, '/game', { error: (_message, error) => errors.push(error.message) });
        metrics.increment('connections');
        metrics.gauge('active', 2);
        metrics.observe('latency', 3);
        metrics.emit('missing', 'ignored');
        await new Promise(setImmediate);
        expect(calls[0]).toEqual(['increment', 'connections', 1, { route: '/game' }]);
        expect(Object.isFrozen(calls[0][3])).toBe(true);
        expect(errors).toEqual(['sync metric failure', 'async metric failure']);
    });

    test('fixed-step services cap catch-up, never overlap, and contain tick failures', async () => {
        expect(() => new FixedStepService('bad', 0)).toThrow('tickRateMs');
        expect(() => new FixedStepService('bad', 1.5)).toThrow('tickRateMs');
        expect(() => new FixedStepService('bad', 10, 0)).toThrow('maxCatchUpTicks');
        expect(() => new FixedStepService('bad', 10, 1.5)).toThrow('maxCatchUpTicks');
        expect(() => new FixedStepService('bad', 10, 1, 9)).toThrow('maxRetainedLagMs');
        const errors = [];
        let now = 0;
        let release;
        const blocked = new Promise(resolve => { release = resolve; });
        class GameLoop extends FixedStepService {
            now() { return now; }
            onLagDropped(value) { this.dropped = value; }
            async onTick(step, tick) {
                this.calls ||= [];
                this.calls.push([step, tick]);
                if (tick === 1) await blocked;
                if (tick === 2) throw new Error('tick failed');
            }
        }
        const service = new GameLoop('game', 10, 2);
        const observed = [];
        service.onInit({
            logger: { error: (_message, error) => errors.push(error.message) },
            metrics: { observe: (...args) => observed.push(args) },
        });
        now = 35;
        const running = service.pulse();
        expect(service.pulse()).toBe(running);
        release();
        await running;
        expect(service.calls).toEqual([[10, 1], [10, 2]]);
        expect(errors).toEqual(['tick failed']);
        expect(service.accumulatorMs).toBe(0);
        expect(service.dropped).toBe(15);
        expect(observed).toEqual([['redweb.fixed_step.lag_dropped', 15]]);
        await service.onShutdown();

        const brokenLagHook = new GameLoop('broken-lag', 10, 1);
        brokenLagHook.onLagDropped = () => { throw new Error('lag hook failed'); };
        brokenLagHook.onInit({ logger: { error: (_message, error) => errors.push(error.message) } });
        now += 20;
        await brokenLagHook.pulse();
        await brokenLagHook.onShutdown();
        expect(errors).toContain('lag hook failed');
        await service.onShutdown();
        expect(service._tickHandle).toBeNull();
    });

    test('fixed-step services ignore sub-step and backward clock movement', async () => {
        let now = 10;
        class ClockedLoop extends FixedStepService { now() { return now; } }
        const service = new ClockedLoop('clock', 10);
        service.onInit({ logger: null });
        now = 5;
        await service.pulse();
        now = 14;
        await service.pulse();
        expect(service.tick).toBe(0);
        await service.onShutdown();
    });
});
