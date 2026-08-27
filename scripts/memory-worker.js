const redweb = require('..');
const { silentLogger, waitFor, openClient, closeClient } = require('./realtime-harness');

const mode = process.argv[2];
const count = Number(process.argv[3] || 500);
const modes = new Set(['legacy', 'context', 'transport', 'heartbeat', 'rooms', 'sessions', 'drain', 'protocol', 'enabled']);
if (!modes.has(mode)) throw new Error('unsupported memory measurement mode');
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
    if (!server.server.listening) await waitFor(server.server, 'listening');
    const before = await collect();
    const suffix = mode === 'enabled' || mode === 'protocol' ? '?redwebVersion=1' : '';
    const url = `ws://127.0.0.1:${server.server.address().port}/idle${suffix}`;
    const clients = [];
    for (let offset = 0; offset < count; offset += 50) {
        const batch = await Promise.all(Array.from({ length: Math.min(50, count - offset) }, () => openClient(url)));
        clients.push(...batch);
    }
    await new Promise(resolve => setImmediate(resolve));
    const after = await collect();
    process.stdout.write(`${JSON.stringify({ mode, count, heapDelta: after - before, bytesPerConnection: (after - before) / count })}\n`);
    await Promise.all(clients.map(closeClient));
    await server.shutdown();
}

main().catch(error => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
});
