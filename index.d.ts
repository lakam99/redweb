declare module 'redweb' {
    export { defineSocketContract } from 'redweb/contract';
    export type { SocketContract, ContractClient, SocketSchema, ContractInput, ContractOutput, ContractMessage } from 'redweb/contract';
    import { Application as ExpressApplication, RequestHandler } from 'express';
    import { CorsOptions } from 'cors';
    import { Server as NodeHttpServer } from 'http';
    import { Server as NodeHttpsServer } from 'https';
    import { WebSocket, ServerOptions } from 'ws';
    import { Buffer } from 'buffer';
    import { EventEmitter } from 'events';

    /** ─────────────────── HTTP / CORE ─────────────────── */

    export type RedWebEncoding = 'json' | 'urlencoded';

    export interface RedWebOptions {
        port?: number;
        bind?: string;
        publicPaths?: string[];
        services?: Array<{ serviceName: string; method: string; function: RequestHandler }>;
        listen?: boolean;
        listenCallback?: () => void;
        encoding?: RedWebEncoding;
        ssl?: { key: string; cert: string };
        server?: ExpressApplication;
        corsOptions?: CorsOptions | false;
        exposeErrors?: boolean;
        logger?: RedWebLogger | null;
    }

    export type RedWebSocket = WebSocket & {
        clientKey: string;
        __redwebClientKey: string;
        remoteAddress: string;
        isAssigned: boolean;
        sendJson(data: unknown): boolean;
        broadcast(data: unknown): number;
        context?: RedWebConnectionContext;
        joinRoom?(roomId: string): boolean;
        /** Bounded permission check followed by atomic membership insertion. */
        enterRoom?(roomId: string): Promise<boolean>;
        leaveRoom?(roomId: string): boolean;
        roomBroadcast?(roomId: string, data: unknown, options?: { except?: RedWebSocket }): number;
        createSession?(sessionId: string, data: unknown): boolean;
        resumeSession?(sessionId: string): unknown | null;
        publishEvent?(type: string, payload: unknown): Promise<boolean>;
        sendEvent?(type: string, payload: unknown, metadata?: ProtocolMetadata): boolean;
        sendProtocolError?(code: string, message: string, metadata?: ProtocolMetadata): boolean;
        sendBinaryEvent?(value: unknown): Promise<boolean>;
    };

    export interface RedWebConnectionContext extends RequestContext {
        readonly connectionId: string;
        readonly principal: unknown;
        session: unknown | null;
        metadata: Record<string, unknown>;
        readonly protocol?: Readonly<{ version: string }>;
    }

    export interface AdmissionContext {
        signal: AbortSignal;
        networkIdentity: string;
        route: SocketRoute;
    }

    export interface AdmissionOptions {
        authenticate?: (
            request: import('http').IncomingMessage,
            context: AdmissionContext
        ) => unknown | false | Promise<unknown | false>;
        origins?: string[] | ((
            origin: string | undefined,
            request: import('http').IncomingMessage
        ) => boolean | Promise<boolean>);
        place?: (
            principal: unknown,
            request: import('http').IncomingMessage,
            context: AdmissionContext
        ) => string | false | null | undefined | Promise<string | false | null | undefined>;
        allowedPlacementOrigins?: string[];
        allowInsecurePlacement?: boolean;
        timeoutMs?: number;
    }

    export interface MessageRateLimit {
        capacity: number;
        refillPerSecond: number;
        action?: 'drop' | 'disconnect';
    }

    export interface TransportLimits {
        maxConnections?: number;
        maxBufferedBytes?: number;
        maxPendingMessages?: number;
        messageRate?: MessageRateLimit;
        slowConsumerAction?: 'drop' | 'disconnect';
    }

    export interface HeartbeatOptions {
        intervalMs: number;
        timeoutMs: number;
    }

    export type RoomOptions = {
        maxRooms?: number;
        maxMembersPerRoom?: number;
        maxRoomsPerConnection?: number;
        maxRoomIdLength?: number;
    } & ({ authorize?: undefined; authorizationTimeoutMs?: never; maxPendingAuthorizations?: never; maxPendingPerConnection?: never } | {
        /** Grants subscription until explicit leave/disconnect; not per-message receive authorization. */
        authorize: (context: Readonly<RedWebConnectionContext>, roomId: string) => boolean | Promise<boolean>;
        authorizationTimeoutMs?: number;
        maxPendingAuthorizations?: number;
        maxPendingPerConnection?: number;
    });

    export interface SessionOptions {
        ttlMs?: number;
        maxSessions?: number;
        maxSessionIdLength?: number;
        sweepIntervalMs?: number;
    }

    export interface MetricsSink {
        increment?(name: string, value: number, attributes: Readonly<{ route: string }>): void | Promise<void>;
        gauge?(name: string, value: number, attributes: Readonly<{ route: string }>): void | Promise<void>;
        observe?(name: string, value: number, attributes: Readonly<{ route: string }>): void | Promise<void>;
    }

    export interface DistributionEvent<T = unknown> {
        id: string;
        source: string;
        type: string;
        payload: T;
    }

    export interface DistributionAdapter {
        start?(signal?: AbortSignal): void | Promise<void>;
        publish(channel: string, serializedEvent: string, signal?: AbortSignal): void | Promise<void>;
        subscribe(
            channel: string,
            onEvent: (serializedEvent: string | DistributionEvent) => void,
            signal?: AbortSignal
        ): void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>;
        unsubscribe?(channel: string, signal?: AbortSignal): void | Promise<void>;
        close?(signal?: AbortSignal): void | Promise<void>;
    }

    export interface DistributionOptions {
        adapter: DistributionAdapter;
        channel: string;
        nodeId?: string;
        maxEventBytes?: number;
        maxSeenEvents?: number;
        seenTtlMs?: number;
        lifecycleTimeoutMs?: number;
        publishTimeoutMs?: number;
        maxConcurrentPublishes?: number;
        maxConcurrentEvents?: number;
        required?: boolean;
        onEvent(event: DistributionEvent, route: SocketRoute): void | Promise<void>;
    }

    export interface ProtocolMetadata {
        requestId?: string;
        sequence?: number;
    }

    export interface ProtocolBinaryCodec {
        maxBytes?: number;
        encode(value: unknown, context: RedWebConnectionContext): Buffer | Uint8Array | ArrayBuffer | Promise<Buffer | Uint8Array | ArrayBuffer>;
        decode(buffer: Buffer, context: RedWebConnectionContext): unknown | Promise<unknown>;
    }

    export interface ProtocolOptions {
        versions: readonly string[];
        required?: boolean;
        queryParameter?: string;
        header?: string;
        binary?: false | ProtocolBinaryCodec;
    }

    /** ─────────────────── SOCKET SERVER ─────────────────── */

    export interface DevelopmentOptions {
        /** Explicit local-only inspection; rejected when NODE_ENV is production. */
        inspect?: boolean;
    }

    export interface LiveDevelopmentOptions extends DevelopmentOptions {
        /** Loopback-only browser refresh. False overrides REDWEB_DEV_REFRESH=1. */
        refresh?: boolean;
    }

    export interface InspectionList<T> {
        readonly items: readonly T[];
        readonly total: number;
        readonly truncated: boolean;
    }
    export type InspectionSection<T> = { readonly available: false } | ({ readonly available: true } & T);
    export interface InspectionMembers {
        readonly className: string;
        readonly actions: InspectionList<string>;
        readonly states: InspectionList<string>;
    }
    export interface InspectionPage extends InspectionMembers {
        readonly path: string;
        readonly live: boolean;
        readonly shared: boolean;
        readonly instanceMetadata: 'observed' | 'unobserved';
        readonly instances: InspectionList<{
            readonly id: number;
            readonly disposed: boolean;
            readonly components: InspectionList<InspectionMembers & { readonly id: string }>;
        }>;
    }
    export interface InspectionSession {
        /** Inspector-local IDs; never page tokens, credentials or socket IDs. */
        readonly render: number;
        readonly instance: number;
        readonly route: string;
        readonly status: 'connected' | 'detaching' | 'pending' | 'retained';
        readonly reactive: boolean;
    }
    export interface InspectionEvent {
        readonly sequence: number;
        readonly render: number;
        readonly route: string;
        readonly kind: 'state-invalidated' | 'flush-started' | 'flush-completed' | 'flush-superseded' | 'flush-failed';
        readonly state?: string;
        readonly component?: string;
        readonly affectedOwners?: InspectionList<string>;
        readonly snapshot?: boolean;
        readonly dirtyOwners?: InspectionList<string>;
        readonly durationMs?: number;
    }
    export interface DevelopmentSnapshot {
        readonly schemaVersion: 1;
        readonly mode: 'development';
        readonly pages: InspectionSection<{
            readonly registrations: InspectionList<InspectionPage>;
            readonly sessions: InspectionList<InspectionSession>;
            readonly closing?: boolean;
            readonly rendering?: number;
            readonly connections?: Readonly<Record<InspectionSession['status'], number>>;
        }>;
        readonly sockets: InspectionSection<{
            readonly routes: InspectionList<{
                readonly path: string;
                readonly handlers: InspectionList<string>;
                readonly registeredConnections: number;
                readonly draining: boolean;
                readonly rooms: number;
                readonly sessions: number;
            }>;
            readonly pendingUpgrades: number;
            readonly draining: boolean;
        }>;
        /** Flush completion is not a network delivery guarantee. */
        readonly history: InspectionList<InspectionEvent> & { readonly limit: number };
    }

    export interface SocketServerOptions {
        development?: DevelopmentOptions;
        server?: NodeHttpServer;
        port?: number;
        bind?: string;
        listen?: boolean;
        routes?: Array<new () => SocketRoute>;
        ssl?: { key: string; cert: string };
        fallbackToRoot?: boolean;
        closeServerOnShutdown?: boolean;
        listenCallback?: () => void;
        logger?: RedWebLogger | null;
    }

    export interface RedWebLogger {
        log?(message?: any, ...optionalParams: any[]): void;
        warn?(message?: any, ...optionalParams: any[]): void;
        error?(message?: any, ...optionalParams: any[]): void;
    }

    /** ─────────────────── ROUTES & HANDLERS ─────────────────── */

    export interface SocketRouteConfig {
        path: string;
        handlers: Array<new () => BaseHandler>;
        services?: Array<new () => SocketService>;
        allowDuplicateConnections?: boolean;
        websocketOptions?: Omit<ServerOptions, 'noServer' | 'path' | 'server' | 'port'> & {
            /** Closing-handshake deadline in milliseconds (1..2147483647). Default: 5000. Not an idle timeout. */
            closeTimeout?: number;
        };
        trustProxy?: boolean;
        getClientKey?: (request: import('http').IncomingMessage) => string;
        exposeErrors?: boolean;
        logger?: RedWebLogger | null;
        shutdownTimeoutMs?: number;
        admission?: AdmissionOptions | AdmissionOptions['authenticate'];
        limits?: TransportLimits;
        orderedMessages?: boolean;
        heartbeat?: HeartbeatOptions;
        rooms?: boolean | RoomOptions;
        sessions?: boolean | SessionOptions;
        metrics?: MetricsSink;
        distribution?: false | DistributionOptions;
        drainHandlers?: boolean;
        protocol?: false | ProtocolOptions;
        maxPendingUpgrades?: number;
    }

    /** Socket‑side autonomous service (game loops, timers, etc.) */
    export abstract class SocketService {
        name: string;
        tickRateMs: number | null;
        route: SocketRoute;
        protected _tickHandle: NodeJS.Timeout | null;

        constructor(name: string, tickRateMs?: number);

        /** Called once when the route is initialised */
        onInit(route: SocketRoute): void;

        /** Optional recurring tick (respecting tickRateMs) */
        onTick?(...args: any[]): unknown;

        /** Called on process shutdown / route removal */
        onShutdown(): void;
    }

    export abstract class FixedStepService extends SocketService {
        maxCatchUpTicks: number;
        maxRetainedLagMs: number;
        tick: number;
        accumulatorMs: number;

        constructor(name: string, tickRateMs: number, maxCatchUpTicks?: number, maxRetainedLagMs?: number);
        onTick?(stepMs: number, tick: number): void | Promise<void>;
        onLagDropped?(droppedLagMs: number): void;
        pulse(): Promise<void>;
        onShutdown(): Promise<void>;
    }

    /** Message handler, triggered by client messages */
    export class BaseHandler {
        name: string;
        constructor(name: string);

        handleMessage(
            socket: RedWebSocket,
            message: any
        ): Promise<unknown>;

        validateMessage(message: any, socket: RedWebSocket): boolean | Promise<boolean>;
        onMessage(socket: RedWebSocket, message: any): unknown;
        acceptsBinary?(socket: RedWebSocket, buffer: Buffer): boolean;
        handleBinaryMessage(socket: RedWebSocket, buffer: Buffer): Promise<unknown>;
        onBinaryMessage(socket: RedWebSocket, buffer: Buffer): unknown;
        onInitialContact(socket: RedWebSocket, request?: import('http').IncomingMessage): unknown;
    }

    export class SocketRoute {
        path: string;
        handlers: BaseHandler[];
        services: SocketService[];
        clients: Map<string, RedWebSocket>;
        rooms: RoomRegistry | null;
        sessions: SessionRegistry | null;
        distribution: unknown | null;
        protocolPolicy: unknown | null;
        draining: boolean;
        allowDuplicateConnections?: boolean;
        websocketOptions?: SocketRouteConfig['websocketOptions'];

        constructor(config: SocketRouteConfig);

        addHandler(handler: new () => BaseHandler): boolean;
        resolveRemoteAddress(request: import('http').IncomingMessage): string;
        connectionOpenCallback(socket: RedWebSocket, request?: import('http').IncomingMessage): unknown;
        connectionCloseCallback?(socket: RedWebSocket): unknown;
        handleMessage(sock: RedWebSocket, data: any): Promise<boolean>;
        handleBinaryMessage(socket: RedWebSocket, buffer: Buffer): Promise<boolean>;
        beginDrain(): boolean;
        isReady(): boolean;
        publish(type: string, payload: unknown): Promise<boolean>;
        shutdown(): Promise<void>;
    }

    /** ─────────────────── SERVER BASE ─────────────────── */

    export class BaseSocketServer {
        server: NodeHttpServer;
        routes: SocketRoute[];
        ownsServer: boolean;

        constructor(server: NodeHttpServer, options?: SocketServerOptions);

        addRoute(route: new () => SocketRoute): SocketRoute;
        isReady(): boolean;
        inspect(): DevelopmentSnapshot | null;
        beginDrain(): boolean;
        shutdown(): Promise<void>;
    }

    /** ─────────────────── REGISTRY & UTIL TYPES ─────────────────── */

    export function sendJson(socket: WebSocket, data: unknown): boolean;

    export class RoomRegistry {
        constructor(options?: RoomOptions);
        join(roomId: string, socket: RedWebSocket): boolean;
        enter(roomId: string, socket: RedWebSocket): Promise<boolean>;
        leave(roomId: string, socket: RedWebSocket): boolean;
        leaveAll(socket: RedWebSocket): number;
        members(roomId: string): RedWebSocket[];
        has(roomId: string, socket: RedWebSocket): boolean;
        broadcast(roomId: string, data: unknown, options?: { except?: RedWebSocket }): number;
        broadcastFrom(socket: RedWebSocket, roomId: string, data: unknown, options?: { except?: RedWebSocket }): number;
        clear(): void;
        close(): boolean;
        readonly size: number;
    }

    export class SessionRegistry<T = unknown> {
        constructor(options?: SessionOptions, logger?: RedWebLogger | null);
        create(sessionId: string, data: T, socket?: RedWebSocket): boolean;
        resume(sessionId: string, socket: RedWebSocket): T | null;
        release(socket: RedWebSocket): boolean;
        remove(sessionId: string): boolean;
        get(sessionId: string): T | undefined;
        sweep(): void;
        stop(): void;
        readonly size: number;
    }

    export interface SocketWrapper {
        socket: RedWebSocket;
        id: string;
        send: (type: string, payload: Record<string, any>) => void;
        getSanitized?(): Record<string, any>;
    }

    export type SocketMessage = {
        type: string;
        [key: string]: any;
    };

    /** Generic event‑driven registry for socket objects */
    /** Generic event-driven registry for socket objects */
    export class SocketRegistry<T extends SocketWrapper = SocketWrapper> extends EventEmitter {
        protected items: T[];

        constructor();

        /** Adds a socket-bound object to the registry */
        add(item: T): void;

        /**
         * Removes a socket-bound object by reference or id (default key: 'id')
         * @param itemOrId Object or ID string
         * @param by Key name to match against (default is 'id')
         */
        remove(itemOrId: T | string, by?: keyof T): boolean;

        /** Returns a shallow copy of all registered items */
        all(): T[];

        /** Returns the number of registered items */
        count(): number;
    }

    /** ─────────────────── CONCRETE SERVERS ─────────────────── */

    export class SocketServer extends BaseSocketServer {
        constructor(options?: SocketServerOptions);
    }

    export class SecureSocketServer extends BaseSocketServer {
        constructor(options?: SocketServerOptions);
    }

    export class BaseHttpServer {
        app: ExpressApplication;
        server?: NodeHttpServer;
        constructor(options?: RedWebOptions);
        shutdown?(): Promise<void>;
    }

    export class HttpServer extends BaseHttpServer {
        constructor(options?: RedWebOptions);
        shutdown(): Promise<void>;
    }

    export class HttpsServer extends BaseHttpServer {
        constructor(options?: RedWebOptions);
        shutdown(): Promise<void>;
    }

    /** ─────────────────── LIVE HTML ─────────────────── */

    const htmlFragmentBrand: unique symbol;
    const htmlAttributeBrand: unique symbol;
    const htmlUrlBrand: unique symbol;

    export interface HtmlFragment {
        readonly [htmlFragmentBrand]: true;
        toString(): string;
    }

    export interface HtmlAttribute {
        readonly [htmlAttributeBrand]: true;
    }

    export interface HtmlUrl {
        readonly [htmlUrlBrand]: true;
    }

    export interface RedWebRequest {
        readonly path: string;
        readonly url: string;
        readonly method: string;
        readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
        readonly params: Readonly<Record<string, string>>;
        readonly query: Readonly<Record<string, unknown>>;
        readonly body: unknown;
        get(name: string): string | undefined;
    }

    export interface LivePageRequest extends RedWebRequest {}

    export interface RequestContext<Principal = unknown> {
        readonly request: RedWebRequest;
        readonly params: Readonly<Record<string, string>>;
        readonly query: Readonly<Record<string, unknown>>;
        readonly body: unknown;
        readonly principal?: Principal;
        readonly signal: AbortSignal;
    }

    export interface LivePageRequestContext extends RequestContext<string | number | bigint | boolean> {}

    /** The original page request/identity is retained across normal reconnects. */
    export interface LivePageConnectionContext extends LivePageRequestContext {
        socket: RedWebSocket;
    }

    export abstract class LivePage {
        protected readonly _connections: Set<RedWebSocket>;
        loading?(context: LivePageRequestContext): void | Promise<void>;
        render?(context: LivePageRequestContext): string | HtmlFragment | Promise<string | HtmlFragment>;
        connected?(context: LivePageConnectionContext): void | Promise<void>;
        disconnected?(context: LivePageConnectionContext): void | Promise<void>;
        disposed?(): void | Promise<void>;
        dispose(): Promise<boolean>;
    }

    export type PageOptions = {
        template?: string;
        css?: string | readonly string[];
        live?: boolean;
        head?: PageHead;
        cache?: PageCache;
        layout?: PageLayout;
    } & ({
        scope?: 'connection' | 'shared'; shared?: boolean;
        authorize?: undefined; authorizationTimeoutMs?: never;
    } | {
        scope?: 'connection'; shared?: false;
        /** Checked before construction/loading, on connection, and before actions/state writes. */
        authorize: (context: LivePageRequestContext) => boolean | Promise<boolean>;
        authorizationTimeoutMs?: number;
    });

    export type PageLayout = (content: HtmlFragment, context: LivePageRequestContext) => HtmlFragment;

    export interface PageHead {
        title?: string;
        description?: string;
        canonical?: string;
        image?: string;
        robots?: string;
    }

    export interface PageCache {
        maxAge?: number;
        staleWhileRevalidate?: number;
        immutable?: boolean;
    }

    export interface StateOptions {
        writable?: boolean;
    }

    export interface LiveStateDecorator {
        (target: object, propertyKey: string): void;
        <This, Value>(value: undefined, context: ClassFieldDecoratorContext<This, Value>):
            (this: This, initialValue: Value) => Value;
    }

    export interface LiveActionDecorator {
        (target: object, propertyKey: string, descriptor: PropertyDescriptor): void | PropertyDescriptor;
        <This, Value extends (this: This, ...args: any[]) => any>(
            value: Value,
            context: ClassMethodDecoratorContext<This, Value>
        ): Value;
    }

    /** The validated (possibly transformed) value passed as an action's first argument. */
    export type ActionInput<Schema extends import('redweb/contract').SocketSchema> = import('redweb/contract').ContractOutput<Schema>;

    export interface ValidatedActionDecorator<Input> {
        <Value extends (input: Input, context: LivePageConnectionContext) => any>(target: object, propertyKey: string,
            descriptor: TypedPropertyDescriptor<Value>): void;
        <This, Value extends (this: This, input: Input, context: LivePageConnectionContext) => any>(
            value: Value, context: ClassMethodDecoratorContext<This, Value>
        ): Value;
    }

    export interface LiveViewDecorator {
        (target: object, propertyKey: string, descriptor: PropertyDescriptor): void | PropertyDescriptor;
        <This, Value extends (this: This, item: any, index: number) => HtmlFragment>(
            value: Value,
            context: ClassMethodDecoratorContext<This, Value>
        ): Value;
    }

    export function page(path: string, options?: PageOptions): ClassDecorator;
    export function component(): ClassDecorator;
    export function component<Props = void>(render: (properties: Props) => HtmlFragment):
        (properties: Props) => HtmlFragment;
    export function state(options?: StateOptions): LiveStateDecorator;
    export function action(): LiveActionDecorator;
    export interface ActionAuthorization<Input> {
        authorize: (context: LivePageConnectionContext, input: Input) => boolean | Promise<boolean>;
        /** Bounds permission checks, not application execution; defaults to 5000ms. */
        authorizationTimeoutMs?: number;
    }
    export function action<Schema extends import('redweb/contract').SocketSchema>(options: {
        input: Schema;
        /** Bounds input validation, not application execution; defaults to 5000ms. */
        validationTimeoutMs?: number;
    } & (ActionAuthorization<ActionInput<Schema>> | { authorize?: undefined; authorizationTimeoutMs?: never })): ValidatedActionDecorator<ActionInput<Schema>>;
    /** Authorized actions use a fixed (input, context) shape, including buttons without a payload. */
    export function action(options: ActionAuthorization<unknown>): ValidatedActionDecorator<unknown>;
    export function view(stateName: string): LiveViewDecorator;
    export function html(strings: TemplateStringsArray, ...values: unknown[]): HtmlFragment;
    export function attribute(value: string | number | bigint | boolean): HtmlAttribute;
    export function url(value: string): HtmlUrl;
    export function each<Item>(items: readonly Item[], render: (item: Item, index: number) => HtmlFragment): HtmlFragment;
    export function codeBlock(code: unknown, options?: {
        language?: string;
        label?: string;
        highlight?: (source: string, language: string) => HtmlFragment;
    }): HtmlFragment;

    export type LivePageClass = new () => object;

    export interface LiveHtmlServerBaseOptions extends Omit<RedWebOptions, 'enableHtmxRendering'> {
        /** Custom routes share the live-page SocketServer; paths must be unique. */
        socketRoutes?: Array<new () => SocketRoute>;
        development?: LiveDevelopmentOptions;
        pages: readonly LivePageClass[];
        templateRoot?: string;
        livePaths?: {
            socket?: string;
            client?: string;
            runtime?: string;
            css?: string;
        };
        sessionTtlMs?: number;
        maxSessions?: number;
        maxConcurrentRenders?: number;
        /** Phase-local render/route and final owned-HTTP cleanup bound; defaults to 1000ms, not a total application deadline. */
        shutdownTimeoutMs?: number;
        heartbeat?: HeartbeatOptions;
        origins?: string[] | ((origin: string | undefined, request: import('http').IncomingMessage) => boolean | Promise<boolean>);
    }

    export type LiveHtmlAuthentication = {
        authenticate(request: import('http').IncomingMessage | import('express').Request):
            string | number | bigint | boolean | null | undefined |
            Promise<string | number | bigint | boolean | null | undefined>;
        /** Bounds identity lookup, not external application work; defaults to 5000ms. */
        authenticationTimeoutMs?: number;
    } | { authenticate?: undefined; authenticationTimeoutMs?: never };
    export type LiveHtmlServerOptions = LiveHtmlServerBaseOptions & LiveHtmlAuthentication;
    export type LiveHtmlStartOptions = Omit<LiveHtmlServerBaseOptions, 'pages'> & LiveHtmlAuthentication;

    export class LiveHtmlServer {
        app: ExpressApplication;
        server: NodeHttpServer | NodeHttpsServer;
        http: HttpServer | HttpsServer;
        sockets: SocketServer | null;
        constructor(options: LiveHtmlServerOptions);
        /** Revoke matching in-process sessions/renders; credential invalidation remains application-owned. */
        revoke(principal: string | number | bigint | true): Promise<number>;
        /** Local metadata only; null unless development inspection was explicitly enabled. */
        inspect(): DevelopmentSnapshot | null;
        shutdown(): Promise<void>;
    }

    export function start(
        pageOrPages: LivePageClass | readonly LivePageClass[],
        options?: LiveHtmlStartOptions
    ): LiveHtmlServer;

    export interface ApplicationContext {
        app: ExpressApplication;
        server: NodeHttpServer | NodeHttpsServer;
        http: HttpServer | HttpsServer;
        sockets: SocketServer | null;
        services: ApplicationService[];
    }

    /** Application-wide resources; route-specific SocketService classes stay on their routes. */
    export interface ApplicationService {
        onInit(app: ApplicationContext, signal: AbortSignal): void | Promise<void>;
        onShutdown(): void | Promise<void>;
    }

    export type ApplicationOptions = Omit<LiveHtmlServerBaseOptions, 'pages' | 'services' | 'listen' | 'socketRoutes'> & LiveHtmlAuthentication & {
        pages?: readonly LivePageClass[];
        sockets?: ReadonlyArray<new () => SocketRoute>;
        services?: ReadonlyArray<new () => ApplicationService>;
        httpServices?: RedWebOptions['services'];
        startupTimeoutMs?: number;
        /** Install process signal handlers only when run() is called; defaults to true. */
        signals?: boolean;
    };

    export class Application {
        constructor(options?: ApplicationOptions);
        /** Copied definition; use {...app.options, port: 0} to define an independent test instance. */
        readonly options: Readonly<ApplicationOptions>;
        readonly app: ExpressApplication | null;
        readonly server: NodeHttpServer | NodeHttpsServer | null;
        readonly http: HttpServer | HttpsServer | null;
        readonly sockets: SocketServer | null;
        readonly services: ApplicationService[];
        /** Resolves after services initialize and the single HTTP/WS listener is ready. Cannot restart after shutdown. */
        run(): Promise<Application & ApplicationContext>;
        shutdown(): Promise<void>;
        revoke(principal: string | number | bigint | true): Promise<number>;
        inspect(): DevelopmentSnapshot | null;
    }

    /** Inert until run(); repeated run calls share startup until shutdown; shutdown is idempotent. */
    export function defineApp(options?: ApplicationOptions): Application;

    export interface StaticExportOptions {
        outDir: string;
        templateRoot?: string;
        logger?: RedWebLogger | null;
    }

    export interface StaticExportResult {
        readonly pages: readonly string[];
        readonly assets: readonly string[];
    }

    export function exportStatic(
        pageOrPages: LivePageClass | readonly LivePageClass[],
        options: StaticExportOptions
    ): Promise<StaticExportResult>;

    export interface SiteOptions {
        origin?: string;
        css?: string | readonly string[];
        head?: PageHead;
        cache?: PageCache;
        layout?: PageLayout;
    }

    export type SitePageOptions = PageOptions & { live?: false };

    export interface SiteExportOptions extends StaticExportOptions {
        publicDir?: string;
    }

    export interface StaticSite {
        page(path: string, options?: SitePageOptions): ClassDecorator;
        export(
            pageOrPages: LivePageClass | readonly LivePageClass[],
            options: SiteExportOptions
        ): Promise<StaticExportResult>;
    }

    export function defineSite(options?: SiteOptions): StaticSite;

    export class HtmlRenderer {
        static template(filePath: string, rootDir: string): string;
        static stylesheet(filePath: string, rootDir: string): string;
        static render(source: string, page: object, options?: { live?: boolean }): string;
        static collection(page: object, name: string, value: unknown): string;
        static statePayload(name: string, value: unknown, page?: object): { name: string; value: string; html: boolean };
        static head(metadata?: PageHead): string;
        static document(
            markup: string,
            config?: (Record<string, unknown> & { runtimePath: string }) | null,
            stylesheets?: string[],
            metadata?: PageHead
        ): string;
    }

    /** ─────────────────── CONSTANTS ─────────────────── */

    export const METHODS: {
        GET: 'get';
        POST: 'post';
        PUT: 'put';
        PATCH: 'patch';
        DELETE: 'delete';
        OPTIONS: 'options';
        HEAD: 'head';
        ALL: 'all';
    };

    export const ENCODINGS: {
        json: 'json';
        urlencoded: 'urlencoded';
    };

    export const HTTP_OPTIONS: RedWebOptions;
    export const SOCKET_OPTIONS: SocketServerOptions;

    export const ERROR_CODES: typeof import('redweb/client').ERROR_CODES;
}
