'use strict';

const path = require('node:path');
const { MemoryMeasurement } = require('./lib/MemoryMeasurement');
const { VerificationWorkspace } = require('./lib/VerificationWorkspace');

async function main() {
    // Validate before creating a workspace or launching any worker.
    const policy = new MemoryMeasurement();
    const result = await new VerificationWorkspace().run(async owner => {
        const measurements = { legacy: [], enabled: [] };
        for (let index = 0; index < policy.trials; index += 1) {
            const order = index % 2 ? ['enabled', 'legacy'] : ['legacy', 'enabled'];
            for (const mode of order) {
                const output = await owner.command(['--expose-gc', path.join(__dirname, 'memory-worker.js'), mode, String(policy.count)],
                    { timeoutMs: 60000, rejectTruncatedOutput: true });
                measurements[mode].push(policy.decode(output, mode).bytesPerConnection);
            }
        }
        return policy.summarize(measurements);
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.frameworkMetadataBytesPerConnection > result.maximumFrameworkMetadataBytesPerConnection) process.exitCode = 1;
}

main().catch(error => {
    process.stderr.write(`${require('./diagnostics/recovery-split.cjs').describeFailure(error)}\n`);
    process.exitCode = 1;
});
