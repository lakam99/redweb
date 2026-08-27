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

    override onMessage(socket: RedWebSocket, message: { value: string }) {
        socket.sendJson({ value: message.value });
        return socket.broadcast({ value: message.value });
    }
}

class HeartbeatService extends SocketService {
    constructor() {
        super('heartbeat', 1000);
    }

    override onTick() {
        for (const socket of this.route.clients.values()) {
            socket.sendJson({ type: 'heartbeat' });
        }
    }
}

class CallbackRoute extends SocketRoute {
    override connectionOpenCallback(socket: RedWebSocket) {
        socket.sendJson({ connected: true });
    }

    override connectionCloseCallback(socket: RedWebSocket) {
        return socket.clientKey;
    }
}

const route = new SocketRoute({
    path: '/events',
    handlers: [EchoHandler],
    services: [HeartbeatService],
    shutdownTimeoutMs: 250,
    websocketOptions: { maxPayload: 1024 },
    admission: {
        origins: ['https://game.example'],
        timeoutMs: 1000,
        authenticate: async (_request, { signal, networkIdentity }) => {
            if (signal.aborted) return false;
            return { playerId: networkIdentity };
        },
    },
    limits: {
        maxConnections: 100,
        maxBufferedBytes: 1024 * 1024,
        maxPendingMessages: 32,
        messageRate: { capacity: 30, refillPerSecond: 15, action: 'disconnect' },
        slowConsumerAction: 'drop',
    },
    orderedMessages: true,
    heartbeat: { intervalMs: 30_000, timeoutMs: 10_000 },
});

route.clients.forEach(socket => {
    socket.sendJson({ ready: true });
    const player = socket.context?.principal;
    void player;
});
void CallbackRoute;
new HttpServer({ listen: false, corsOptions: false });

new SocketRoute({
    path: '/invalid',
    handlers: [EchoHandler],
    // @ts-expect-error Redweb owns listener selection for each route.
    websocketOptions: { port: 9000 },
});
