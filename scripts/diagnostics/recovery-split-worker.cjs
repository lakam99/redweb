'use strict';

// Diagnostic only. Keep the acceptance verifier independent and unchanged.
const assert = require('node:assert/strict');
const v8 = require('node:v8');
const { silentLogger, waitFor, WebSocket, closeClient } = require('../realtime-harness');
const role = process.argv[2];
let server;
let sent = 0;
let received = 0;
const clients = new Set();

async function dispatch({ command, url, start, count }) {
    switch (command) {
        case 'start': {
            assert.equal(role, 'server');
            assert.equal(server, undefined);
            // Load Redweb only in the server; the client uses native ws helpers.
            const redweb = require('../..');
            class ReconnectHandler extends redweb.BaseHandler {
                constructor() { super('connect'); }
                onMessage(socket, message) {
                    socket.joinRoom(`room-${message.id % 8}`);
                    socket.createSession(`session-${message.id}`, { id: message.id });
                    socket.sendJson({ ready: message.id });
                    received++;
                }
            }
            class ReconnectRoute extends redweb.SocketRoute {
                constructor() {
                    super({ path: '/reconnect', handlers: [ReconnectHandler],
                        allowDuplicateConnections: true, logger: silentLogger, orderedMessages: true,
                        limits: { maxConnections: 100, maxPendingMessages: 4 },
                        rooms: { maxRooms: 8, maxMembersPerRoom: 100, maxRoomsPerConnection: 1 },
                        sessions: { ttlMs: 250, sweepIntervalMs: 50, maxSessions: 1400 } });
                }
            }
            server = new redweb.SocketServer({ port: 0, bind: '127.0.0.1', routes: [ReconnectRoute], logger: silentLogger });
            if (!server.server.listening) await waitFor(server.server, 'listening');
            return { url: `ws://127.0.0.1:${server.server.address().port}/reconnect` };
        }
        case 'batch': {
            assert.equal(role, 'client');
            assert(Number.isSafeInteger(start) && start >= 0);
            assert(Number.isSafeInteger(count) && count > 0 && count <= 50);
            try {
                // allSettled ensures no late open can escape the finally cleanup.
                const opened = await Promise.allSettled(Array.from({ length: count }, async () => {
                    const socket = new WebSocket(url);
                    clients.add(socket);
                    await waitFor(socket, 'open');
                    return socket;
                }));
                const failure = opened.find(result => result.status === 'rejected');
                if (failure) throw failure.reason;
                const replies = await Promise.allSettled(opened.map(async ({ value: socket }, index) => {
                    const reply = waitFor(socket, 'message');
                    socket.send(JSON.stringify({ type: 'connect', id: start + index }));
                    sent++;
                    const [data] = await reply;
                    assert.deepEqual(JSON.parse(data.toString()), { ready: start + index });
                    received++;
                }));
                const rejected = replies.find(result => result.status === 'rejected');
                if (rejected) throw rejected.reason;
            } finally {
                await Promise.all([...clients].map(closeClient));
                assert([...clients].every(socket => socket.readyState === 3), 'Client close did not complete');
                clients.clear();
            }
            return { sent, received, clients: clients.size };
        }
        case 'barrier': {
            assert.equal(role, 'server');
            const deadline = Date.now() + 10000;
            while (server.routes[0].clients.size !== 0) {
                if (Date.now() >= deadline) throw new Error('Server connection cleanup timed out');
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            return { received };
        }
        case 'sample': {
            await new Promise(resolve => setTimeout(resolve, 400));
            global.gc();
            await new Promise(resolve => setImmediate(resolve));
            global.gc();
            // Read heap first. V8's following views overlap; never add/subtract them.
            const memory = process.memoryUsage();
            const spaces = v8.getHeapSpaceStatistics();
            const code = v8.getHeapCodeStatistics();
            const registries = role === 'server'
                ? { clients: server.routes[0].clients.size, rooms: server.routes[0].rooms.size, sessions: server.routes[0].sessions.size }
                : { clients: clients.size };
            assert(Object.values(registries).every(value => value === 0), 'Recovery registries are not empty');
            return { pid: process.pid, node: process.version, v8: process.versions.v8, execArgv: process.execArgv,
                memory, spaces, code, registries, sent, received };
        }
        case 'stop':
            if (server) await server.shutdown();
            return { stopped: true };
        default: throw new Error(`Unknown diagnostic command: ${command}`);
    }
}

process.on('message', async message => {
    try {
        const result = await dispatch(message);
        process.send({ result });
    } catch (error) {
        process.send({ error: error.stack });
    }
});
// No orphan listener if the coordinator exits, even during a stuck command.
process.on('disconnect', () => process.exit(0));
