'use strict';

const assert = require('node:assert/strict');
const { BenchmarkWorkload } = require('./BenchmarkWorkload');

/** Validate evidence before calculating the unchanged median regression gates. */
class BenchmarkComparison {
    constructor(environment = process.env) {
        this.workload = new BenchmarkWorkload(environment.REDWEB_BENCHMARK_MESSAGES, environment.REDWEB_BENCHMARK_CONCURRENCY);
        this.trials = Number(environment.REDWEB_BENCHMARK_TRIALS ?? 5);
        assert(Number.isSafeInteger(this.trials) && this.trials >= 3 && Number.isSafeInteger(this.trials * 2),
            'REDWEB_BENCHMARK_TRIALS must be a safe integer of at least 3 with capacity for paired trials.');
    }

    decode(output, moduleRoot) {
        const result = JSON.parse(output);
        assert(result && typeof result === 'object' && !Array.isArray(result), 'Invalid benchmark worker result.');
        assert(result.messages === this.workload.messages && result.concurrency === this.workload.concurrency &&
            result.warmupSent === this.workload.warmupMessages && result.warmupReceived === result.warmupSent &&
            result.sent === result.messages && result.received === result.messages, 'Incomplete or mismatched benchmark delivery.');
        for (const key of ['throughput', 'p99Ms']) {
            assert(Number.isFinite(result[key]) && result[key] > 0, `Benchmark ${key} must be positive and finite.`);
        }
        assert(result.identity && typeof result.identity === 'object' && !Array.isArray(result.identity) &&
            result.identity.moduleRoot === moduleRoot, 'Mismatched benchmark module identity.');
        for (const key of ['moduleRoot', 'moduleEntry', 'entrySha256', 'manifestSha256', 'moduleVersion', 'harnessWebSocketResolution', 'rootWebSocketResolution', 'node']) {
            assert(typeof result.identity[key] === 'string' && result.identity[key].length > 0, 'Incomplete benchmark identity.');
        }
        assert(typeof result.identity.nodePath === 'string' && /^[a-f0-9]{64}$/.test(result.identity.entrySha256) &&
            /^[a-f0-9]{64}$/.test(result.identity.manifestSha256), 'Invalid benchmark identity.');
        return result;
    }

    summarize(results) {
        const summary = {};
        for (const name of ['baseline', 'candidate']) {
            assert(Array.isArray(results[name]) && results[name].length === this.trials, 'Incomplete benchmark trials.');
            const identity = results[name][0]?.identity;
            const validated = results[name].map(result => {
                const value = this.decode(JSON.stringify(result), identity?.moduleRoot);
                assert.deepEqual(value.identity, identity, 'Benchmark identity changed between trials.');
                return value;
            });
            const median = key => validated.map(result => result[key]).sort((left, right) => left - right)[Math.floor(this.trials / 2)];
            summary[name] = { throughput: median('throughput'), p99Ms: median('p99Ms') };
        }
        summary.throughputRegressionPercent = (summary.baseline.throughput - summary.candidate.throughput) / summary.baseline.throughput * 100;
        summary.p99RegressionPercent = (summary.candidate.p99Ms - summary.baseline.p99Ms) / summary.baseline.p99Ms * 100;
        assert(Number.isFinite(summary.throughputRegressionPercent) && Number.isFinite(summary.p99RegressionPercent), 'Non-finite benchmark comparison.');
        summary.thresholds = { throughputRegressionPercent: 3, p99RegressionPercent: 5 };
        return summary;
    }

    passed(summary) {
        return summary.throughputRegressionPercent <= 3 && summary.p99RegressionPercent <= 5;
    }
}

module.exports = { BenchmarkComparison };
