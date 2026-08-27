const redweb = require('..');
const { silentLogger, waitFor, openClient, closeClient } = require('./realtime-harness');

const warmConnections = Number(process.env.REDWEB_RECOVERY_WARM_CONNECTIONS || 200);
const stormConnections = Number(process.env.REDWEB_RECOVERY_STORM_CONNECTIONS || 1200);
const batchSize = Number(process.env.REDWEB_RECOVERY_BATCH_SIZE || 50);
if (typeof global.gc !== 'function') throw new Error('Run with node --expose-gc scripts/verify-recovery.js.');

class ReconnectHandler extends redweb.BaseHandler {
    constructor() { super('connect'); }
    onMessage(socket, message) {
        socket.joinRoom(`room-${message.id % 8}`);
        socket.createSession(`session-${message.id}`, { id: message.id });
        socket.sendJson({ ready: message.id });
    }
}

class ReconnectRoute extends redweb.SocketRoute {
    constructor() {
        super({
            path: '/reconnect',
            handlers: [ReconnectHandler],
            allowDuplicateConnections: true,
            logger: silentLogger,
            orderedMessages: true,
            limits: { maxConnections: batchSize * 2, maxPendingMessages: 4 },
            rooms: { maxRooms: 8, maxMembersPerRoom: batchSize * 2, maxRoomsPerConnection: 1 },
            sessions: { ttlMs: 250, sweepIntervalMs: 50, maxSessions: stormConnections + warmConnections },
        });
    }
}

async function collectHeap() {
    global.gc();
    await new Promise(resolve => setImmediate(resolve));
    global.gc();
    return process.memoryUsage().heapUsed;
}

async function waitUntil(predicate, message, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() >= deadline) throw new Error(message);
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}

async function runConnections(route, url, start, count) {
    for (let offset = 0; offset < count; offset += batchSize) {
        const current = Math.min(batchSize, count - offset);
        const clients = await Promise.all(Array.from({ length: current }, () => openClient(url)));
        await Promise.all(clients.map((socket, index) => new Promise((resolve, reject) => {
            const id = start + offset + index;
            socket.once('message', resolve);
            socket.once('error', reject);
            socket.send(JSON.stringify({ type: 'connect', id }));
        })));
        await Promise.all(clients.map(closeClient));
        await waitUntil(() => route.clients.size === 0, 'server-side connection cleanup timed out');
    }
}

async function main() {
    const server = new redweb.SocketServer({ port: 0, bind: '127.0.0.1', routes: [ReconnectRoute], logger: silentLogger });
    try {
        if (!server.server.listening) await waitFor(server.server, 'listening');
        const route = server.routes[0];
        const url = `ws://127.0.0.1:${server.server.address().port}/reconnect`;
        await runConnections(route, url, 0, warmConnections);
        await new Promise(resolve => setTimeout(resolve, 400));
        const warmedHeap = await collectHeap();
        await runConnections(route, url, warmConnections, stormConnections);
        await new Promise(resolve => setTimeout(resolve, 400));
        const recoveredHeap = await collectHeap();
        const result = {
            warmConnections,
            stormConnections,
            warmedHeap,
            recoveredHeap,
            recoveredHeapPercentOfWarm: recoveredHeap / warmedHeap * 100,
            registries: { clients: route.clients.size, rooms: route.rooms.size, sessions: route.sessions.size },
        };
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        if (Object.values(result.registries).some(value => value !== 0) || result.recoveredHeapPercentOfWarm > 110) {
            throw new Error('Reconnect recovery exceeded its cleanup or retained-heap budget.');
        }
    } finally {
        await server.shutdown();
    }
}

main().catch(error => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
});
