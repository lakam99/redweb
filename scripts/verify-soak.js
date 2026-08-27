const { performance } = require('perf_hooks');
const redweb = require('..');
const { silentLogger, waitFor, openClient, closeClient } = require('./realtime-harness');

const durationSeconds = Number(process.env.REDWEB_SOAK_SECONDS || 3600);
const clientCount = Number(process.env.REDWEB_SOAK_CLIENTS || 64);
const sampleSeconds = Number(process.env.REDWEB_SOAK_SAMPLE_SECONDS || 5);

if (!Number.isFinite(durationSeconds) || durationSeconds < 10) throw new Error('REDWEB_SOAK_SECONDS must be at least 10.');
if (!Number.isInteger(clientCount) || clientCount < 2) throw new Error('REDWEB_SOAK_CLIENTS must be at least 2.');
if (!Number.isFinite(sampleSeconds) || sampleSeconds < 1) throw new Error('REDWEB_SOAK_SAMPLE_SECONDS must be at least 1.');

class CycleHandler extends redweb.BaseHandler {
    constructor() { super('cycle'); }
    onMessage(socket, message) {
        socket.joinRoom(`room-${message.slot % 8}`);
        socket.createSession(`session-${message.generation}-${message.slot}`, { tick: message.tick });
        socket.sendJson({ tick: message.tick });
    }
}

class SoakRoute extends redweb.SocketRoute {
    constructor() {
        super({
            path: '/soak',
            handlers: [CycleHandler],
            allowDuplicateConnections: true,
            logger: silentLogger,
            orderedMessages: true,
            limits: {
                maxConnections: clientCount * 2,
                maxBufferedBytes: 256 * 1024,
                maxPendingMessages: 16,
                messageRate: { capacity: 100, refillPerSecond: 100, action: 'disconnect' },
            },
            heartbeat: { intervalMs: 1000, timeoutMs: 1000 },
            rooms: { maxRooms: 16, maxMembersPerRoom: clientCount * 2, maxRoomsPerConnection: 2 },
            sessions: { ttlMs: 2000, maxSessions: clientCount * 8, sweepIntervalMs: 250 },
            drainHandlers: true,
        });
    }
}

function median(values) {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.floor(sorted.length / 2)];
}

async function main() {
    if (typeof global.gc !== 'function') throw new Error('Run with node --expose-gc scripts/verify-soak.js.');
    const handlesBefore = process._getActiveHandles().length;
    const server = new redweb.SocketServer({ port: 0, bind: '127.0.0.1', routes: [SoakRoute], logger: silentLogger });
    if (!server.server.listening) await waitFor(server.server, 'listening');
    const route = server.routes[0];
    const url = `ws://127.0.0.1:${server.server.address().port}/soak`;
    const clients = await Promise.all(Array.from({ length: clientCount }, () => openClient(url)));
    const generations = new Array(clientCount).fill(0);
    const samples = [];
    let tick = 0;
    let stopped = false;
    let rotating = false;
    let rotationPromise = Promise.resolve();
    let rotationError;
    const received = new WeakMap();
    const attach = socket => {
        received.set(socket, 0);
        socket.on('message', () => received.set(socket, received.get(socket) + 1));
    };
    clients.forEach(attach);
    const traffic = setInterval(() => {
        clients.forEach((socket, slot) => {
            if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: 'cycle', slot, generation: generations[slot], tick }));
        });
        tick += 1;
    }, 100);
    traffic.unref();
    const rotation = setInterval(() => {
        if (stopped || rotating) return;
        rotating = true;
        rotationPromise = (async () => {
            const slot = tick % clientCount;
            try {
                const previous = clients[slot];
                await closeClient(previous);
                generations[slot] += 1;
                if (stopped) return;
                const replacement = await openClient(url);
                attach(replacement);
                clients[slot] = replacement;
            } catch (error) {
                rotationError = error;
                stopped = true;
            } finally {
                rotating = false;
            }
        })();
    }, 1000);
    rotation.unref();
    const sample = () => {
        global.gc();
        samples.push({
            elapsedSeconds: (performance.now() - startedAt) / 1000,
            heapUsed: process.memoryUsage().heapUsed,
            clients: route.clients.size,
            rooms: route.rooms.size,
            sessions: route.sessions.size,
            inFlight: route.inFlight.size,
            handles: process._getActiveHandles().length,
        });
    };
    const startedAt = performance.now();
    sample();
    const sampler = setInterval(sample, sampleSeconds * 1000);
    sampler.unref();
    try {
        await new Promise(resolve => setTimeout(resolve, durationSeconds * 1000));
    } finally {
        stopped = true;
        clearInterval(traffic);
        clearInterval(rotation);
        clearInterval(sampler);
        await rotationPromise;
        await Promise.all(clients.map(closeClient));
        await new Promise(resolve => setTimeout(resolve, 2500));
        sample();
        await server.shutdown();
    }
    if (rotationError) throw rotationError;
    global.gc();
    await new Promise(resolve => setImmediate(resolve));
    global.gc();
    const warmed = samples.slice(1, Math.max(2, Math.ceil(samples.length / 3))).map(entry => entry.heapUsed);
    const warmHeap = median(warmed.length ? warmed : samples.map(entry => entry.heapUsed));
    const final = samples[samples.length - 1];
    const peak = Math.max(...samples.map(entry => entry.heapUsed));
    const result = {
        durationSeconds,
        clientCount,
        messagesSent: tick * clientCount,
        samples: samples.length,
        warmHeap,
        peakHeap: peak,
        finalHeap: final.heapUsed,
        finalHeapPercentOfWarm: final.heapUsed / warmHeap * 100,
        finalRegistries: { clients: final.clients, rooms: final.rooms, sessions: final.sessions, inFlight: final.inFlight },
        handlesBefore,
        handlesAfter: process._getActiveHandles().length,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    const registriesClean = Object.values(result.finalRegistries).every(value => value === 0);
    if (!registriesClean || result.finalHeapPercentOfWarm > 110 || result.handlesAfter > handlesBefore + 1) process.exitCode = 1;
}

main().catch(error => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
});
