const net = require('net');
const WebSocket = require('ws');
const { BaseHandler, SocketRoute, SocketServer } = require('../..');
const { silentLogger, waitForCondition, waitForListening, waitForOpen, withTimeout } = require('../helpers/network');

async function exchange(socket, payload, label) {
    let message, closed, error;
    try {
        return await withTimeout(new Promise((resolve, reject) => {
            message = resolve;
            closed = () => reject(new Error(`${label}: connection closed before reply`));
            error = reject;
            socket.on('message', message); socket.once('close', closed); socket.once('error', error);
            socket.send(payload);
        }), label, 2000);
    } finally {
        socket.off('message', message); socket.off('close', closed); socket.off('error', error);
    }
}

function seededBytes(seed, length) {
    let state = seed >>> 0;
    const output = Buffer.alloc(length);
    for (let index = 0; index < length; index += 1) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        output[index] = state & 255;
    }
    return output;
}

function rawUpgrade(port, request) {
    return withTimeout(new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: '127.0.0.1', port });
        const chunks = [];
        socket.setTimeout(500, () => socket.destroy());
        socket.on('connect', () => socket.write(request));
        socket.on('data', chunk => chunks.push(chunk));
        socket.on('close', () => resolve(Buffer.concat(chunks).toString('latin1')));
        socket.on('error', reject);
    }), 'fuzzed upgrade', 1500);
}

describe('WebSocket hostile input integration without mocks', () => {
    let server;
    const clients = new Set();

    class EchoHandler extends BaseHandler {
        constructor() { super('echo'); }
        onMessage(socket, message) { socket.sendJson({ value: message.value }); }
    }
    class FuzzRoute extends SocketRoute {
        constructor() {
            super({
                path: '/fuzz',
                handlers: [EchoHandler],
                allowDuplicateConnections: true,
                logger: silentLogger,
                limits: { maxPendingMessages: 8, maxBufferedBytes: 64 * 1024 },
            });
        }
    }

    beforeEach(async () => {
        server = new SocketServer({ port: 0, bind: '127.0.0.1', routes: [FuzzRoute], logger: silentLogger });
        await waitForListening(server.server);
    });

    afterEach(async () => {
        // Hostile-frame failures must not prevent listener cleanup or wait for a
        // graceful handshake with the very peer being tested.
        const outcomes = await Promise.allSettled([...clients].map(async socket => {
            if (socket.readyState === WebSocket.CLOSED) return;
            const closed = new Promise(resolve => socket.once('close', resolve));
            socket.terminate();
            await withTimeout(closed, 'owned fuzz client termination', 1500);
        }));
        clients.clear();
        outcomes.push(...await Promise.allSettled([withTimeout(server.shutdown(), 'fuzz server shutdown', 1500)]));
        const failures = outcomes.filter(result => result.status === 'rejected').map(result => result.reason);
        if (failures.length) throw new AggregateError(failures, 'Fuzz fixture cleanup failed');
    });

    async function connect() {
        const port = server.server.address().port;
        const expectedConnections = server.routes[0].clients.size + 1;
        const socket = new WebSocket(`ws://127.0.0.1:${port}/fuzz`);
        clients.add(socket);
        await waitForOpen(socket);
        await waitForCondition(() => server.routes[0].clients.size === expectedConnections, 'fuzz route registration', 2000);
        return socket;
    }

    async function rejectMalformed(socket, payload, label) {
        const closed = new Promise(resolve => socket.once('close', resolve));
        socket.send(payload);
        await waitForCondition(() => server.routes[0].clients.size === 0, `${label} server release`, 2000);
        expect([WebSocket.CLOSING, WebSocket.CLOSED]).toContain(socket.readyState);
        if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
        await withTimeout(closed, `${label} client cleanup`, 2000);
    }

    test('contains mutated upgrade requests and remains available', async () => {
        const port = server.server.address().port;
        const cases = [
            'GET /missing HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n',
            'GET /fuzz HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 12\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n',
            'GET /fuzz HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: short\r\n\r\n',
            'GET /%zz HTTP/1.1\r\nHost: [\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n',
        ];
        for (const request of cases) await rawUpgrade(port, request);

        const socket = await connect();
        const response = await exchange(socket, JSON.stringify({ type: 'echo', value: 'healthy' }), 'post-upgrade-fuzz echo');
        expect(JSON.parse(response.toString())).toEqual({ value: 'healthy' });
    });

    test('contains deterministic malformed text and binary frames across reconnects', async () => {
        const malformed = [
            '{', 'null', '[]', '{}',
            '{"type":null}', '{"type":""}', '{"type":"missing"}',
            ...Array.from({ length: 25 }, (_, index) => seededBytes(index + 1, 1 + index * 7).toString('base64')),
        ];
        for (const [index, payload] of malformed.entries()) {
            const socket = await connect();
            await rejectMalformed(socket, payload, `malformed frame ${index}`);
            clients.delete(socket);
        }

        const binarySocket = await connect();
        for (let seed = 1; seed <= 50; seed += 1) {
            const rejected = await exchange(binarySocket, seededBytes(seed, seed * 3), `binary frame ${seed} rejection`);
            expect(JSON.parse(rejected.toString())).toEqual({ error: 'Binary messages are not supported by this handler' });
        }
        const response = await exchange(binarySocket, JSON.stringify({ type: 'echo', value: 'still healthy' }), 'post-fuzz echo');
        expect(JSON.parse(response.toString())).toEqual({ value: 'still healthy' });

        const finalSocket = await connect();
        const finalResponse = await exchange(finalSocket, JSON.stringify({ type: 'echo', value: 42 }), 'new-client echo');
        expect(JSON.parse(finalResponse.toString())).toEqual({ value: 42 });
    }, 30000); // Many sequential network exchanges; each still has its own short deadline.
});
