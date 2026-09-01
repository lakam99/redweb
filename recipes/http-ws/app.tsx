import { BaseHandler, HttpServer, METHODS, SocketRoute, SocketServer, type RedWebSocket, type SocketServerOptions } from 'redweb';
import { runApp } from './run-app';

export class Hello extends BaseHandler {
    constructor() { super('hello'); }

    onMessage(socket: RedWebSocket) {
        socket.sendJson({ type: 'hello', message: 'Hello from the server!' });
    }
}

export class ChatRoute extends SocketRoute {
    constructor() {
        super({ path: '/chat', handlers: [Hello], allowDuplicateConnections: true });
    }
}

export function createApp(options: Pick<SocketServerOptions, 'port' | 'bind' | 'logger'> = {}) {
    const http = new HttpServer({
        listen: false,
        publicPaths: [],
        services: [{ serviceName: '/health', method: METHODS.GET, function: (_req, res) => res.json({ ok: true }) }],
    });

    return new SocketServer({
        port: options.port ?? Number(process.env.PORT ?? 8181),
        bind: options.bind ?? '127.0.0.1',
        logger: options.logger,
        server: http.server,
        routes: [ChatRoute],
        listen: true,
        closeServerOnShutdown: true, // One owner closes routes and the shared HTTP listener.
    });
}

if (require.main === module) runApp(createApp);
