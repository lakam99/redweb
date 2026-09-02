'use strict';

const { performance } = require('node:perf_hooks');
const fs = require('node:fs');
const redweb = require('..');
const { silentLogger, waitFor } = require('./realtime-harness');
const { SoakMeasurement } = require('./lib/SoakMeasurement');
const { SoakClients } = require('./lib/SoakClients');
const { verificationError } = require('./lib/verificationError');
const { withTimeout } = require('../tests/helpers/network');

const outputPath = process.argv[2];
const measurement = new SoakMeasurement(process.env, outputPath);
const { durationSeconds, clientCount, sampleSeconds } = measurement;

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

async function waitUntil(predicate, label, timeoutMs = 5000) {
    const deadline = performance.now() + timeoutMs;
    while (!predicate()) {
        if (performance.now() >= deadline) throw new Error(`Timed out waiting for ${label}.`);
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}

async function main() {
    if (typeof global.gc !== 'function') throw new Error('Run with node --expose-gc scripts/verify-soak.js.');
    const handlesBefore = process._getActiveHandles().length;
    const samples = [], failures = [], timers = [];
    let server, route, clients, sample, finish;
    let stopped = false, rotating = false, tick = 0;
    let rotationPromise = Promise.resolve();
    const fail = error => {
        const failure = verificationError(error);
        if (!failures.includes(failure)) failures.push(failure);
        finish?.();
    };
    const guard = operation => { try { operation(); } catch (error) { fail(error); } };
    const attempt = async operation => { try { await operation(); } catch (error) { fail(error); } };
    const interval = (operation, milliseconds) => {
        const timer = setInterval(() => guard(operation), milliseconds);
        timers.push(timer);
        timer.unref();
    };
    try {
        server = new redweb.SocketServer({ port: 0, bind: '127.0.0.1', routes: [SoakRoute], logger: silentLogger });
        if (!server.server.listening) await waitFor(server.server, 'listening');
        route = server.routes[0];
        clients = new SoakClients(`ws://127.0.0.1:${server.server.address().port}/soak`, clientCount, fail);
        await clients.openInitial();
        clients.check();
        const run = new Promise(resolve => { finish = resolve; });
        interval(() => { clients.sendTick(tick); tick++; }, 100);
        interval(() => {
            if (rotating) return;
            rotating = true;
            rotationPromise = (async () => {
                try { await clients.rotate(tick % clientCount, () => stopped); }
                catch (error) { fail(error); }
                finally { rotating = false; }
            })();
        }, 1000);
        const startedAt = performance.now();
        sample = () => {
            global.gc();
            const activeClients = [...new Set(route.clients.values())];
            samples.push({
                elapsedSeconds: (performance.now() - startedAt) / 1000,
                heapUsed: process.memoryUsage().heapUsed,
                clients: route.clients.size,
                rooms: route.rooms.size,
                sessions: route.sessions.size,
                inFlight: route.inFlight.size,
                queued: activeClients.reduce((total, socket) => total + (socket.__redwebRuntime?.queue?.pending || 0), 0),
                listeners: activeClients.reduce((total, socket) => (
                    total + socket.eventNames().reduce((count, event) => count + socket.listenerCount(event), 0)
                ), 0),
                ownedTimers: Number(Boolean(route.runtime.heartbeat?.timer)) + Number(Boolean(route.runtime.sessions?.timer)),
                handles: process._getActiveHandles().length,
            });
        };
        sample();
        interval(sample, sampleSeconds * 1000);
        timers.push(setTimeout(finish, durationSeconds * 1000));
        await run;
    } catch (error) { fail(error); }
    finally {
        stopped = true;
        timers.forEach(clearTimeout);
        await attempt(() => rotationPromise);
        if (sample) {
            await attempt(() => waitUntil(() => route.inFlight.size === 0 &&
                [...route.clients.values()].every(socket => !socket.__redwebRuntime?.queue?.pending), 'message queues to drain'));
            await attempt(() => new Promise(resolve => setTimeout(resolve, 100)));
        }
        if (clients) await attempt(() => clients.closeAll());
        if (sample) {
            await attempt(() => new Promise(resolve => setTimeout(resolve, 2500)));
            await attempt(sample);
        }
        if (server) await attempt(() => withTimeout(server.shutdown(), 'soak server shutdown', 10000));
    }
    if (failures.length) throw new AggregateError(failures, failures[0].message, { cause: failures[0] });
    global.gc();
    await new Promise(resolve => setImmediate(resolve));
    global.gc();
    const result = measurement.summarize(samples, clients, handlesBefore, process._getActiveHandles().length);
    const output = `${JSON.stringify(result, null, 2)}\n`;
    if (outputPath) fs.writeFileSync(outputPath, output, { flag: 'wx' });
    process.stdout.write(output);
    if (!measurement.passed(result)) process.exitCode = 1;
}

main().catch(error => {
    process.stderr.write(`${require('./diagnostics/recovery-split.cjs').describeFailure(error)}\n`);
    process.exitCode = 1;
});
