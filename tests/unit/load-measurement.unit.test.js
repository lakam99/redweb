'use strict';

const { LoadMeasurement } = require('../../scripts/lib/LoadMeasurement');
const configuration = { REDWEB_LOAD_CLIENTS: '2', REDWEB_LOAD_MESSAGES: '2' };

test('load policy retains defaults and validates configured numeric limits before allocation', () => {
    const environment = process.env;
    try {
        process.env = {};
        expect(new LoadMeasurement()).toMatchObject({ clientCount: 32, messagesPerClient: 100,
            maximumP99Ms: 250, minimumMessagesPerSecond: 500, expectedMessages: 3200 });
    } finally { process.env = environment; }
    for (const value of ['0', '1', '-1', '', 'NaN', 'Infinity', '2.5', String(Number.MAX_SAFE_INTEGER - 1), '9007199254740992']) {
        expect(() => new LoadMeasurement({ REDWEB_LOAD_CLIENTS: value })).toThrow('REDWEB_LOAD_CLIENTS');
    }
    for (const value of ['0', '-1', '', 'NaN', 'Infinity', '1.5', String(Number.MAX_SAFE_INTEGER), '9007199254740992']) {
        expect(() => new LoadMeasurement({ REDWEB_LOAD_MESSAGES: value })).toThrow('REDWEB_LOAD_MESSAGES');
    }
    expect(() => new LoadMeasurement({ REDWEB_LOAD_CLIENTS: '4294967296', REDWEB_LOAD_MESSAGES: '4294967296' })).toThrow('message total');
    for (const key of ['REDWEB_LOAD_MAX_P99_MS', 'REDWEB_LOAD_MIN_MPS']) {
        for (const value of ['0', '-1', '', 'NaN', 'Infinity']) {
            expect(() => new LoadMeasurement({ [key]: value })).toThrow('positive and finite');
        }
    }
});

test('per-client IDs are issued once and only exact outstanding replies advance accounting', () => {
    const measurement = new LoadMeasurement(configuration);
    for (const index of [-1, 2, NaN, 0.5]) expect(() => measurement.next(index, 0)).toThrow('client index');
    for (const now of [-1, NaN, Infinity]) expect(() => measurement.next(0, now)).toThrow('send timestamp');
    expect(measurement.next(0, 0)).toBe('0:0');
    expect(measurement.next(1, 0)).toBe('1:0');
    expect(() => measurement.next(0, 0)).toThrow('outstanding');
    for (const reply of [null, false, [], {}, { id: 1 }, { id: '0:0', extra: true }, { id: 'unknown' }, { id: '1:0' }]) {
        expect(() => measurement.receive(0, reply, 1)).toThrow();
        expect(measurement.received).toBe(0);
        expect(measurement.pending.size).toBe(2);
    }
    for (const now of [NaN, Infinity, -1]) expect(() => measurement.receive(0, { id: '0:0' }, now)).toThrow('latency');
    expect(measurement.receive(0, { id: '0:0' }, 1)).toBe(false);
    expect(() => measurement.receive(0, { id: '0:0' }, 2)).toThrow('duplicate');
    expect(measurement.next(0, 2)).toBe('0:1');
    expect(() => measurement.receive(0, { id: '0:0' }, 3)).toThrow('duplicate');
    expect(measurement.receive(0, { id: '0:1' }, 4)).toBe(false);
    expect(measurement.next(0, 5)).toBeNull();
    expect(measurement.receive(1, { id: '1:0' }, 2)).toBe(false);
    expect(measurement.next(1, 3)).toBe('1:1');
    expect(measurement.receive(1, { id: '1:1' }, 4)).toBe(true);
    expect(measurement.pending.size).toBe(0);
    expect(measurement.summarize(4, true)).toEqual({ clients: 2, messages: 4, messagesPerSecond: 1000, p99Ms: 2, slowConsumerContained: true });
});

test('completion, elapsed time and derived metrics must be complete and finite', () => {
    const measurement = new LoadMeasurement(configuration);
    expect(() => measurement.summarize(1, true)).toThrow('Incomplete');
    // Explicit unit corruption checks ensure partial evidence cannot pass merely
    // because one total was set. Ordinary integration uses only public methods.
    measurement.received = 4; measurement.pending.set(0, {});
    expect(() => measurement.summarize(1, true)).toThrow('Incomplete');
    measurement.pending.clear();
    expect(() => measurement.summarize(1, true)).toThrow('Incomplete');
    measurement.sequences.fill(2);
    expect(() => measurement.summarize(1, true)).toThrow('Incomplete');
    measurement.latencies = [1, 2, 3, 4];
    for (const elapsed of [0, -1, NaN, Infinity]) expect(() => measurement.summarize(elapsed, true)).toThrow('elapsed time');
    expect(() => measurement.summarize(1, undefined)).toThrow('slow-consumer');
    expect(() => measurement.summarize(Number.MIN_VALUE, true)).toThrow('Invalid load result');
    measurement.latencies.fill(Infinity);
    expect(() => measurement.summarize(1, true)).toThrow('Invalid load result');
    measurement.latencies.fill(-1);
    expect(() => measurement.summarize(1, true)).toThrow('Invalid load result');
});

test('acceptance preserves latency, throughput and slow-consumer requirements at their boundaries', () => {
    const measurement = new LoadMeasurement({ ...configuration, REDWEB_LOAD_MAX_P99_MS: '10', REDWEB_LOAD_MIN_MPS: '100' });
    expect(measurement.passed({ p99Ms: 10, messagesPerSecond: 100, slowConsumerContained: true })).toBe(true);
    expect(measurement.passed({ p99Ms: 11, messagesPerSecond: 100, slowConsumerContained: true })).toBe(false);
    expect(measurement.passed({ p99Ms: 10, messagesPerSecond: 99, slowConsumerContained: true })).toBe(false);
    expect(measurement.passed({ p99Ms: 10, messagesPerSecond: 100, slowConsumerContained: false })).toBe(false);
});
