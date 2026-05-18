const http = require('http');
const { SocketServer, SocketRoute, BaseHandler } = require('../..');

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

const closeSocketServer = (socketServer) =>
    new Promise((resolve) => {
        if (!socketServer?.server?.listening) return resolve();
        socketServer.server.once('close', resolve);
        socketServer.shutdown();
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

    test('listens by default when it owns the server', async () => {
        const socketServer = new SocketServer({
            port: 0,
            routes: [NoopRoute],
        });

        try {
            expect(socketServer.server.listening).toBe(true);
        } finally {
            await closeSocketServer(socketServer);
        }
    });
});
