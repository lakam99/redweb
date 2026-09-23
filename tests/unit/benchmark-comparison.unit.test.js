'use strict';

const { BenchmarkComparison } = require('../../scripts/lib/BenchmarkComparison');
const { BenchmarkWorkload } = require('../../scripts/lib/BenchmarkWorkload');

const identity = { moduleRoot: '/fixture', moduleEntry: '/fixture/index.js', entrySha256: 'a'.repeat(64), manifestSha256: 'b'.repeat(64),
    moduleVersion: '1.0.0', harnessWebSocketResolution: '/client/ws/index.js', rootWebSocketResolution: '/server/ws/index.js', node: 'v22', nodePath: '' };
const result = (overrides = {}) => ({ messages: 20000, concurrency: 128, warmupSent: 2000, warmupReceived: 2000,
    sent: 20000, received: 20000, throughput: 100, p99Ms: 100, identity: { ...identity }, ...overrides });
const configuration = { REDWEB_BENCHMARK_TRIALS: '3' };

test('benchmark configuration retains workload/warm-up/trial defaults and rejects unsafe arithmetic', () => {
    const environment = process.env;
    try {
        process.env = {};
        expect(new BenchmarkComparison()).toMatchObject({ trials: 5, workload: { messages: 20000, concurrency: 128, warmupMessages: 2000 } });
    } finally { process.env = environment; }
    expect(new BenchmarkWorkload(1000, 1).warmupMessages).toBe(200);
    expect(new BenchmarkWorkload(3000, 1).warmupMessages).toBe(300);
    for (const count of [999, 0, -1, 1000.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => new BenchmarkWorkload(count)).toThrow('message count');
    for (const width of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => new BenchmarkWorkload(1000, width)).toThrow('concurrency');
    expect(() => new BenchmarkWorkload(Number.MAX_SAFE_INTEGER, 1)).toThrow('warm-up IDs');
    for (const trials of ['0', '2', '-1', '3.5', 'NaN', 'Infinity', String(Number.MAX_SAFE_INTEGER)]) {
        expect(() => new BenchmarkComparison({ REDWEB_BENCHMARK_TRIALS: trials })).toThrow('TRIALS');
    }
});

test('worker decoding rejects malformed, incomplete, non-finite and wrong-identity evidence', () => {
    const policy = new BenchmarkComparison(configuration);
    expect(policy.decode(JSON.stringify(result()), '/fixture')).toEqual(result());
    for (const output of ['{', '{}\n{}', 'noise\n{}', 'null', 'false', '[]']) expect(() => policy.decode(output, '/fixture')).toThrow();
    for (const key of ['messages', 'concurrency', 'warmupSent', 'warmupReceived', 'sent', 'received']) {
        expect(() => policy.decode(JSON.stringify(result({ [key]: 1 })), '/fixture')).toThrow('delivery');
    }
    for (const key of ['throughput', 'p99Ms']) for (const value of [null, '100', 0, -1, NaN, Infinity]) {
        expect(() => policy.decode(JSON.stringify(result({ [key]: value })), '/fixture')).toThrow('positive and finite');
    }
    for (const value of [null, [], false, { ...identity, moduleRoot: '/wrong' }]) {
        expect(() => policy.decode(JSON.stringify(result({ identity: value })), '/fixture')).toThrow('identity');
    }
    for (const key of ['moduleRoot', 'moduleEntry', 'entrySha256', 'manifestSha256', 'moduleVersion', 'harnessWebSocketResolution', 'rootWebSocketResolution', 'node']) {
        for (const value of ['', 1]) expect(() => policy.decode(JSON.stringify(result({ identity: { ...identity, [key]: value } })), '/fixture')).toThrow('identity');
    }
    for (const value of [{ ...identity, nodePath: null }, { ...identity, entrySha256: 'invalid' }, { ...identity, manifestSha256: 'invalid' }]) {
        expect(() => policy.decode(JSON.stringify(result({ identity: value })), '/fixture')).toThrow('identity');
    }
});

test('complete paired trials retain upper medians and unchanged threshold boundaries', () => {
    const policy = new BenchmarkComparison(configuration);
    const baseline = [result({ throughput: 120 }), result(), result({ throughput: 80 })];
    const candidate = [result({ throughput: 97, p99Ms: 105 }), result({ throughput: 96, p99Ms: 106 }), result({ throughput: 98, p99Ms: 104 })];
    const summary = policy.summarize({ baseline, candidate });
    expect(summary).toEqual({ baseline: { throughput: 100, p99Ms: 100 }, candidate: { throughput: 97, p99Ms: 105 },
        throughputRegressionPercent: 3, p99RegressionPercent: 5, thresholds: { throughputRegressionPercent: 3, p99RegressionPercent: 5 } });
    expect(policy.passed(summary)).toBe(true);
    expect(policy.passed({ ...summary, throughputRegressionPercent: 3.001 })).toBe(false);
    expect(policy.passed({ ...summary, p99RegressionPercent: 5.001 })).toBe(false);
    for (const values of [undefined, [], [result()]]) expect(() => policy.summarize({ baseline: values, candidate })).toThrow('trials');
    expect(() => policy.summarize({ baseline: [undefined, result(), result()], candidate })).toThrow();
    expect(() => policy.summarize({ baseline, candidate: [result({ identity: { ...identity, node: 'changed' } }), result(), result()] })).toThrow('changed between trials');
    for (const key of ['throughput', 'p99Ms']) {
        const tiny = Array.from({ length: 3 }, () => result({ [key]: Number.MIN_VALUE }));
        const huge = Array.from({ length: 3 }, () => result({ [key]: Number.MAX_VALUE }));
        expect(() => policy.summarize({ baseline: tiny, candidate: huge })).toThrow('Non-finite');
    }
});
