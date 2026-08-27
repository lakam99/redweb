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
        [{ path: '/x', handlers: [NoopHandler], websocketOptions: { noServer: false } }, 'controls websocketOptions.noServer'],
        [{ path: '/x', handlers: [NoopHandler], websocketOptions: { path: '/other' } }, 'controls websocketOptions.path'],
        [{ path: '/x', handlers: [NoopHandler], websocketOptions: { server: {} } }, 'controls websocketOptions.server'],
        [{ path: '/x', handlers: [NoopHandler], websocketOptions: { port: 1 } }, 'controls websocketOptions.port'],
        [{ path: '/x', handlers: [{}] }, 'Handler entries'],
        [{ path: '/x', handlers: [NoopHandler], services: [{}] }, 'Service entries'],
        [{ path: '/x', handlers: [NoopHandler], shutdownTimeoutMs: -1 }, '`shutdownTimeoutMs`'],
        [{ path: '/x', handlers: [NoopHandler], shutdownTimeoutMs: 1.5 }, '`shutdownTimeoutMs`'],
        [{ path: '/x', handlers: [NoopHandler], orderedMessages: 'yes' }, '`orderedMessages`'],
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

    test('rolls back initialized services when later construction fails', async () => {
        let stopped = 0;
        class StartedService {
            onInit() { this.timer = setInterval(() => {}, 1000); }
            onShutdown() { clearInterval(this.timer); stopped += 1; }
        }
        class ThrowingService {
            onInit() { throw new Error('initialization failed'); }
        }
        expect(() => new SocketRoute({
            path: '/rollback',
            handlers: [NoopHandler],
            services: [StartedService, ThrowingService],
            logger: null,
        })).toThrow('initialization failed');
        await new Promise(setImmediate);
        expect(stopped).toBe(1);

        class AsyncService {
            onInit() { return Promise.reject(new Error('async initialization failed')); }
            onShutdown() { stopped += 1; }
        }
        expect(() => new SocketRoute({
            path: '/async-init',
            handlers: [NoopHandler],
            services: [AsyncService],
            logger: null,
        })).toThrow('must be synchronous');
        await new Promise(setImmediate);
        expect(stopped).toBe(2);
    });

    test('logs constructor rollback failures without masking the original error', async () => {
        const logger = { log() {}, warn() {}, error: jest.fn() };
        class BadCleanupService {
            onShutdown() { throw new Error('rollback cleanup failed'); }
        }
        class ThrowingService {
            constructor() { throw new Error('constructor failed'); }
        }
        expect(() => new SocketRoute({
            path: '/bad-rollback',
            handlers: [NoopHandler],
            services: [BadCleanupService, ThrowingService],
            logger,
        })).toThrow('constructor failed');
        await new Promise(setImmediate);
        expect(logger.error).toHaveBeenCalledWith('Error shutting down service:', expect.any(Error));
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

    test('runs the close callback and no-op logger through duplicate and unknown identities', async () => {
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
        await new Promise(setImmediate);
        expect(closed).toEqual([second, expect.any(Object)]);

        const emptyKeyRoute = new SocketRoute({
            path: '/empty-key',
            handlers: [NoopHandler],
            getClientKey: () => '',
            logger: null,
        });
        const emptyKeySocket = createSocket();
        emptyKeyRoute.handleConnection(emptyKeySocket, {});
        emptyKeyRoute.handleClose(emptyKeySocket);
        expect(emptyKeyRoute.clients.size).toBe(0);
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

    test('finishes every shutdown step and reports client and server close failures', async () => {
        const route = new SocketRoute({ path: '/failed-shutdown', handlers: [NoopHandler], logger: null });
        route.clients.set('broken-client', {
            close() { throw new Error('client close failed'); },
        });
        route.server.close = callback => callback(new Error('server close failed'));

        const shutdown = route.shutdown();
        expect(route.shutdown()).toBe(shutdown);
        await expect(shutdown).rejects.toMatchObject({
            message: 'One or more WebSocket route cleanup operations failed.',
            errors: [
                expect.objectContaining({ message: 'client close failed' }),
                expect.objectContaining({ message: 'server close failed' }),
            ],
        });
        expect(route.clients.size).toBe(0);
    });

    test('contains unexpected failures from ordered dispatch', async () => {
        const logger = { log() {}, warn() {}, error: jest.fn() };
        const route = new SocketRoute({
            path: '/ordered-error',
            handlers: [NoopHandler],
            orderedMessages: true,
            logger,
        });
        const socket = createSocket();
        route.handleConnection(socket, {});
        route.dispatchMessage = () => { throw new Error('unexpected dispatch failure'); };
        socket.emit('message', JSON.stringify({ type: 'noop' }), false);
        await socket.__redwebRuntime.queue.whenIdle();
        expect(logger.error).toHaveBeenCalledWith(
            'Socket error from unknown:',
            expect.objectContaining({ message: 'unexpected dispatch failure' })
        );
        expect(socket.closed).toContainEqual([1011, 'Message processing failed']);
    });

    test('supports admission-free authorization and drop-only message limiting', () => {
        const route = new SocketRoute({
            path: '/dropping',
            handlers: [NoopHandler],
            limits: { messageRate: { capacity: 1, refillPerSecond: 0, action: 'drop' } },
            logger: null,
        });
        expect(route.authorizeUpgrade({}, {})).toBe(true);
        const socket = createSocket();
        route.handleConnection(socket, {});
        expect(route.receiveMessage(socket, JSON.stringify({ type: 'noop' }), false)).toBe(true);
        expect(route.receiveMessage(socket, JSON.stringify({ type: 'noop' }), false)).toBe(false);
        expect(socket.closed).toEqual([]);
    });

    test('supports shorthand room and session registries and rolls back invalid infrastructure', async () => {
        const route = new SocketRoute({
            path: '/state-defaults',
            handlers: [NoopHandler],
            rooms: true,
            sessions: true,
            logger: null,
        });
        expect(route.rooms).toBeTruthy();
        expect(route.sessions).toBeTruthy();
        await route.shutdown();

        let stopped = 0;
        class TrackingService {
            onShutdown() { stopped += 1; }
        }
        expect(() => new SocketRoute({
            path: '/invalid-state',
            handlers: [NoopHandler],
            services: [TrackingService],
            heartbeat: { intervalMs: 10, timeoutMs: 10 },
            rooms: null,
            logger: null,
        })).toThrow('`rooms`');
        await new Promise(setImmediate);
        expect(stopped).toBe(1);
    });

    test('does not record outbound fanout when a broadcast has no recipients', () => {
        const events = [];
        const route = new SocketRoute({
            path: '/empty-broadcast',
            handlers: [NoopHandler],
            metrics: { increment: (...args) => events.push(args) },
            logger: null,
        });
        const socket = createSocket();
        route.handleConnection(socket, {});
        expect(socket.broadcast({ empty: true })).toBe(0);
        expect(events.some(([name]) => name === 'redweb.messages.outbound')).toBe(false);
    });
});
