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
    };

    export interface RedWebConnectionContext {
        connectionId: string;
        principal: unknown;
        session: unknown | null;
        metadata: Record<string, unknown>;
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
        onTick?(): void;

        /** Called on process shutdown / route removal */
        onShutdown(): void;
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
        allowDuplicateConnections?: boolean;
        websocketOptions?: SocketRouteConfig['websocketOptions'];

        constructor(config: SocketRouteConfig);

        addHandler(handler: new () => BaseHandler): boolean;
        resolveRemoteAddress(request: import('http').IncomingMessage): string;
        connectionOpenCallback(socket: RedWebSocket, request?: import('http').IncomingMessage): unknown;
        connectionCloseCallback?(socket: RedWebSocket): unknown;
        handleMessage(sock: RedWebSocket, data: any): Promise<boolean>;
        handleBinaryMessage(socket: RedWebSocket, buffer: Buffer): Promise<boolean>;
        shutdown(): Promise<void>;
    }

    /** ─────────────────── SERVER BASE ─────────────────── */

    export class BaseSocketServer {
        server: NodeHttpServer;
        routes: SocketRoute[];
        ownsServer: boolean;

        constructor(server: NodeHttpServer, options?: SocketServerOptions);

        addRoute(route: new () => SocketRoute): SocketRoute;
        shutdown(): Promise<void>;
    }

    /** ─────────────────── REGISTRY & UTIL TYPES ─────────────────── */

    export function sendJson(socket: WebSocket, data: unknown): boolean;

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
}
