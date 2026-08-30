import { BaseHandler, SocketRoute, SocketServer, type RedWebSocket, type SocketServerOptions } from 'redweb';

export class EchoHandler extends BaseHandler {
    constructor() { super('echo'); }

    override validateMessage(message: { text?: unknown }) {
        return typeof message.text === 'string' && message.text.length <= 500;
    }

    override onMessage(socket: RedWebSocket, message: { text: string }) {
        socket.sendJson({ type: 'echo', text: message.text });
    }
}

export class EventsRoute extends SocketRoute {
    constructor() {
        super({
            path: '/events',
            handlers: [EchoHandler],
            allowDuplicateConnections: true,
            websocketOptions: { maxPayload: 4096 },
            limits: { maxConnections: 100, maxPendingMessages: 32, maxBufferedBytes: 65536 },
        });
    }
}

export function createApp(options: SocketServerOptions = {}) {
    return new SocketServer({
        port: Number(process.env.PORT ?? 8181),
        routes: [EventsRoute],
        ...options,
    });
}

if (require.main === module) createApp();
