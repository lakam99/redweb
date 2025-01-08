declare module 'redweb' {
    import { Request, Response } from 'express';
    import { Server as HTTPServer } from 'http';
    import { Server as HTTPSServer } from 'https';
    import WebSocket from 'ws';

    /**
     * RedWeb encoding types.
     */
    export type RedWebEncoding = 'json' | 'urlencoded';

    /**
     * Service configuration for RedWeb.
     */
    export interface Service {
        serviceName: string;
        method: 'get' | 'post' | 'put' | 'delete' | 'patch' | 'options' | 'head';
        function: (req: Request, res: Response) => void;
    }

    /**
     * Options for configuring a RedWeb server.
     */
    export interface RedWebOptions {
        port?: number;
        bind?: string;
        publicPaths?: string[];
        services?: Service[];
        listenCallback?: () => void;
        encoding?: RedWebEncoding;
        ssl?: {
            key: string;
            cert: string;
        };
        corsOptions?: import('cors').CorsOptions;
        enableHtmxRendering?: boolean; // New flag to enable HTMX rendering
    }

    /**
     * Configuration for a WebSocket handler.
     */
    export interface HandlerConfig {
        name: string;
        handlers: {
            [type: string]: (socket: WebSocket, data: any) => void;
        };
    }

    /**
     * Options for configuring a WebSocket server.
     */
    export interface SocketServerOptions {
        port?: number;
        connectionOpenCallback?: (socket: WebSocket) => void;
        connectionCloseCallback?: (socket: WebSocket) => void;
        messageCallback?: (socket: WebSocket, message: string) => void;
        messageHandlers?: {
            [type: string]: (socket: WebSocket, data: any) => void;
        };
        ssl?: {
            key: string;
            cert: string;
        };
        routes?: Array<new () => SocketRoute>;
    }

    /**
     * WebSocket route configuration.
     */
    export interface SocketRouteConfig {
        path: string;
        handlers: Array<new () => BaseHandler>;
    }

    /**
     * Represents a WebSocket route.
     */
    export class SocketRoute {
        path: string;
        handlers: BaseHandler[];

        constructor(config: SocketRouteConfig);

        addHandler(HandlerClass: new () => BaseHandler): void;
        handleConnection(socket: WebSocket, req: import('http').IncomingMessage): void;
        handleMessage(socket: WebSocket, data: any): void;
        handleClose(socket: WebSocket): void;
        handleError(socket: WebSocket, error: Error): void;
    }

    /**
     * Base class for WebSocket handlers.
     */
    export class BaseHandler {
        name: string;

        constructor(name: string);
        onMessage(socket: WebSocket, message: Object): void;
        onInitialContact(socket: WebSocket): void;
        onClose(socket: WebSocket): void;
    }

    /**
     * Base WebSocket server class.
     */
    export class BaseSocketServer {
        routes: SocketRoute[];

        constructor(server: HTTPServer | HTTPSServer, options?: SocketServerOptions);
        handleUpgrade(req: import('http').IncomingMessage, socket: import('net').Socket, head: Buffer): void;
        addRoute(route: new () => SocketRoute): void;
    }

    /**
     * HTTP server class.
     */
    export class HttpServer {
        constructor(options?: RedWebOptions);
    }

    /**
     * HTTPS server class.
     */
    export class HttpsServer {
        constructor(options?: RedWebOptions);
    }

    /**
     * WebSocket server class.
     */
    export class SocketServer extends BaseSocketServer {
        constructor(options?: SocketServerOptions);
    }

    /**
     * Secure WebSocket server class.
     */
    export class SecureSocketServer extends BaseSocketServer {
        constructor(options?: SocketServerOptions);
    }

    /**
     * SSL configuration loader.
     */
    export function loadSslConfig(sslOptions: { key: string; cert: string }): { key: string; cert: string };

    /**
     * Constants for encoding types.
     */
    export const ENCODINGS: {
        json: 'json';
        urlencoded: 'urlencoded';
    };

    /**
     * Constants for HTTP methods.
     */
    export const METHODS: {
        POST: 'post';
        GET: 'get';
        PUT: 'put';
        DELETE: 'delete';
        PATCH: 'patch';
        OPTIONS: 'options';
        HEAD: 'head';
    };

    /**
     * Default HTTP options.
     */
    export const HTTP_OPTIONS: RedWebOptions;

    /**
     * Default socket options.
     */
    export const SOCKET_OPTIONS: SocketServerOptions;
}
