const net = require('net');
const WebSocket = require('ws');
const { BaseHandler, SocketRoute, SocketServer } = require('../..');
const { closeWebSocket, nextMessage, silentLogger, waitForListening, waitForOpen, withTimeout } = require('../helpers/network');

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
        await Promise.all([...clients].map(closeWebSocket));
        clients.clear();
        await server.shutdown();
    });

    async function connect() {
        const port = server.server.address().port;
        const socket = new WebSocket(`ws://127.0.0.1:${port}/fuzz`);
        clients.add(socket);
        await waitForOpen(socket);
        return socket;
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
        const response = nextMessage(socket);
        socket.send(JSON.stringify({ type: 'echo', value: 'healthy' }));
        expect(JSON.parse((await response).data.toString())).toEqual({ value: 'healthy' });
    });

    test('contains deterministic malformed text and binary frames across reconnects', async () => {
        const malformed = [
            '{', 'null', '[]', '{}',
            '{"type":null}', '{"type":""}', '{"type":"missing"}',
            ...Array.from({ length: 25 }, (_, index) => seededBytes(index + 1, 1 + index * 7).toString('base64')),
        ];
        for (const payload of malformed) {
            const socket = await connect();
            socket.send(payload);
            await withTimeout(new Promise(resolve => socket.once('close', resolve)), 'fuzz client close');
            clients.delete(socket);
        }

        const binarySocket = await connect();
        for (let seed = 1; seed <= 50; seed += 1) {
            const rejected = nextMessage(binarySocket);
            binarySocket.send(seededBytes(seed, seed * 3));
            expect(JSON.parse((await rejected).data.toString())).toEqual({ error: 'Binary messages are not supported by this handler' });
        }
        const response = nextMessage(binarySocket);
        binarySocket.send(JSON.stringify({ type: 'echo', value: 'still healthy' }));
        expect(JSON.parse((await response).data.toString())).toEqual({ value: 'still healthy' });

        const finalSocket = await connect();
        const finalResponse = nextMessage(finalSocket);
        finalSocket.send(JSON.stringify({ type: 'echo', value: 42 }));
        expect(JSON.parse((await finalResponse).data.toString())).toEqual({ value: 42 });
    });
});
