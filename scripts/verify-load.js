const { performance } = require('perf_hooks');
const redweb = require('..');
const { silentLogger, waitFor, openClient, closeClient } = require('./realtime-harness');

const clientCount = Number(process.env.REDWEB_LOAD_CLIENTS || 32);
const messagesPerClient = Number(process.env.REDWEB_LOAD_MESSAGES || 100);
const maximumP99Ms = Number(process.env.REDWEB_LOAD_MAX_P99_MS || 250);
const minimumMessagesPerSecond = Number(process.env.REDWEB_LOAD_MIN_MPS || 500);

if (!Number.isInteger(clientCount) || clientCount < 2) throw new Error('REDWEB_LOAD_CLIENTS must be at least 2.');
if (!Number.isInteger(messagesPerClient) || messagesPerClient < 1) throw new Error('REDWEB_LOAD_MESSAGES must be positive.');

class EchoHandler extends redweb.BaseHandler {
    constructor() { super('echo'); }
    onMessage(socket, message) { socket.sendJson({ id: message.id }); }
}

class SlowHandler extends redweb.BaseHandler {
    constructor() { super('slow'); }
    onMessage(socket) {
        const payload = 'x'.repeat(32 * 1024);
        let sends = 0;
        while (sends < 4096 && socket.sendJson({ payload })) sends += 1;
        socket.__slowConsumerSends = sends;
    }
}

class LoadRoute extends redweb.SocketRoute {
    constructor() {
        super({
            path: '/load',
            handlers: [EchoHandler, SlowHandler],
            allowDuplicateConnections: true,
            logger: silentLogger,
            orderedMessages: true,
            limits: {
                maxConnections: clientCount + 2,
                maxBufferedBytes: 64 * 1024,
                maxPendingMessages: messagesPerClient + 1,
                messageRate: { capacity: messagesPerClient + 1, refillPerSecond: messagesPerClient + 1 },
                slowConsumerAction: 'disconnect',
            },
            heartbeat: { intervalMs: 30_000, timeoutMs: 10_000 },
            drainHandlers: true,
        });
    }
}

function percentile(values, fraction) {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

async function main() {
    const server = new redweb.SocketServer({ port: 0, bind: '127.0.0.1', routes: [LoadRoute], logger: silentLogger });
    if (!server.server.listening) await waitFor(server.server, 'listening');
    const route = server.routes[0];
    const url = `ws://127.0.0.1:${server.server.address().port}/load`;
    const clients = await Promise.all(Array.from({ length: clientCount }, () => openClient(url)));
    const latencies = [];
    let received = 0;
    const sentAt = new Map();
    const nextSequence = new Array(clientCount).fill(0);
    const sendNext = (client, clientIndex) => {
        const sequence = nextSequence[clientIndex];
        if (sequence >= messagesPerClient) return;
        nextSequence[clientIndex] += 1;
        const id = `${clientIndex}:${sequence}`;
        sentAt.set(id, performance.now());
        client.send(JSON.stringify({ type: 'echo', id }));
    };
    const allReceived = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('load responses timed out')), 30_000);
        clients.forEach(client => client.on('message', raw => {
            const { id } = JSON.parse(raw);
            latencies.push(performance.now() - sentAt.get(id));
            received += 1;
            if (received === clientCount * messagesPerClient) {
                clearTimeout(timeout);
                resolve();
            } else sendNext(client, Number(id.split(':')[0]));
        }));
    });
    const startedAt = performance.now();
    clients.forEach(sendNext);
    await allReceived;
    const elapsedMs = performance.now() - startedAt;

    const slow = await openClient(url);
    slow._socket.pause();
    slow.send(JSON.stringify({ type: 'slow' }));
    await new Promise(resolve => setTimeout(resolve, 250));
    const serverSlowSocket = [...route.clients.values()].find(socket => socket.__slowConsumerSends !== undefined);
    const slowConsumerContained = Boolean(serverSlowSocket && serverSlowSocket.__slowConsumerSends < 4096 && serverSlowSocket.readyState !== serverSlowSocket.OPEN);
    slow._socket.resume();

    await Promise.all([...clients, slow].map(closeClient));
    await server.shutdown();
    const result = {
        clients: clientCount,
        messages: received,
        messagesPerSecond: received / elapsedMs * 1000,
        p99Ms: percentile(latencies, 0.99),
        slowConsumerContained,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.p99Ms > maximumP99Ms || result.messagesPerSecond < minimumMessagesPerSecond || !slowConsumerContained) {
        process.exitCode = 1;
    }
}

main().catch(error => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
});
