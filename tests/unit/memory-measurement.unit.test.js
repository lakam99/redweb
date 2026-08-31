'use strict';

const { MemoryMeasurement } = require('../../scripts/lib/MemoryMeasurement');

test('memory policy retains default workload and accepts explicit configuration', () => {
    const environment = process.env;
    try {
        process.env = {};
        expect(new MemoryMeasurement()).toEqual({ count: 500, trials: 3, maximumBytes: 2048 });
    } finally { process.env = environment; }
    expect(new MemoryMeasurement({ REDWEB_MEMORY_CLIENTS: '4', REDWEB_MEMORY_TRIALS: '4', REDWEB_MEMORY_MAX_BYTES: '1024' }))
        .toEqual({ count: 4, trials: 4, maximumBytes: 1024 });
});

test.each(['0', '-1', 'NaN', 'Infinity', '1.2', '', String(Number.MAX_SAFE_INTEGER), '9007199254740992'])
('rejects invalid memory client count %p', value => {
    expect(() => MemoryMeasurement.count(value)).toThrow('positive safe integer');
    expect(() => new MemoryMeasurement({ REDWEB_MEMORY_CLIENTS: value })).toThrow('positive safe integer');
});

test.each(['0', '2', '2.5', '', 'NaN', 'Infinity', '9007199254740992', String(Number.MAX_SAFE_INTEGER)])
('rejects invalid trial count %p', value => {
    expect(() => new MemoryMeasurement({ REDWEB_MEMORY_TRIALS: value })).toThrow('safe trial count');
});

test.each(['0', '-1', '', 'NaN', 'Infinity'])('rejects invalid memory budget %p', value => {
    expect(() => new MemoryMeasurement({ REDWEB_MEMORY_MAX_BYTES: value })).toThrow('must be positive');
});

test('checks modes and arithmetic capacity without changing valid numeric input', () => {
    for (const mode of ['legacy', 'context', 'transport', 'heartbeat', 'rooms', 'sessions', 'drain', 'protocol', 'enabled']) {
        expect(MemoryMeasurement.mode(mode)).toBe(mode);
    }
    expect(() => MemoryMeasurement.mode('unknown')).toThrow('Unsupported');
    expect(MemoryMeasurement.count('2')).toBe(2);
    expect(MemoryMeasurement.count(Number.MAX_SAFE_INTEGER - 1)).toBe(Number.MAX_SAFE_INTEGER - 1);
});

test('strictly decodes one matching report and permits signed GC deltas', () => {
    const policy = new MemoryMeasurement({ REDWEB_MEMORY_CLIENTS: '4' });
    for (const heapDelta of [-9, 0, 9]) {
        const report = { mode: 'legacy', count: 4, heapDelta, bytesPerConnection: heapDelta / 4 };
        expect(policy.decode(JSON.stringify(report), 'legacy')).toEqual(report);
    }
    const report = { mode: 'legacy', count: 4, heapDelta: 8, bytesPerConnection: 2 };
    for (const invalid of [null, false, [], {}, { ...report, extra: true }, { ...report, mode: 'enabled' },
        { ...report, count: 0 }, { ...report, count: '4' }, { ...report, heapDelta: null },
        { ...report, heapDelta: 0.5 }, { ...report, heapDelta: Number.MAX_SAFE_INTEGER + 1 },
        { ...report, bytesPerConnection: null }, { ...report, bytesPerConnection: '2' },
        { ...report, bytesPerConnection: 3 }]) {
        expect(() => policy.decode(JSON.stringify(invalid), 'legacy')).toThrow();
    }
    expect(() => policy.decode('{', 'legacy')).toThrow();
    expect(() => policy.decode(JSON.stringify(report) + '\n' + JSON.stringify(report), 'legacy')).toThrow();
    expect(() => policy.decode('{"mode":"legacy","count":4,"heapDelta":8,"bytesPerConnection":1e999}', 'legacy')).toThrow('per-connection');
});

test('uses the existing upper median without modifying trials or clamping signed values', () => {
    const policy = new MemoryMeasurement({ REDWEB_MEMORY_TRIALS: '4' });
    const measurements = { legacy: [3, -3, 1, -1], enabled: [-2, 4, -4, -1] };
    const original = JSON.stringify(measurements);
    expect(policy.summarize(measurements)).toEqual({ connections: 500, trials: 4,
        legacyBytesPerConnection: 1, enabledBytesPerConnection: -1,
        frameworkMetadataBytesPerConnection: -2, maximumFrameworkMetadataBytesPerConnection: 2048 });
    expect(JSON.stringify(measurements)).toBe(original);
    for (const invalid of [null, [], [1, 2, 3, NaN], [1, 2, 3, Infinity]]) {
        expect(() => policy.summarize({ legacy: invalid, enabled: measurements.enabled })).toThrow('Missing or invalid');
    }
    expect(() => policy.summarize({ legacy: Array(4).fill(-Number.MAX_VALUE), enabled: Array(4).fill(Number.MAX_VALUE) }))
        .toThrow('Invalid memory comparison');
});
