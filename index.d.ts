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
        path: string; // The WebSocket route path (e.g., "/chat").
        handlers: Array<new () => BaseHandler>; // Array of handler classes for the route.
    }

    /**
     * Represents a WebSocket route.
     */
    export class SocketRoute {
        /**
         * The path for the WebSocket route.
         */
        path: string;

        /**
         * Handlers associated with the route.
         */
        handlers: BaseHandler[];

        /**
         * Creates a new `SocketRoute` instance.
         * @param config - Configuration options for the route.
         */
        constructor(config: SocketRouteConfig);

        /**
         * Adds a new handler dynamically.
         * @param HandlerClass - A class extending `BaseHandler`.
         */
        addHandler(HandlerClass: new () => BaseHandler): void;

        /**
         * Handles a new WebSocket connection.
         * @param socket - The WebSocket connection instance.
         * @param req - The HTTP request associated with the connection.
         */
        handleConnection(socket: WebSocket, req: import('http').IncomingMessage): void;

        /**
         * Handles incoming WebSocket messages.
         * @param socket - The WebSocket connection instance.
         * @param data - The message data.
         */
        handleMessage(socket: WebSocket, data: any): void;

        /**
         * Handles WebSocket disconnections.
         * @param socket - The WebSocket connection instance.
         */
        handleClose(socket: WebSocket): void;

        /**
         * Handles WebSocket errors.
         * @param socket - The WebSocket connection instance.
         * @param error - The error object.
         */
        handleError(socket: WebSocket, error: Error): void;
    }

    /**
     * Base class for WebSocket handlers.
     */
    export class BaseHandler {
        /**
         * The name of the handler (used to identify it in the server).
         */
        name: string;
        /**
         * Creates a new handler instance.
         * @param name - The name of the handler.
         */
        constructor(name: string);

        /**
         * Handles an incoming message.
         * @param socket - The WebSocket connection that sent the message.
         * @param message - The message data.
         */
        onMessage(socket: WebSocket, message: Object): void;

        /**
         * Called during the first contact with a new WebSocket connection.
         * @param socket - The WebSocket connection instance.
         */
        onInitialContact(socket: WebSocket): void;

        /**
         * Called when a WebSocket connection closes.
         * @param socket - The WebSocket connection instance.
         */
        onClose(socket: WebSocket): void;
    }

    /**
     * Base WebSocket server class.
     */
    export class BaseSocketServer {
        /**
         * List of WebSocket routes.
         */
        routes: SocketRoute[];

        /**
         * Creates a new `BaseSocketServer`.
         * @param server - The HTTP server instance.
         * @param options - Configuration options.
         */
        constructor(server: HTTPServer | HTTPSServer, options?: SocketServerOptions);

        /**
         * Handles WebSocket upgrade requests.
         * @param req - The incoming HTTP upgrade request.
         * @param socket - The raw network socket.
         * @param head - The initial data chunk.
         */
        handleUpgrade(req: import('http').IncomingMessage, socket: import('net').Socket, head: Buffer): void;

        /**
         * 
         * @param route 
         */
        addRoute(route: new () => SocketRoute);
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
