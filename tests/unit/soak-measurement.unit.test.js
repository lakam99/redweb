'use strict';

const path = require('node:path');
const { SoakMeasurement } = require('../../scripts/lib/SoakMeasurement');
const samples = () => Array.from({ length: 7 }, (_, index) => ({ elapsedSeconds: index, heapUsed: 1000,
    clients: index === 6 ? 0 : 2, rooms: 0, sessions: 0, inFlight: 0, queued: 0, listeners: 0, ownedTimers: 0, handles: 1 }));
const summary = (measurement, input = samples(), counts = { sent: 100, received: 99 }, before = 1, after = 2) =>
    measurement.summarize(input, counts, before, after);

test('soak policy retains defaults, exact limits and missing-delivery accounting', () => {
    const environment = process.env;
    try {
        process.env = {};
        const policy = new SoakMeasurement();
        expect([policy.durationSeconds, policy.clientCount, policy.sampleSeconds]).toEqual([3600, 64, 5]);
        expect(new SoakMeasurement({}, path.resolve('coverage/soak.json'))).toEqual(policy);
        const result = summary(policy);
        expect(result.messagesMissing).toBe(1); expect(result.deliveryPercent).toBe(99); expect(policy.passed(result)).toBe(true);
        expect(result.trends.heapUsed).toEqual({ early: 1000, late: 1000, delta: 0, peak: 1000, allowedGrowth: 100, monotonicIncrease: false, passed: true });
        const boundary = samples(); boundary.at(-1).heapUsed = 1100;
        const boundaryResult = summary(policy, boundary);
        expect(boundaryResult.finalHeapPercentOfWarm).toBeCloseTo(110);
        expect(policy.passed(boundaryResult)).toBe(true);
    } finally { process.env = environment; }
});

test.each([
    ['REDWEB_SOAK_SECONDS', 'NaN'], ['REDWEB_SOAK_SECONDS', '9'], ['REDWEB_SOAK_SECONDS', '2147484'],
    ['REDWEB_SOAK_CLIENTS', '1'], ['REDWEB_SOAK_CLIENTS', '2.5'], ['REDWEB_SOAK_CLIENTS', '4294967296'],
    ['REDWEB_SOAK_CLIENTS', '9007199254740992'], ['REDWEB_SOAK_SAMPLE_SECONDS', 'NaN'],
    ['REDWEB_SOAK_SAMPLE_SECONDS', '0'], ['REDWEB_SOAK_SAMPLE_SECONDS', '1801'], ['REDWEB_SOAK_SECONDS', ''],
])('soak rejects invalid %s=%s before opening resources', (key, value) => {
    expect(() => new SoakMeasurement({ [key]: value })).toThrow();
});

test('soak rejects relative output and undersampled configurations', () => {
    expect(() => new SoakMeasurement({}, 'relative.json')).toThrow('absolute');
    expect(() => new SoakMeasurement({ REDWEB_SOAK_SECONDS: '10', REDWEB_SOAK_SAMPLE_SECONDS: '20' })).toThrow('two active-phase');
    expect(() => summary(new SoakMeasurement(), samples().slice(0, 3))).toThrow('Insufficient');
    expect(() => new SoakMeasurement({ REDWEB_SOAK_SECONDS: '2147483.647', REDWEB_SOAK_CLIENTS: '4294967295' })).toThrow('delivery-counter');
});

test.each(['missing', 'fractional', 'zero-heap', 'negative-time', 'infinite-time', 'reversed-time'])
('soak rejects %s sample evidence', mode => {
    const input = samples();
    if (mode === 'missing') delete input[1].rooms;
    if (mode === 'fractional') input[1].heapUsed = 1.5;
    if (mode === 'zero-heap') input[1].heapUsed = 0;
    if (mode === 'negative-time') input[1].elapsedSeconds = -1;
    if (mode === 'infinite-time') input[1].elapsedSeconds = Infinity;
    if (mode === 'reversed-time') input[2].elapsedSeconds = 0;
    expect(() => summary(new SoakMeasurement(), input)).toThrow();
});

test.each([{ sent: 0, received: 0 }, { sent: NaN, received: 0 }, { sent: 1, received: -1 },
    { sent: 1, received: 1.5 }, { sent: 1, received: 2 }])('soak rejects invalid delivery %p', counts => {
    expect(() => summary(new SoakMeasurement(), samples(), counts)).toThrow('delivery');
});

test.each([-1, NaN, 1.5])('soak rejects invalid handle count %p', count => {
    expect(() => summary(new SoakMeasurement(), samples(), undefined, count)).toThrow('handle');
});

test.each(['registries', 'delivery', 'heap', 'handles', 'monotonic', 'nonmonotonic'])
('soak keeps failing %s evidence visible', mode => {
    const policy = new SoakMeasurement(), input = samples();
    if (mode === 'monotonic') input.forEach((sample, index) => { sample.rooms = index; });
    if (mode === 'nonmonotonic') { input[2].rooms = 2; input[3].rooms = 0; input[4].rooms = 3; input[5].rooms = 4; }
    const result = summary(policy, input);
    if (mode === 'registries') result.finalRegistries.clients = 1;
    if (mode === 'delivery') result.messagesReceived = 98;
    if (mode === 'heap') result.finalHeap = 1101;
    if (mode === 'handles') result.handlesAfter = 3;
    expect(policy.passed(result)).toBe(false);
    if (mode === 'monotonic') expect(result.trends.rooms.monotonicIncrease).toBe(true);
    if (mode === 'nonmonotonic') expect(result.trends.rooms.monotonicIncrease).toBe(false);
});
