const http = require('http');
const { EventEmitter } = require('events');
const { BaseSocketServer } = require('../../src/ws/BaseSocketServer');
const SocketRoute = require('../../src/ws/SocketRoute');
const SocketServer = require('../../src/ws/SocketServer');
const SecureSocketServer = require('../../src/ws/SecureSocketServer');
const DefaultRoute = require('../../src/ws/DefaultRoute');
const { BaseHandler } = require('../../src/ws/BaseHandler');

class NoopHandler extends BaseHandler {
    constructor() { super('noop'); }
    onMessage() {}
}

class FirstRoute extends SocketRoute {
    constructor() { super({ path: '/first', handlers: [NoopHandler], logger: null }); }
}

function fakeServer() {
    const server = new EventEmitter();
    server.listening = false;
    server.listen = (port, bind, callback) => {
        server.listening = true;
        server.address = () => ({ port, address: bind });
        callback();
    };
    server.close = callback => {
        server.listening = false;
        callback();
    };
    return server;
}

describe('BaseSocketServer units', () => {
    test('validates the server and options', () => {
        expect(() => new BaseSocketServer()).toThrow('server is required');
        const server = fakeServer();
        expect(() => new BaseSocketServer(server, { port: 1.5 })).toThrow('`port`');
        expect(() => new BaseSocketServer(server, { port: -1 })).toThrow('`port`');
        expect(() => new BaseSocketServer(server, { port: 65536 })).toThrow('`port`');
        expect(() => new BaseSocketServer(server, { bind: '' })).toThrow('`bind`');
        expect(() => new BaseSocketServer(server, { listen: 'yes' })).toThrow('`listen`');
        expect(() => new BaseSocketServer(server, { listenCallback: 'bad' })).toThrow('`listenCallback`');
        expect(() => new BaseSocketServer(server, { routes: 'bad' })).toThrow('`routes`');
    });

    test('rejects duplicate initial and dynamically-added route paths', () => {
        class DuplicateRoute extends FirstRoute {}
        expect(() => new BaseSocketServer(fakeServer(), { routes: [FirstRoute, DuplicateRoute] })).toThrow('unique');

        const server = new BaseSocketServer(fakeServer(), { routes: [FirstRoute], logger: null });
        expect(() => server.addRoute(DuplicateRoute)).toThrow('already exists');
    });

    test('logs asynchronous cleanup failures for rejected duplicate routes', async () => {
        const logger = { log() {}, warn() {}, error: jest.fn() };
        class RejectingRoute extends FirstRoute {
            shutdown() { return Promise.reject(new Error('cleanup failed')); }
        }
        expect(() => new BaseSocketServer(fakeServer(), {
            routes: [FirstRoute, RejectingRoute],
            logger,
        })).toThrow('unique');
        await new Promise(setImmediate);
        expect(logger.error).toHaveBeenCalledWith('Error shutting down route:', expect.any(Error));

        const server = new BaseSocketServer(fakeServer(), { routes: [FirstRoute], logger });
        expect(() => server.addRoute(RejectingRoute)).toThrow('already exists');
        await new Promise(setImmediate);
        expect(logger.error).toHaveBeenCalledTimes(2);
    });

    test('rolls back earlier routes when a later route constructor fails', async () => {
        let stopped = 0;
        class TrackingService {
            onInit() { this.timer = setInterval(() => {}, 1000); }
            onShutdown() { clearInterval(this.timer); stopped += 1; }
        }
        class TrackingRoute extends SocketRoute {
            constructor() { super({ path: '/tracking', handlers: [NoopHandler], services: [TrackingService], logger: null }); }
        }
        class ThrowingRoute {
            constructor() { throw new Error('route construction failed'); }
        }
        expect(() => new BaseSocketServer(fakeServer(), {
            routes: [TrackingRoute, ThrowingRoute],
            logger: null,
        })).toThrow('route construction failed');
        await new Promise(setImmediate);
        expect(stopped).toBe(1);
    });

    test('normalizes query strings and rejects malformed or unmatched upgrades', () => {
        const server = new BaseSocketServer(fakeServer(), { routes: [FirstRoute], logger: null });
        const matched = server.routes[0];
        const original = matched.server.handleUpgrade;
        const upgrades = [];
        matched.server.handleUpgrade = (req, socket, head, callback) => {
            upgrades.push([req, socket, head]);
            callback('accepted', req);
        };
        matched.server.emit = (event, socket) => upgrades.push([event, socket]);

        server.handleUpgrade({ url: '/first?token=x', headers: { host: 'localhost' } }, {}, Buffer.alloc(0));
        expect(upgrades[1]).toEqual(['connection', 'accepted']);

        let destroyed = 0;
        server.handleUpgrade({ url: 'http://[', headers: {} }, { destroy: () => { destroyed += 1; } }, Buffer.alloc(0));
        server.handleUpgrade({ url: '/missing', headers: {} }, { destroy: () => { destroyed += 1; } }, Buffer.alloc(0));
        expect(destroyed).toBe(2);
        matched.server.handleUpgrade = original;
    });

    test('can listen on a supplied server when explicitly requested', async () => {
        const server = fakeServer();
        const socketServer = new BaseSocketServer(server, {
            routes: [FirstRoute],
            listen: true,
            port: 4321,
            bind: '127.0.0.1',
            closeServerOnShutdown: true,
            logger: null,
        });
        expect(server.listening).toBe(true);
        expect(server.address()).toEqual({ port: 4321, address: '127.0.0.1' });
        await socketServer.shutdown();
        expect(server.listening).toBe(false);
    });

    test('reports listener close errors only after route cleanup finishes', async () => {
        const server = fakeServer();
        server.listening = true;
        server.close = callback => callback(new Error('listener close failed'));
        const socketServer = new BaseSocketServer(server, {
            routes: [FirstRoute],
            closeServerOnShutdown: true,
            logger: null,
        });
        await expect(socketServer.shutdown()).rejects.toMatchObject({
            message: 'One or more WebSocket server cleanup operations failed.',
        });
    });

    test('owned servers can be created without listening and shutdown repeatedly', async () => {
        const server = new SocketServer({ listen: false, routes: [FirstRoute], logger: null });
        expect(server.ownsServer).toBe(true);
        expect(server.server.listening).toBe(false);
        await server.shutdown();
        await server.shutdown();
    });

    test('secure socket servers can borrow an existing server without TLS file options', async () => {
        const borrowed = http.createServer();
        const server = new SecureSocketServer({ server: borrowed, routes: [FirstRoute], logger: null });
        expect(server.ownsServer).toBe(false);
        expect(server.server).toBe(borrowed);
        await server.shutdown();
    });

    test('default constructors validate required TLS and route inputs', () => {
        const route = new DefaultRoute();
        expect(route.path).toBe('/');
        expect(() => new SecureSocketServer()).toThrow('SSL key and certificate paths must be provided');
    });
});
