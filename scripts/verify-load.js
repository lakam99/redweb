const redweb = require('..');
const { silentLogger, waitFor, openClient, closeClient } = require('./realtime-harness');
const { LoadMeasurement } = require('./lib/LoadMeasurement');
const { measureLoadTraffic } = require('./lib/measureLoadTraffic');
const { verificationError } = require('./lib/verificationError');

const measurement = new LoadMeasurement();
const { clientCount, messagesPerClient } = measurement;

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

async function main() {
    const server = new redweb.SocketServer({ port: 0, bind: '127.0.0.1', routes: [LoadRoute], logger: silentLogger });
    const clients = [], failures = [];
    let slow, result;
    try {
        if (!server.server.listening) await waitFor(server.server, 'listening');
        const route = server.routes[0];
        const url = `ws://127.0.0.1:${server.server.address().port}/load`;
        // Settle all acquisitions before cleanup so a later successful open
        // cannot escape ownership after an earlier member of the batch fails.
        const acquired = await Promise.allSettled(Array.from({ length: clientCount }, async (_value, index) => {
            clients[index] = await openClient(url);
        }));
        for (const outcome of acquired) if (outcome.status === 'rejected') failures.push(verificationError(outcome.reason));
        if (!failures.length) result = await measureLoadTraffic(clients, measurement, async () => {
            slow = await openClient(url);
            slow._socket.pause();
            slow.send(JSON.stringify({ type: 'slow' }));
            await new Promise(resolve => setTimeout(resolve, 250));
            const serverSlowSocket = [...route.clients.values()].find(socket => socket.__slowConsumerSends !== undefined);
            return Boolean(serverSlowSocket && serverSlowSocket.__slowConsumerSends < 4096 && serverSlowSocket.readyState !== serverSlowSocket.OPEN);
        });
    } catch (error) { failures.push(verificationError(error)); }
    // Resume the deliberately paused transport even if its probe failed.
    try { slow?._socket.resume(); } catch (error) { failures.push(verificationError(error)); }
    const closed = await Promise.allSettled([...clients, slow].map(closeClient));
    for (const outcome of closed) if (outcome.status === 'rejected') failures.push(verificationError(outcome.reason));
    try { await server.shutdown(); } catch (error) { failures.push(verificationError(error)); }
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, failures[0].message, { cause: failures[0] });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!measurement.passed(result)) process.exitCode = 1;
}

main().catch(error => {
    process.stderr.write(`${require('./diagnostics/recovery-split.cjs').describeFailure(error)}\n`);
    process.exitCode = 1;
});
