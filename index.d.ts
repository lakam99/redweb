declare module 'redweb' {
    import { Application } from 'express';
    import { CorsOptions } from 'cors';
    import { Server as NodeHttpServer } from 'http';
    import { WebSocket, ServerOptions } from 'ws';
    import { Buffer } from 'buffer';
    import { EventEmitter } from 'events';

    /** ─────────────────── HTTP / CORE ─────────────────── */

    export type RedWebEncoding = 'json' | 'urlencoded';

    export interface RedWebOptions {
        port?: number;
        bind?: string;
        publicPaths?: string[];
        services?: Array<{ serviceName: string; method: string; function: Function }>;
        listen?: boolean;
        listenCallback?: () => void;
        encoding?: RedWebEncoding;
        ssl?: { key: string; cert: string };
        server?: Application;
        corsOptions?: CorsOptions | false;
        enableHtmxRendering?: boolean;
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
        leaveRoom?(roomId: string): boolean;
        roomBroadcast?(roomId: string, data: unknown, options?: { except?: RedWebSocket }): number;
        createSession?(sessionId: string, data: unknown): boolean;
        resumeSession?(sessionId: string): unknown | null;
        publishEvent?(type: string, payload: unknown): Promise<boolean>;
        sendEvent?(type: string, payload: unknown, metadata?: ProtocolMetadata): boolean;
        sendProtocolError?(code: string, message: string, metadata?: ProtocolMetadata): boolean;
        sendBinaryEvent?(value: unknown): Promise<boolean>;
    };

    export interface RedWebConnectionContext {
        connectionId: string;
        principal: unknown;
        session: unknown | null;
        metadata: Record<string, unknown>;
        signal?: AbortSignal;
        protocol?: Readonly<{ version: string }>;
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

    export interface RoomOptions {
        maxRooms?: number;
        maxMembersPerRoom?: number;
        maxRoomsPerConnection?: number;
        maxRoomIdLength?: number;
    }

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
        start?(): void | Promise<void>;
        publish(channel: string, serializedEvent: string): void | Promise<void>;
        subscribe(
            channel: string,
            onEvent: (serializedEvent: string | DistributionEvent) => void
        ): void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>;
        unsubscribe?(channel: string): void | Promise<void>;
        close?(): void | Promise<void>;
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
        versions: string[];
        required?: boolean;
        queryParameter?: string;
        header?: string;
        binary?: false | ProtocolBinaryCodec;
    }

    /** ─────────────────── SOCKET SERVER ─────────────────── */

    export interface SocketServerOptions {
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
        websocketOptions?: Omit<ServerOptions, 'noServer' | 'path' | 'server' | 'port'>;
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
        beginDrain(): boolean;
        shutdown(): Promise<void>;
    }

    /** ─────────────────── REGISTRY & UTIL TYPES ─────────────────── */

    export function sendJson(socket: WebSocket, data: unknown): boolean;

    export class RoomRegistry {
        constructor(options?: RoomOptions);
        join(roomId: string, socket: RedWebSocket): boolean;
        leave(roomId: string, socket: RedWebSocket): boolean;
        leaveAll(socket: RedWebSocket): number;
        members(roomId: string): RedWebSocket[];
        has(roomId: string, socket: RedWebSocket): boolean;
        broadcast(roomId: string, data: unknown, options?: { except?: RedWebSocket }): number;
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
        app: Application;
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

    export const ERROR_CODES: Readonly<{
        INVALID_MESSAGE: 'INVALID_MESSAGE';
        UNKNOWN_HANDLER: 'UNKNOWN_HANDLER';
        HANDLER_FAILED: 'HANDLER_FAILED';
        BINARY_UNSUPPORTED: 'BINARY_UNSUPPORTED';
        RATE_LIMITED: 'RATE_LIMITED';
        QUEUE_FULL: 'QUEUE_FULL';
        CAPACITY_REACHED: 'CAPACITY_REACHED';
        INITIALIZATION_FAILED: 'INITIALIZATION_FAILED';
    }>;
}
