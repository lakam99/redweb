import { BaseHandler, defineApp, METHODS, SocketRoute, type RedWebSocket } from 'redweb';

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

export const app = defineApp({
    sockets: [ChatRoute],
    port: Number(process.env.PORT ?? 8181),
    bind: '127.0.0.1',
    publicPaths: [],
    httpServices: [{ serviceName: '/health', method: METHODS.GET, function: (_req, res) => res.json({ ok: true }) }],
});

if (require.main === module) void app.run().catch(error => { console.error(error); process.exitCode = 1; });
