const { spawnSync } = require('child_process');
const path = require('path');

const baseline = process.argv[2];
const candidate = process.argv[3] || path.join(__dirname, '..');
const messages = process.env.REDWEB_BENCHMARK_MESSAGES || '20000';
const concurrency = process.env.REDWEB_BENCHMARK_CONCURRENCY || '128';
const trials = Number(process.env.REDWEB_BENCHMARK_TRIALS || 5);
const worker = path.join(__dirname, 'benchmark-worker.js');

if (!baseline) {
    process.stderr.write('Usage: node scripts/verify-disabled-overhead.js <baseline-directory> [candidate-directory]\n');
    process.exit(2);
}
if (!Number.isInteger(trials) || trials < 3) throw new Error('REDWEB_BENCHMARK_TRIALS must be at least 3.');

function run(directory) {
    const result = spawnSync(process.execPath, [worker, path.resolve(directory), messages, concurrency], {
        encoding: 'utf8',
        env: { ...process.env, NODE_PATH: path.join(path.resolve(candidate), 'node_modules') },
    });
    if (result.status !== 0) throw new Error(result.stderr || `benchmark exited ${result.status}`);
    return JSON.parse(result.stdout.trim().split(/\r?\n/).pop());
}

function median(values) {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.floor(sorted.length / 2)];
}

const results = { baseline: [], candidate: [] };
for (let index = 0; index < trials; index += 1) {
    const order = index % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'];
    for (const name of order) results[name].push(run(name === 'baseline' ? baseline : candidate));
}
const summary = {
    baseline: {
        throughput: median(results.baseline.map(result => result.throughput)),
        p99Ms: median(results.baseline.map(result => result.p99Ms)),
    },
    candidate: {
        throughput: median(results.candidate.map(result => result.throughput)),
        p99Ms: median(results.candidate.map(result => result.p99Ms)),
    },
};
summary.throughputRegressionPercent = (summary.baseline.throughput - summary.candidate.throughput) / summary.baseline.throughput * 100;
summary.p99RegressionPercent = (summary.candidate.p99Ms - summary.baseline.p99Ms) / summary.baseline.p99Ms * 100;
summary.thresholds = { throughputRegressionPercent: 3, p99RegressionPercent: 5 };
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (summary.throughputRegressionPercent > 3 || summary.p99RegressionPercent > 5) process.exitCode = 1;
