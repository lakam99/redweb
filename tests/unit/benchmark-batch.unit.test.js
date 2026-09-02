'use strict';

const { BenchmarkBatch } = require('../../scripts/lib/BenchmarkBatch');

test('benchmark batches validate their window, timestamp and disjoint ID range', () => {
    for (const count of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => new BenchmarkBatch(count, 1, true)).toThrow('batch size');
    for (const width of [0, -1, 1.5, Infinity]) expect(() => new BenchmarkBatch(1, width, true)).toThrow('window');
    for (const offset of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER]) expect(() => new BenchmarkBatch(1, 1, true, offset)).toThrow('ID range');
    expect(() => new BenchmarkBatch(1, 1, 'true')).toThrow('latency mode');
    const batch = new BenchmarkBatch(3, 2, true, 200);
    for (const now of [-1, NaN, Infinity]) expect(() => batch.next(now)).toThrow('timestamp');
    expect(batch.next(0)).toBe(200);
    expect(batch.next(1)).toBe(201);
    expect(batch.next(2)).toBeNull();
    for (const reply of [null, false, [], {}, { id: '200' }, { id: 200, extra: true }, { id: 0 }, { id: 202 }]) {
        expect(() => batch.receive(reply, 2)).toThrow('reply');
    }
    for (const now of [-1, NaN, Infinity]) expect(() => batch.receive({ id: 200 }, now)).toThrow('latency');
    expect(batch.receive({ id: 201 }, 3)).toBe(false); // Replies need not be ordered.
    expect(batch.next(4)).toBe(202);
    expect(() => batch.receive({ id: 201 }, 5)).toThrow('duplicate');
    expect(batch.receive({ id: 200 }, 5)).toBe(false);
    expect(batch.receive({ id: 202 }, 7)).toBe(true);
    expect(batch.next(8)).toBeNull();
    const result = batch.summarize(8);
    expect(result).toEqual({ sent: 3, received: 3, elapsedMs: 8, latencies: [2, 5, 3] });
    result.latencies.push(999);
    expect(batch.latencies).toEqual([2, 5, 3]);
});

test('warm-up replies are validated without recording measured latencies', () => {
    const batch = new BenchmarkBatch(1, 128, false);
    expect(batch.next(0)).toBe(0);
    expect(() => batch.receive({ id: 5 }, 1)).toThrow('reply');
    expect(batch.receive({ id: 0 }, 1)).toBe(true);
    expect(batch.summarize(2)).toEqual({ sent: 1, received: 1, elapsedMs: 2, latencies: [] });
});

test('partial or corrupted batch evidence cannot be summarized', () => {
    const batch = new BenchmarkBatch(1, 1, true);
    expect(() => batch.summarize(1)).toThrow('Incomplete');
    batch.next(0);
    expect(() => batch.summarize(1)).toThrow('Incomplete');
    // Explicit unit-state corruption probes each completion invariant.
    batch.received = 1;
    expect(() => batch.summarize(1)).toThrow('Incomplete');
    batch.pending.clear();
    expect(() => batch.summarize(1)).toThrow('Incomplete');
    batch.latencies.push(1);
    for (const elapsed of [0, -1, NaN, Infinity]) expect(() => batch.summarize(elapsed)).toThrow('elapsed');
});
