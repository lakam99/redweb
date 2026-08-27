const { spawnSync } = require('child_process');
const path = require('path');

const worker = path.join(__dirname, 'memory-worker.js');
const count = process.env.REDWEB_MEMORY_CLIENTS || '500';
const trials = Number(process.env.REDWEB_MEMORY_TRIALS || 3);
const maximumBytes = Number(process.env.REDWEB_MEMORY_MAX_BYTES || 2048);
if (!Number.isInteger(trials) || trials < 3) throw new Error('REDWEB_MEMORY_TRIALS must be at least 3.');
if (!Number.isFinite(maximumBytes) || maximumBytes < 1) throw new Error('REDWEB_MEMORY_MAX_BYTES must be positive.');

function run(mode) {
    const result = spawnSync(process.execPath, ['--expose-gc', worker, mode, count], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || `memory worker exited ${result.status}`);
    return JSON.parse(result.stdout.trim().split(/\r?\n/).pop());
}

function median(values) {
    return [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];
}

const measurements = { legacy: [], enabled: [] };
for (let index = 0; index < trials; index += 1) {
    const order = index % 2 ? ['enabled', 'legacy'] : ['legacy', 'enabled'];
    order.forEach(mode => measurements[mode].push(run(mode).bytesPerConnection));
}
const result = {
    connections: Number(count),
    trials,
    legacyBytesPerConnection: median(measurements.legacy),
    enabledBytesPerConnection: median(measurements.enabled),
};
result.frameworkMetadataBytesPerConnection = result.enabledBytesPerConnection - result.legacyBytesPerConnection;
result.maximumFrameworkMetadataBytesPerConnection = maximumBytes;
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.frameworkMetadataBytesPerConnection > maximumBytes) process.exitCode = 1;
