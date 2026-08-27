import {
    BaseHandler,
    HttpServer,
    RedWebSocket,
    SocketRoute,
    SocketService,
} from 'redweb';

class EchoHandler extends BaseHandler {
    constructor() {
        super('echo');
    }

    onMessage(socket: RedWebSocket, message: { value: string }) {
        socket.sendJson({ value: message.value });
        return socket.broadcast({ value: message.value });
    }
}

class HeartbeatService extends SocketService {
    constructor() {
        super('heartbeat', 1000);
    }

    onTick() {
        for (const socket of this.route.clients.values()) {
            socket.sendJson({ type: 'heartbeat' });
        }
    }
}

const route = new SocketRoute({
    path: '/events',
    handlers: [EchoHandler],
    services: [HeartbeatService],
    shutdownTimeoutMs: 250,
    websocketOptions: { maxPayload: 1024 },
});

route.clients.forEach(socket => socket.sendJson({ ready: true }));
new HttpServer({ listen: false, corsOptions: false });

new SocketRoute({
    path: '/invalid',
    handlers: [EchoHandler],
    // @ts-expect-error Redweb owns listener selection for each route.
    websocketOptions: { port: 9000 },
});
