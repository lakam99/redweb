const redweb = require('..');
const { silentLogger, waitFor, openClient, closeClient } = require('./realtime-harness');

const warmConnections = Number(process.env.REDWEB_RECOVERY_WARM_CONNECTIONS ?? 200);
const stormConnections = Number(process.env.REDWEB_RECOVERY_STORM_CONNECTIONS ?? 1200);
const batchSize = Number(process.env.REDWEB_RECOVERY_BATCH_SIZE ?? 50);
// Keep the original acceptance protocol until the fixed candidate is reviewed
// across runtimes. Its warm-up is declared in advance, never adjusted to pass.
const protocol = process.env.REDWEB_RECOVERY_PROTOCOL ?? 'cold-v1';
if (!['cold-v1', 'steady-v2'].includes(protocol)) throw new TypeError('REDWEB_RECOVERY_PROTOCOL must be cold-v1 or steady-v2.');
const minimumRounds = protocol === 'steady-v2' ? 3 : 1;
const stormRounds = Number(process.env.REDWEB_RECOVERY_STORM_ROUNDS ?? minimumRounds);
if (!Number.isSafeInteger(stormRounds) || stormRounds < minimumRounds) {
    throw new TypeError(`REDWEB_RECOVERY_STORM_ROUNDS must be a safe integer of at least ${minimumRounds}.`);
}
const preconditioningConnections = protocol === 'steady-v2' ? stormConnections : 0;
for (const [name, value] of Object.entries({
    REDWEB_RECOVERY_WARM_CONNECTIONS: warmConnections,
    REDWEB_RECOVERY_STORM_CONNECTIONS: stormConnections,
    REDWEB_RECOVERY_BATCH_SIZE: batchSize,
})) {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive safe integer.`);
}
if (!Number.isSafeInteger(preconditioningConnections + warmConnections + stormConnections * stormRounds)) throw new RangeError('Combined recovery connection count must be a safe integer.');
if (!Number.isSafeInteger(batchSize * 2)) throw new RangeError('Recovery connection capacity must be a safe integer.');
const diagnostics = process.env.REDWEB_RECOVERY_DIAGNOSTICS === '1';
const v8 = diagnostics ? require('node:v8') : undefined;
const snapshotDirectory = process.env.REDWEB_RECOVERY_HEAP_DIRECTORY;
if (snapshotDirectory !== undefined && (!diagnostics || !require('node:path').isAbsolute(snapshotDirectory))) {
    throw new TypeError('Heap snapshots require diagnostics and an absolute REDWEB_RECOVERY_HEAP_DIRECTORY.');
}
if (typeof global.gc !== 'function') throw new Error('Run with node --expose-gc scripts/verify-recovery.js.');

// Opt-in observation only: these allocations can perturb the diagnostic run.
// Never subtract code bytes from the acceptance measurement or budget.
function diagnosticSnapshot(stage) {
    const sample = { spaces: v8.getHeapSpaceStatistics(), code: v8.getHeapCodeStatistics(), memory: process.memoryUsage() };
    // Raw snapshots may contain secrets. Use only in an isolated diagnostic process;
    // never publish the files. Capturing one adds GC/work, so this is not acceptance.
    if (snapshotDirectory !== undefined) {
        const filename = require('node:path').join(snapshotDirectory, `${stage}.heapsnapshot`);
        const descriptor = require('node:fs').openSync(filename, 'wx', 0o600);
        require('node:fs').closeSync(descriptor);
        v8.writeHeapSnapshot(filename);
    }
    return sample;
}

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
        const settle = async phase => {
            await new Promise(resolve => setTimeout(resolve, 400));
            const heap = await collectHeap();
            const registries = { clients: route.clients.size, rooms: route.rooms.size, sessions: route.sessions.size };
            if (Object.values(registries).some(value => value !== 0)) {
                throw new Error(`Recovery registries did not empty after ${phase}: ${JSON.stringify(registries)}`);
            }
            return { phase, heap, registries };
        };
        let preconditioning;
        if (preconditioningConnections) {
            await runConnections(route, url, 0, preconditioningConnections);
            preconditioning = await settle('preconditioning');
        }
        await runConnections(route, url, preconditioningConnections, warmConnections);
        const warm = await settle('warm');
        const warmedHeap = warm.heap;
        const warmDiagnostics = diagnostics ? diagnosticSnapshot('warm') : undefined;
        const cycles = [];
        for (let round = 0; round < stormRounds; round++) {
            await runConnections(route, url, preconditioningConnections + warmConnections + round * stormConnections, stormConnections);
            const cycle = await settle(`storm-${round + 1}`);
            cycles.push({ ...cycle, recoveredHeapPercentOfWarm: cycle.heap / warmedHeap * 100 });
        }
        const finalCycle = cycles[cycles.length - 1];
        const recoveredHeap = finalCycle.heap;
        const recoveredDiagnostics = diagnostics ? diagnosticSnapshot('recovered') : undefined;
        const result = {
            protocol,
            preconditioningConnections,
            stormRounds,
            warmConnections,
            stormConnections,
            ...(preconditioning ? { preconditioning } : {}),
            warm,
            cycles,
            warmedHeap,
            recoveredHeap,
            recoveredHeapPercentOfWarm: recoveredHeap / warmedHeap * 100,
            registries: { clients: route.clients.size, rooms: route.rooms.size, sessions: route.sessions.size },
            ...(diagnostics ? { diagnostics: { warm: warmDiagnostics, recovered: recoveredDiagnostics } } : {}),
        };
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        if (cycles.some(cycle => cycle.recoveredHeapPercentOfWarm > 110)) {
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
