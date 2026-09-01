const redweb = require('..');
const { WebSocket, silentLogger, waitFor, closeClient } = require('./realtime-harness');
const { MemoryMeasurement } = require('./lib/MemoryMeasurement');
const { verificationError } = require('./lib/verificationError');

const mode = MemoryMeasurement.mode(process.argv[2]);
const count = MemoryMeasurement.count(process.argv[3] ?? 500);
if (typeof global.gc !== 'function') throw new Error('Run with --expose-gc.');

class IdleHandler extends redweb.BaseHandler {
    constructor() { super('idle'); }
    onMessage() {}
}

class IdleRoute extends redweb.SocketRoute {
    constructor() {
        const enabled = mode === 'enabled';
        const uses = feature => enabled || mode === feature;
        super({
            path: '/idle',
            handlers: [IdleHandler],
            allowDuplicateConnections: true,
            logger: silentLogger,
            ...(uses('context') ? { admission: () => ({ player: true }) } : {}),
            ...(uses('transport') ? { limits: {
                    maxConnections: count + 1,
                    maxBufferedBytes: 64 * 1024,
                    maxPendingMessages: 8,
                    messageRate: { capacity: 10, refillPerSecond: 10 },
                }, orderedMessages: true } : {}),
            ...(uses('heartbeat') ? { heartbeat: { intervalMs: 30_000, timeoutMs: 10_000 } } : {}),
            ...(uses('rooms') ? { rooms: { maxRooms: 2, maxMembersPerRoom: count + 1, maxRoomsPerConnection: 1 } } : {}),
            ...(uses('sessions') ? { sessions: { maxSessions: count + 1, ttlMs: 30_000 } } : {}),
            ...(uses('drain') ? { drainHandlers: true } : {}),
            ...(uses('protocol') ? { protocol: { versions: ['1'] } } : {}),
        });
    }
}

async function collect() {
    global.gc();
    await new Promise(resolve => setImmediate(resolve));
    global.gc();
    return process.memoryUsage().heapUsed;
}

async function main() {
    const server = new redweb.SocketServer({ port: 0, bind: '127.0.0.1', routes: [IdleRoute], logger: silentLogger });
    let clients, result, failure;
    try {
        if (!server.server.listening) await waitFor(server.server, 'listening');
        const before = await collect();
        const suffix = mode === 'enabled' || mode === 'protocol' ? '?redwebVersion=1' : '';
        const url = `ws://127.0.0.1:${server.server.address().port}/idle${suffix}`;
        clients = [];
        for (let offset = 0; offset < count; offset += 50) {
            await Promise.all(Array.from({ length: Math.min(50, count - offset) }, async () => {
                const client = new WebSocket(url);
                clients.push(client); // Own connecting peers even if another member of this batch fails.
                await waitFor(client, 'open');
            }));
        }
        await new Promise(resolve => setImmediate(resolve));
        const after = await collect();
        result = { mode, count, heapDelta: after - before, bytesPerConnection: (after - before) / count };
    } catch (error) { failure = verificationError(error); }
    const closed = await Promise.allSettled((clients || []).map(async client => {
        await closeClient(client);
        if (client.readyState !== WebSocket.CLOSED) await waitFor(client, 'close');
    }));
    try { await server.shutdown(); }
    catch (error) { closed.push({ status: 'rejected', reason: error }); }
    for (const outcome of closed) {
        if (outcome.status === 'rejected') {
            const error = verificationError(outcome.reason);
            failure = failure ? new AggregateError([failure, error], failure.message, { cause: failure }) : error;
        }
    }
    if (failure) throw failure;
    process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch(error => {
    process.stderr.write(`${require('./diagnostics/recovery-split.cjs').describeFailure(error)}\n`);
    process.exitCode = 1;
});
