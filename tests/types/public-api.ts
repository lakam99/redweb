import {
    BaseHandler,
    FixedStepService,
    HttpServer,
    RedWebSocket,
    RoomRegistry,
    SessionRegistry,
    SocketRoute,
    SocketService,
    ERROR_CODES,
    LiveHtmlServer,
    LivePage,
    action,
    html,
    page,
    state,
} from 'redweb';

@page('/counter', { template: 'counter.htmx' })
class CounterPage extends LivePage {
    @state()
    count = 0;

    @action()
    increment() {
        this.count += 1;
        return html`<strong>${this.count}</strong>`;
    }
}

const live = new LiveHtmlServer({ pages: [CounterPage], listen: false });
void live.shutdown();

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

class Simulation extends FixedStepService {
    constructor() { super('simulation', 50, 2); }
    override async onTick(stepMs: number, tick: number) {
        await Promise.resolve(stepMs + tick);
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
    rooms: { maxRooms: 100, maxMembersPerRoom: 16 },
    sessions: { ttlMs: 30_000, maxSessions: 1000 },
    metrics: {
        increment(_name, _value, attributes) { void attributes.route; },
        gauge() {},
    },
    protocol: {
        versions: ['1'],
        binary: {
            maxBytes: 1024,
            encode: value => Buffer.from(JSON.stringify(value)),
            decode: buffer => JSON.parse(buffer.toString()),
        },
    },
});

route.clients.forEach(socket => {
    socket.sendJson({ ready: true });
    const player = socket.context?.principal;
    socket.joinRoom?.('lobby');
    socket.roomBroadcast?.('lobby', { ready: true }, { except: socket });
    socket.createSession?.('opaque-session', { player });
    void player;
    void socket.context?.protocol?.version;
    socket.sendEvent?.('ready', {}, { requestId: 'request', sequence: 1 });
    socket.sendProtocolError?.(ERROR_CODES.INVALID_MESSAGE, 'invalid');
    void socket.sendBinaryEvent?.({ ready: true });
});
const standaloneRooms = new RoomRegistry({ maxRooms: 2 });
const standaloneSessions = new SessionRegistry<{ score: number }>({ maxSessions: 2 });
void standaloneRooms;
void standaloneSessions;
void Simulation;
void CallbackRoute;
new HttpServer({ listen: false, corsOptions: false });

new SocketRoute({
    path: '/invalid',
    handlers: [EchoHandler],
    // @ts-expect-error Redweb owns listener selection for each route.
    websocketOptions: { port: 9000 },
});
