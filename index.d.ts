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
        handlerConfig?: Array<new () => BaseHandler>;
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
         * Dictionary of message handlers for this handler.
         */
        messageHandlers: {
            [type: string]: (socket: WebSocket, data: any) => void;
        };

        /**
         * List of active WebSocket connections managed by this handler.
         */
        connections: WebSocket[];

        /**
         * Creates a new handler instance.
         * @param config - Configuration for the handler.
         */
        constructor(config: HandlerConfig);

        /**
         * Adds a new WebSocket connection, processes initial data, and sets up message handling for this handler.
         * @param socket - The WebSocket connection to add.
         * @param data - Optional initial data sent during the connection handshake.
         */
        newConnection(socket: WebSocket, data?: any): void;

        /**
         * Handles an incoming message and routes it to the appropriate handler function.
         * @param socket - The WebSocket connection that sent the message.
         * @param message - The incoming message in JSON string format.
         */
        handleMessage(socket: WebSocket, message: string): void;

        /**
         * Broadcasts a message to all connections managed by this handler.
         * @param message - The message to broadcast.
         */
        broadcast(message: object): void;
    }

    /**
     * Base WebSocket server class.
     */
    export class BaseSocketServer {
        /**
         * Map of connected WebSocket clients by their IP address.
         */
        clients: Map<string, WebSocket>;

        /**
         * List of handler instances currently registered with the server.
         */
        handlers: BaseHandler[];

        constructor(server: HTTPServer | HTTPSServer, options?: SocketServerOptions);

        /**
         * Adds a new handler to the WebSocket server.
         * @param HandlerClass - A class extending `BaseHandler` to add to the server.
         */
        addHandler(HandlerClass: new () => BaseHandler): void;
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
