declare module 'redweb' {
    import { Application } from 'express';
    import { CorsOptions } from 'cors';
    import { Server as HttpServer } from 'http';
    import { WebSocket } from 'ws';

    /** ─────────────────── HTTP / CORE ─────────────────── */

    export type RedWebEncoding = 'json' | 'urlencoded';

    export interface RedWebOptions {
        port?: number;
        bind?: string;
        publicPaths?: string[];
        services?: Array<{ serviceName: string; method: string; function: Function }>;
        listenCallback?: () => void;
        encoding?: RedWebEncoding;
        ssl?: { key: string; cert: string };
        server?: Application;
        corsOptions?: CorsOptions;
        enableHtmxRendering?: boolean;
    }

    /** ─────────────────── SOCKET SERVER ─────────────────── */

    export interface SocketServerOptions {
        server?: HttpServer;
        port?: number;
        routes?: Array<new () => SocketRoute>;
        ssl?: { key: string; cert: string };
    }

    /** ─────────────────── ROUTES & HANDLERS ─────────────────── */

    export interface SocketRouteConfig {
        path: string;
        handlers: Array<new () => BaseHandler>;
        services?: Array<new () => SocketService>;
        allowDuplicateConnections?: boolean;
    }

    /** Socket‑side autonomous service (game loops, timers, etc.) */
    export abstract class SocketService {
        name: string;
        tickRateMs?: number;
        protected _tickHandle?: NodeJS.Timeout;

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
            socket: WebSocket & {
                sendJson: (message: object) => void;
                broadcast: (message: object) => void;
            },
            message: any
        ): void;

        onMessage(socket: WebSocket, message: any): void;
        onInitialContact(socket: WebSocket): void;
    }

    export class SocketRoute {
        path: string;
        handlers: BaseHandler[];
        clients: Map<string, WebSocket>;
        allowDuplicateConnections?: boolean;

        constructor(config: SocketRouteConfig);

        addHandler(handler: new () => BaseHandler): void;
        handleMessage(sock: WebSocket, data: any): void;
    }

    /** ─────────────────── SERVER BASE ─────────────────── */

    export class BaseSocketServer {
        clients: Map<string, WebSocket>;
        server: HttpServer;
        routes: SocketRoute[];

        constructor(server: HttpServer, options?: SocketServerOptions);

        addRoute(route: new () => SocketRoute): void;
    }

    /** ─────────────────── REGISTRY & UTIL TYPES ─────────────────── */

    export interface SocketWrapper {
        socket: WebSocket;
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

    export class HttpServer {
        constructor(options?: RedWebOptions);
    }

    export class HttpsServer {
        constructor(options?: RedWebOptions);
    }

    /** ─────────────────── CONSTANTS ─────────────────── */

    export const METHODS: {
        GET: 'get';
        POST: 'post';
        PUT: 'put';
        DELETE: 'delete';
    };

    export const ENCODINGS: {
        json: 'json';
        urlencoded: 'urlencoded';
    };

    export const HTTP_OPTIONS: RedWebOptions;
    export const SOCKET_OPTIONS: SocketServerOptions;
}
