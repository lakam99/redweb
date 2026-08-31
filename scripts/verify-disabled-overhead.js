'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { BenchmarkComparison } = require('./lib/BenchmarkComparison');
const { VerificationWorkspace } = require('./lib/VerificationWorkspace');

async function main() {
    if (!process.argv[2]) {
        process.stderr.write('Usage: node scripts/verify-disabled-overhead.js <baseline-directory> [candidate-directory]\n');
        process.exitCode = 2;
        return;
    }
    const policy = new BenchmarkComparison();
    const directories = { baseline: fs.realpathSync(path.resolve(process.argv[2])),
        candidate: fs.realpathSync(path.resolve(process.argv[3] || path.join(__dirname, '..'))) };
    const results = await new VerificationWorkspace().run(async owner => {
        const measurements = { baseline: [], candidate: [] };
        for (let index = 0; index < policy.trials; index++) {
            const order = index % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'];
            for (const name of order) {
                const output = await owner.command([path.join(__dirname, 'benchmark-worker.js'), directories[name],
                    String(policy.workload.messages), String(policy.workload.concurrency)], {
                    timeoutMs: 120000, rejectTruncatedOutput: true,
                    environment: { NODE_PATH: path.join(directories.candidate, 'node_modules') },
                });
                measurements[name].push(policy.decode(output, directories[name]));
            }
        }
        return measurements;
    });
    const summary = policy.summarize(results);
    summary.trials = results;
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (!policy.passed(summary)) process.exitCode = 1;
}

main().catch(error => {
    process.stderr.write(`${require('./diagnostics/recovery-split.cjs').describeFailure(error)}\n`);
    process.exitCode = 1;
});
