import {
    BaseHandler,
    FixedStepService,
    HttpServer,
    HtmlRenderer,
    RedWebSocket,
    RoomRegistry,
    SessionRegistry,
    SocketRoute,
    SocketServer,
    SocketService,
    ERROR_CODES,
    LiveHtmlServer,
    LivePage,
    action,
    attribute,
    codeBlock,
    component,
    defineSite,
    each,
    exportStatic,
    html,
    page,
    state,
    start,
    url,
    view,
} from 'redweb';

new HttpServer({
    listen: false,
    services: [{
        serviceName: '/health', method: 'get',
        function: (request, response, next) => {
            const path: string = request.path;
            response.status(200).json({ path });
            next();
            // @ts-expect-error Express response status requires a number, not an untyped callback argument.
            response.status('ok');
            // @ts-expect-error Incoming requests are not Express responses.
            request.status(200);
        },
    }],
});

@component()
class TypedComponent {
    @state()
    count = 0;

    @action()
    increment() { this.count += 1; }

    render() { return html`<button rw-click="increment">${this.count}</button>`; }
}

const typedComponent = new TypedComponent();
void typedComponent;

@page('/counter', { template: 'counter.html', css: ['base.css', 'counter.css'] })
class CounterPage extends LivePage {
    @state()
    count = 0;

    @action()
    increment() {
        this.count += 1;
        return html`<strong>${this.count}</strong>`;
    }
}

class CardView {
    @state()
    cards = [{ title: 'Redweb' }];

    @view('cards')
    card(item: { title: string }) {
        return html`<article>${item.title}</article>`;
    }
}
void CardView;
const renderedCards: string = HtmlRenderer.collection(new CardView(), 'cards', new CardView().cards);
void renderedCards;
const navigation = html`<a id="${attribute('api')}" href="${url('#api')}">${'API'}</a>`;
const nested = each([{ name: 'one' }], item => html`<span>${item.name}</span>`);
const readonlyItems = [{ name: 'one' }] as const;
const readonlyNested = each(readonlyItems, item => html`<span>${item.name}</span>`);
const Badge = component((properties: { label: string }) => html`<strong>${properties.label}</strong>`);
const badge = Badge({ label: 'Ready' });
const directAttributes = html`<a id="${'api'}" href="${'#api'}">API</a>`;
const sample = codeBlock('const ready = true', {
    language: 'ts',
    label: 'TypeScript',
    highlight: source => html`<span class="token">${source}</span>`,
});
void navigation;
void nested;
void readonlyNested;
void badge;
void directAttributes;
void sample;

@page('/docs', {
    live: false,
    head: {
        title: 'Redweb API',
        description: 'Reference',
        canonical: 'https://example.test/docs',
        image: 'https://example.test/image.png',
        robots: 'index,follow',
    },
    cache: { maxAge: 60, staleWhileRevalidate: 30 },
})
class DocsPage {
    render() { return html`<h1>Docs</h1>`; }
}
void exportStatic(DocsPage, { outDir: 'dist' });

const site = defineSite({
    origin: 'https://example.test',
    css: ['base.css'] as const,
    head: { description: 'Redweb documentation' },
    layout: (content, context) => html`<body data-path="${context.request.path}">${content}</body>`,
});
@site.page('/site', { css: 'site.css', head: { title: 'Site' } })
class SitePage {
    render() { return html`<h1>Site</h1>`; }
}
void site.export([SitePage] as const, { outDir: 'dist', publicDir: 'public' });

const live = new LiveHtmlServer({ pages: [CounterPage], listen: false });
void live.shutdown();
void start(CounterPage, { listen: false }).shutdown();

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
const protectedRooms = new RoomRegistry({
    authorize: async (context, roomId) => {
        void context.request.get('cookie');
        void context.signal.aborted;
        return context.principal === 'alice' && roomId === 'private';
    },
    authorizationTimeoutMs: 500,
    maxPendingAuthorizations: 16,
    maxPendingPerConnection: 2,
});
route.clients.forEach(async socket => {
    const joined: boolean = await socket.enterRoom!('private');
    const entered: boolean = await protectedRooms.enter('private', socket);
    protectedRooms.broadcastFrom(socket, 'private', { update: true });
    if (socket.context) {
        // @ts-expect-error Authenticated context identity is read-only.
        socket.context.principal = 'forged';
        // @ts-expect-error Captured request data is read-only.
        socket.context.request.headers.authorization = 'forged';
    }
    void joined; void entered;
});
// @ts-expect-error Authorization deadline requires a policy.
new RoomRegistry({ authorizationTimeoutMs: 100 });
// @ts-expect-error A policy must return a boolean, not a truthy credential.
new RoomRegistry({ authorize: () => 'allowed' });
const standaloneSessions = new SessionRegistry<{ score: number }>({ maxSessions: 2 });
void standaloneRooms;
void standaloneSessions;
void Simulation;
void CallbackRoute;
new HttpServer({ listen: false, corsOptions: false });

const inspectedServer = new SocketServer({ listen: false, development: { inspect: true } });
const inspection = inspectedServer.inspect();
if (inspection?.sockets.available) {
    const registered: number = inspection.sockets.routes.items[0].registeredConnections;
    void registered;
    // @ts-expect-error Inspection snapshots are deeply read-only.
    inspection.sockets.routes.items.push({ path: '/fake' });
}
// @ts-expect-error Inspection is explicitly boolean, not a callback or endpoint.
new SocketServer({ development: { inspect: () => true } });
// @ts-expect-error Inspection belongs to servers, not individual routes.
route.inspect();
// @ts-expect-error Raw socket services have no HTML browser refresh.
new SocketServer({ development: { refresh: true } });
new LiveHtmlServer({ pages: [CounterPage], listen: false, development: { refresh: true, inspect: true } });

new SocketRoute({
    path: '/invalid',
    handlers: [EchoHandler],
    // @ts-expect-error Redweb owns listener selection for each route.
    websocketOptions: { port: 9000 },
});
