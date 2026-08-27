const { performance } = require('perf_hooks');
const path = require('path');
const WebSocket = require('ws');

const moduleRoot = path.resolve(process.argv[2]);
const totalMessages = Number(process.argv[3] || 20_000);
const concurrency = Number(process.argv[4] || 128);
const warmupMessages = Math.min(2_000, Math.max(200, Math.floor(totalMessages / 10)));
const redweb = require(moduleRoot);
const silentLogger = { log() {}, warn() {}, error() {} };

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

function waitFor(server, event) {
    return new Promise((resolve, reject) => {
        server.once(event, resolve);
        server.once('error', reject);
    });
}

async function runBatch(socket, count, width, recordLatency) {
    const started = new Map();
    const latencies = [];
    let sent = 0;
    let received = 0;
    const startedAt = performance.now();
    return new Promise((resolve, reject) => {
        const sendNext = () => {
            while (sent < count && sent - received < width) {
                const id = sent++;
                if (recordLatency) started.set(id, performance.now());
                socket.send(JSON.stringify({ type: 'echo', id }));
            }
        };
        const onMessage = data => {
            try {
                const { id } = JSON.parse(data.toString());
                if (recordLatency) latencies.push(performance.now() - started.get(id));
                started.delete(id);
                received += 1;
                if (received === count) {
                    socket.off('message', onMessage);
                    return resolve({ elapsedMs: performance.now() - startedAt, latencies });
                }
                sendNext();
            } catch (error) {
                reject(error);
            }
        };
        socket.on('message', onMessage);
        sendNext();
    });
}

async function main() {
    if (!Number.isInteger(totalMessages) || totalMessages < 1000) throw new Error('message count must be at least 1000');
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('concurrency must be positive');
    const server = new redweb.SocketServer({
        port: 0,
        bind: '127.0.0.1',
        routes: [EchoRoute],
        logger: silentLogger,
    });
    if (!server.server.listening) await waitFor(server.server, 'listening');
    const port = server.server.address().port;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/benchmark`);
    await waitFor(socket, 'open');
    try {
        await runBatch(socket, warmupMessages, concurrency, false);
        const result = await runBatch(socket, totalMessages, concurrency, true);
        result.latencies.sort((left, right) => left - right);
        const p99Index = Math.min(result.latencies.length - 1, Math.ceil(result.latencies.length * 0.99) - 1);
        process.stdout.write(`${JSON.stringify({
            throughput: totalMessages / (result.elapsedMs / 1000),
            p99Ms: result.latencies[p99Index],
            messages: totalMessages,
            concurrency,
        })}\n`);
    } finally {
        socket.terminate();
        await server.shutdown();
    }
}

main().catch(error => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
});
