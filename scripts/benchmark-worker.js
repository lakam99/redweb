const path = require('path');
const fs = require('fs');
const { createHash } = require('node:crypto');
const { silentLogger, waitFor, openClient, closeClient } = require('./realtime-harness');
const { BenchmarkWorkload } = require('./lib/BenchmarkWorkload');
const { BenchmarkBatch } = require('./lib/BenchmarkBatch');
const { measureBenchmarkBatch } = require('./lib/measureBenchmarkBatch');
const { verificationError } = require('./lib/verificationError');

if (!process.argv[2]) throw new Error('A benchmark module directory is required.');
const moduleRoot = fs.realpathSync(path.resolve(process.argv[2]));
const workload = new BenchmarkWorkload(process.argv[3], process.argv[4]);
const { messages: totalMessages, concurrency, warmupMessages } = workload;
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const moduleEntry = fs.realpathSync(require.resolve(moduleRoot));
const manifest = path.join(moduleRoot, 'package.json');
// Capture before loading the measured implementation, then verify again after
// cleanup. These are entry/manifest identities, not a whole-library fingerprint.
const identity = {
    moduleRoot, moduleEntry, entrySha256: digest(moduleEntry), manifestSha256: digest(manifest),
    moduleVersion: JSON.parse(fs.readFileSync(manifest, 'utf8')).version,
    harnessWebSocketResolution: fs.realpathSync(require.resolve('ws')),
    rootWebSocketResolution: fs.realpathSync(require.resolve('ws', { paths: [moduleRoot] })),
    node: process.version, nodePath: process.env.NODE_PATH || '',
};
const redweb = require(moduleRoot);

class EchoHandler extends redweb.BaseHandler {
    constructor() { super('echo'); }
    onMessage(socket, message) { socket.sendJson({ id: message.id }); }
}

class EchoRoute extends redweb.SocketRoute {
    constructor() {
        super({
            path: '/benchmark',
            handlers: [EchoHandler],
            allowDuplicateConnections: true,
            logger: silentLogger,
        });
    }
}

async function main() {
    const server = new redweb.SocketServer({
        port: 0,
        bind: '127.0.0.1',
        routes: [EchoRoute],
        logger: silentLogger,
    });
    const failures = [];
    let socket, output;
    try {
        if (!server.server.listening) await waitFor(server.server, 'listening');
        const port = server.server.address().port;
        socket = await openClient(`ws://127.0.0.1:${port}/benchmark`);
        const warmup = await measureBenchmarkBatch(socket, new BenchmarkBatch(warmupMessages, concurrency, false));
        // Continue numeric IDs across phases, so a delayed warm-up reply cannot
        // be mistaken for a measured reply with a reused ID.
        const result = await measureBenchmarkBatch(socket, new BenchmarkBatch(totalMessages, concurrency, true, warmupMessages));
        result.latencies.sort((left, right) => left - right);
        const p99Index = Math.min(result.latencies.length - 1, Math.ceil(result.latencies.length * 0.99) - 1);
        output = {
            throughput: totalMessages / (result.elapsedMs / 1000),
            p99Ms: result.latencies[p99Index],
            messages: totalMessages,
            concurrency,
            warmupSent: warmup.sent, warmupReceived: warmup.received,
            sent: result.sent, received: result.received,
            identity,
        };
        if (!Number.isFinite(output.throughput) || output.throughput <= 0 || !Number.isFinite(output.p99Ms) || output.p99Ms <= 0) {
            throw new Error('Invalid benchmark worker measurement.');
        }
    } catch (error) { failures.push(verificationError(error)); }
    try { await closeClient(socket); } catch (error) { failures.push(verificationError(error)); }
    try { await server.shutdown(); } catch (error) { failures.push(verificationError(error)); }
    try {
        if (digest(moduleEntry) !== identity.entrySha256 || digest(manifest) !== identity.manifestSha256) {
            throw new Error('Benchmark module entry or manifest changed during measurement.');
        }
    } catch (error) { failures.push(verificationError(error)); }
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, failures[0].message, { cause: failures[0] });
    process.stdout.write(`${JSON.stringify(output)}\n`);
}

main().catch(error => {
    process.stderr.write(`${require('./diagnostics/recovery-split.cjs').describeFailure(error)}\n`);
    process.exitCode = 1;
});
