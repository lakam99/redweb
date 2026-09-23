'use strict';

const WebSocket = require('ws');
const { z } = require('zod');
const { defineSocketContract, SocketRoute, SocketServer, BaseHandler } = require('../..');
const {
    closeWebSocket, nextMessage, silentLogger, waitForClose, waitForListening,
    waitForOpen, websocketUpgradeStatus,
} = require('../helpers/network');

const standard = validate => ({ '~standard': { version: 1, validate } });

describe('socket contracts over real WebSockets', () => {
    const servers = new Set();
    const clients = new Set();

    afterEach(async () => {
        await Promise.all([...clients].map(closeWebSocket));
        clients.clear();
        await Promise.all([...servers].map(server => server.shutdown()));
        servers.clear();
    });

    async function start(contract, handlers, protocol = contract.protocol) {
        class MatchRoute extends SocketRoute {
            constructor() {
                super({ path: '/match', handlers, protocol, allowDuplicateConnections: true, logger: silentLogger });
            }
        }
        const server = new SocketServer({ routes: [MatchRoute], port: 0, bind: '127.0.0.1', logger: silentLogger });
        servers.add(server);
        await waitForListening(server.server);
        return `ws://127.0.0.1:${server.server.address().port}/match`;
    }

    async function connect(url) {
        const socket = new WebSocket(url);
        clients.add(socket);
        await waitForOpen(socket);
        return socket;
    }

    async function exchange(socket, send) {
        const received = nextMessage(socket);
        await send();
        return (await received).data;
    }

    test('routes join/move/resume independently and validates inferred input/output on both ends', async () => {
        const match = defineSocketContract('1', {
            join: z.object({ name: z.string().trim().min(1) }),
            move: z.object({ x: z.number().min(-1).max(1), y: z.number().min(-1).max(1) }),
            resume: z.string().transform(async value => value.length),
            result: z.object({ handler: z.string(), value: z.union([z.string(), z.number()]) }),
        });
        const received = [];
        let serverSocket;
        const handlers = match.types.filter(type => type !== 'result').map(type => match.handler(type, async (socket, payload, message) => {
            serverSocket = socket;
            received.push({ type: message.type, payload });
            await match.send(socket, 'result', { handler: message.type, value: type === 'join' ? payload.name : type === 'move' ? payload.x : payload },
                { requestId: message.requestId, sequence: message.sequence });
        }));
        const url = await start(match, handlers);
        expect(await websocketUpgradeStatus(url)).toBe(426);
        expect(await websocketUpgradeStatus(`${url}?redwebVersion=2`)).toBe(426);
        const socket = await connect(`${url}?redwebVersion=1`);
        const client = match.client(socket);
        for (const [type, payload, value] of [['join', { name: ' Ada ' }, 'Ada'], ['move', { x: 1, y: 0 }, 1], ['resume', 'token', 5]]) {
            const frame = await exchange(socket, () => client.send(type, payload, { requestId: type, sequence: 3 }));
            expect(await client.parse(frame)).toEqual({ v: '1', type: 'result', payload: { handler: type, value }, requestId: type, sequence: 3 });
        }
        expect(received).toEqual([
            { type: 'join', payload: { name: 'Ada' } }, { type: 'move', payload: { x: 1, y: 0 } }, { type: 'resume', payload: 5 },
        ]);

        // Invalid local sends never reach a handler or the wire; a valid exchange forms a delivery barrier.
        await expect(client.send('move', { x: 2, y: 0 })).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });
        await expect(client.send('unknown', {})).rejects.toMatchObject({ code: 'UNKNOWN_HANDLER' });
        for (const payload of [undefined, 1n, (() => { const value = {}; value.self = value; return value; })()]) {
            await expect(client.send('join', payload)).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });
        }
        await expect(match.send(serverSocket, 'result', { handler: 'join', value: {} })).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });
        const frame = await exchange(socket, () => client.send('join', { name: 'Grace' }));
        expect((await client.parse(frame)).payload.value).toBe('Grace');
        expect(received).toHaveLength(4);

        const transformed = await exchange(socket, () => match.send(serverSocket, 'resume', 'token'));
        expect(await client.parse(transformed)).toMatchObject({ type: 'resume', payload: 5 });
        const invalid = await exchange(socket, () => serverSocket.sendEvent('move', { x: 'wrong', y: 0 }));
        await expect(client.parse(invalid)).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });
        const unknown = await exchange(socket, () => serverSocket.sendEvent('unknown', {}));
        await expect(client.parse(unknown)).rejects.toMatchObject({ code: 'UNKNOWN_HANDLER' });
    });

    test.each(['invalid', 'throws', 'timeout'])('%s validation never invokes the application and sends a sanitized protocol error', async mode => {
        const validators = {
            invalid: z.object({ name: z.string() }),
            throws: standard(() => { throw new Error('secret database value'); }),
            timeout: standard(() => new Promise(() => {})),
        };
        const match = defineSocketContract('1', { join: validators[mode] }, { validationTimeoutMs: 10 });
        let called = 0;
        const url = await start(match, [match.handler('join', () => { called++; })]);
        const socket = await connect(`${url}?redwebVersion=1`);
        const closed = waitForClose(socket);
        const frame = await exchange(socket, () => socket.send(JSON.stringify({ v: '1', type: 'join', payload: { name: 42 }, requestId: 'bad' })));
        expect(await match.client(socket).parse(frame)).toEqual({
            v: '1', type: 'error', requestId: 'bad',
            error: { code: 'INVALID_PAYLOAD', message: 'Payload does not match the socket contract.' },
        });
        expect((await closed).code).toBe(1008);
        expect(called).toBe(0);
    });

    test('application failures remain distinct from validation errors', async () => {
        const match = defineSocketContract('1', { join: z.string() });
        const url = await start(match, [match.handler('join', () => { throw new Error('private application failure'); })]);
        const socket = await connect(`${url}?redwebVersion=1`);
        const client = match.client(socket);
        const frame = await exchange(socket, () => client.send('join', 'Ada'));
        expect(await client.parse(frame)).toMatchObject({ type: 'error', error: { code: 'HANDLER_FAILED', message: 'Handler failed' } });
    });

    test('a malformed server reply is an application failure, not a client policy violation', async () => {
        const match = defineSocketContract('1', { join: z.string(), result: z.number() });
        const url = await start(match, [match.handler('join', socket => match.send(socket, 'result', 'wrong'))]);
        const socket = await connect(`${url}?redwebVersion=1`);
        const closed = waitForClose(socket);
        const client = match.client(socket);
        const frame = await exchange(socket, () => client.send('join', 'Ada'));
        expect(await client.parse(frame)).toMatchObject({ error: { code: 'HANDLER_FAILED', message: 'Handler failed' } });
        expect((await closed).code).toBe(1011);
    });

    test('mutating validators never rewrite the original client or server wire snapshot', async () => {
        const match = defineSocketContract('1', {
            value: standard(input => { input.n++; return { value: input }; }),
        });
        let received;
        const url = await start(match, [match.handler('value', (socket, payload) => {
            received = payload.n;
            return match.send(socket, 'value', { n: 0 });
        })]);
        const socket = await connect(`${url}?redwebVersion=1`);
        const client = match.client(socket);
        const input = { n: 0 };
        const frame = await exchange(socket, () => client.send('value', input));
        expect(input.n).toBe(0);
        expect(received).toBe(1);
        expect(JSON.parse(frame).payload.n).toBe(0);
        expect((await client.parse(frame)).payload.n).toBe(1);
    });

    test('contract handlers cannot silently run on a different negotiated version', async () => {
        const match = defineSocketContract('1', { join: z.string() });
        let called = 0;
        const url = await start(match, [match.handler('join', () => { called++; })], { versions: ['2'] });
        const socket = await connect(`${url}?redwebVersion=2`);
        const frame = await exchange(socket, () => socket.send(JSON.stringify({ v: '2', type: 'join', payload: 'Ada' })));
        expect(JSON.parse(frame)).toMatchObject({ error: { code: 'HANDLER_FAILED' } });
        expect(called).toBe(0);
    });

    test('ordinary uncontracted handlers keep their existing wire format', async () => {
        class Echo extends BaseHandler {
            constructor() { super('echo'); }
            onMessage(socket, message) { socket.sendJson({ type: 'echo', text: message.text }); }
        }
        const url = await start({}, [Echo]);
        const socket = await connect(url);
        const frame = await exchange(socket, () => socket.send(JSON.stringify({ type: 'echo', text: 'unchanged' })));
        expect(JSON.parse(frame)).toEqual({ type: 'echo', text: 'unchanged' });
    });
});
