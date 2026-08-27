const { EventEmitter } = require('events');
const SocketRoute = require('../../src/ws/SocketRoute');
const { BaseHandler } = require('../../src/ws/BaseHandler');

class NoopHandler extends BaseHandler {
    constructor() { super('noop'); }
    onMessage() {}
}

function createSocket(readyState) {
    const socket = new EventEmitter();
    socket.sent = [];
    socket.closed = [];
    if (readyState !== undefined) socket.readyState = readyState;
    socket.send = value => socket.sent.push(value);
    socket.close = (...args) => socket.closed.push(args);
    return socket;
}

describe('SocketRoute units', () => {
    test.each([
        [undefined, 'beginning with'],
        [{ handlers: [NoopHandler] }, 'beginning with'],
        [{ path: 'relative', handlers: [NoopHandler] }, 'beginning with'],
        [{ path: '/x' }, 'At least one handler'],
        [{ path: '/x', handlers: [] }, 'At least one handler'],
        [{ path: '/x', handlers: [NoopHandler], services: {} }, '`services`'],
        [{ path: '/x', handlers: [NoopHandler], websocketOptions: null }, '`websocketOptions`'],
        [{ path: '/x', handlers: [NoopHandler], websocketOptions: [] }, '`websocketOptions`'],
        [{ path: '/x', handlers: [NoopHandler], websocketOptions: 'bad' }, '`websocketOptions`'],
        [{ path: '/x', handlers: [NoopHandler], getClientKey: 'bad' }, '`getClientKey`'],
    ])('validates route configuration %#', (options, message) => {
        expect(() => new SocketRoute(options)).toThrow(message);
    });

    test('requires unique, non-empty handler names', () => {
        class EmptyName { constructor() { this.name = ''; } }
        class DuplicateNoop extends NoopHandler {}
        expect(() => new SocketRoute({ path: '/empty', handlers: [EmptyName] })).toThrow('non-empty name');
        expect(() => new SocketRoute({ path: '/duplicate', handlers: [NoopHandler, DuplicateNoop] })).toThrow('unique');
    });

    test('initializes optional services and validates dynamically added handlers', () => {
        class PassiveService { constructor() { this.created = true; } }
        const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
        const route = new SocketRoute({ path: '/dynamic', handlers: [NoopHandler], services: [PassiveService], logger });
        class InvalidHandler { constructor() { this.name = null; } }
        class OtherHandler extends BaseHandler {
            constructor() { super('other'); }
            onMessage() {}
        }
        expect(route.services[0].created).toBe(true);
        expect(route.addHandler(OtherHandler)).toBe(true);
        expect(route.addHandler(OtherHandler)).toBe(false);
        expect(() => route.addHandler(InvalidHandler)).toThrow('non-empty name');
        expect(logger.log).toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalled();
    });

    test('resolves direct, proxied, custom, and unknown client identities', () => {
        const direct = new SocketRoute({ path: '/direct', handlers: [NoopHandler], logger: null });
        expect(direct.resolveRemoteAddress({ socket: { remoteAddress: '127.0.0.1' } })).toBe('127.0.0.1');
        expect(direct.resolveRemoteAddress()).toBe('unknown');

        const proxied = new SocketRoute({ path: '/proxy', handlers: [NoopHandler], trustProxy: true, logger: null });
        expect(proxied.resolveRemoteAddress({ headers: { 'x-forwarded-for': '' }, socket: { remoteAddress: 'proxy' } })).toBe('proxy');
        expect(proxied.resolveRemoteAddress({ headers: { 'x-forwarded-for': ['bad'] }, socket: { remoteAddress: 'proxy' } })).toBe('proxy');
        expect(proxied.resolveRemoteAddress({ headers: { 'x-forwarded-for': 'client, proxy' } })).toBe('client');

        const custom = new SocketRoute({ path: '/custom', handlers: [NoopHandler], getClientKey: req => req.id, logger: null });
        expect(custom.resolveRemoteAddress({ id: 123 })).toBe('123');
    });

    test('captures rejected initial-contact hooks and socket errors', async () => {
        class RejectingHandler extends BaseHandler {
            constructor() { super('reject'); }
            onMessage() {}
            async onInitialContact() { throw new Error('initial failure'); }
        }
        const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
        const route = new SocketRoute({ path: '/contact', handlers: [RejectingHandler], logger });
        const socket = createSocket();
        route.handleConnection(socket, {});
        await new Promise(setImmediate);
        socket.emit('error', new Error('socket failure'));
        expect(logger.error).toHaveBeenCalledTimes(2);
    });

    test('runs the close callback and no-op logger through duplicate and unknown identities', () => {
        const route = new SocketRoute({ path: '/callbacks', handlers: [NoopHandler], logger: null });
        const first = createSocket();
        const second = createSocket();
        route.handleConnection(first, {});
        route.handleConnection(second, {});
        const closed = [];
        route.connectionCloseCallback = socket => closed.push(socket);
        route.handleClose(second);
        route.handleClose({ __redwebClientKey: 'missing' });
        route.handleError({}, new Error('ignored by no-op logger'));
        expect(closed).toEqual([second, expect.any(Object)]);
    });

    test('optionally exposes text and binary handler errors', async () => {
        class BrokenHandler extends BaseHandler {
            constructor() { super('broken'); }
            onMessage() { throw new Error('text detail'); }
            acceptsBinary() { throw new Error('binary detail'); }
        }
        const route = new SocketRoute({ path: '/broken', handlers: [BrokenHandler], exposeErrors: true, logger: null });
        const textSocket = createSocket();
        expect(await route.handleMessage(textSocket, { type: 'broken' })).toBe(false);
        expect(JSON.parse(textSocket.sent[0])).toEqual({ error: 'text detail' });
        expect(textSocket.closed[0][0]).toBe(1011);

        const binarySocket = createSocket();
        expect(await route.handleBinaryMessage(binarySocket, Buffer.from([1]))).toBe(false);
        expect(JSON.parse(binarySocket.sent[0])).toEqual({ error: 'binary detail' });
        expect(binarySocket.closed[0][0]).toBe(1011);

        const hiddenRoute = new SocketRoute({ path: '/hidden-binary-error', handlers: [BrokenHandler], logger: null });
        const hiddenSocket = createSocket();
        await hiddenRoute.handleBinaryMessage(hiddenSocket, Buffer.from([1]));
        expect(JSON.parse(hiddenSocket.sent[0])).toEqual({ error: 'Binary handler failed' });
    });

    test('formats non-Error handler failures when errors are exposed', async () => {
        class StringFailure extends BaseHandler {
            constructor() { super('string-failure'); }
            onMessage() { throw 'text failure'; }
            acceptsBinary() { return true; }
            onBinaryMessage() { throw 'binary failure'; }
        }
        const route = new SocketRoute({ path: '/string-failure', handlers: [StringFailure], exposeErrors: true, logger: null });
        const text = createSocket();
        await route.handleMessage(text, { type: 'string-failure' });
        expect(JSON.parse(text.sent[0])).toEqual({ error: 'text failure' });
        const binary = createSocket();
        await route.handleBinaryMessage(binary, Buffer.from([1]));
        expect(JSON.parse(binary.sent[0])).toEqual({ error: 'binary failure' });
    });

    test('reports a route-level unsupported binary frame when no handler supports binary', async () => {
        class PlainHandler {
            constructor() { this.name = 'plain'; }
            handleMessage() {}
        }
        const route = new SocketRoute({ path: '/plain', handlers: [PlainHandler], logger: null });
        const socket = createSocket();
        expect(await route.handleBinaryMessage(socket, Buffer.from([1]))).toBe(false);
        expect(JSON.parse(socket.sent[0])).toEqual({ error: 'Binary messages are not supported on this route' });
        expect(socket.closed).toEqual([]);
    });

    test('shuts down services that omit hooks and closes tracked clients', async () => {
        class PassiveService {}
        const route = new SocketRoute({ path: '/shutdown', handlers: [NoopHandler], services: [PassiveService], logger: null });
        const socket = createSocket();
        route.clients.set('client', socket);
        route.clients.set('client-without-close', {});
        await route.shutdown();
        expect(socket.closed[0]).toEqual([1001, 'Server shutting down']);
        expect(route.clients.size).toBe(0);
    });
});
