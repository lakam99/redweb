const http = require('http');
const { HttpServer, SocketServer, SocketRoute, BaseHandler } = require('../..');

class NoopHandler extends BaseHandler {
    constructor() {
        super('noop');
    }

    onMessage() {}
}

class NoopRoute extends SocketRoute {
    constructor() {
        super({
            path: '/noop',
            handlers: [NoopHandler],
        });
    }
}

const closeSocketServer = (socketServer) => socketServer?.shutdown();

const waitForListening = (socketServer) => new Promise((resolve, reject) => {
    if (socketServer.server.listening) return resolve();
    socketServer.server.once('listening', resolve);
    socketServer.server.once('error', reject);
});

describe('SocketServer', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('does not call listen when attaching to a supplied server by default', () => {
        const server = http.createServer();
        const listenSpy = jest.spyOn(server, 'listen');

        const socketServer = new SocketServer({
            server,
            routes: [NoopRoute],
        });

        expect(socketServer.server).toBe(server);
        expect(listenSpy).not.toHaveBeenCalled();
    });

    test('attaches to a non-listening HttpServer server without starting it', () => {
        const httpServer = new HttpServer({ listen: false });
        const listenSpy = jest.spyOn(httpServer.server, 'listen');

        const socketServer = new SocketServer({
            server: httpServer.server,
            routes: [NoopRoute],
        });

        expect(socketServer.server).toBe(httpServer.server);
        expect(listenSpy).not.toHaveBeenCalled();
        expect(httpServer.server.listening).toBe(false);
    });

    test('listens by default when it owns the server', async () => {
        const socketServer = new SocketServer({
            port: 0,
            routes: [NoopRoute],
        });

        try {
            await waitForListening(socketServer);
            expect(socketServer.server.listening).toBe(true);
        } finally {
            await closeSocketServer(socketServer);
        }
    });
});
