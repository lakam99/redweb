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
    }

    /**
     * Base class for HTTP servers.
     */
    export class BaseHttpServer {
        app: any;
        port: number;
        publicPaths: string[];
        services: Service[];
        listenCallback?: () => void;
        encoding: RedWebEncoding;
        ssl?: { key: string; cert: string; };

        constructor(options?: RedWebOptions);

        // Additional methods can be added as needed.
    }

    /**
     * HTTP server class.
     */
    export class HttpServer extends BaseHttpServer {
        constructor(options?: RedWebOptions);
    }

    /**
     * HTTPS server class.
     */
    export class HttpsServer extends BaseHttpServer {
        constructor(options?: RedWebOptions);
    }

    /**
     * Base class for WebSocket servers.
     */
    export class BaseSocketServer {
        wss: WebSocket.Server;
        clients: Map<string, WebSocket>;
        port: number;
        connectionOpenCallback?: (socket: WebSocket) => void;
        connectionCloseCallback?: (socket: WebSocket) => void;
        messageCallback?: (socket: WebSocket, message: string) => void;
        messageHandlers?: { [type: string]: (socket: WebSocket, data: any) => void; };
        ssl?: { key: string; cert: string; };

        constructor(server: HTTPServer | HTTPSServer, options?: SocketServerOptions);

        handleConnection(socket: WebSocket, req: Request): void;
        handleMessage(socket: WebSocket, message: string, ip: string): void;
        handleClose(socket: WebSocket, ip: string): void;
        handleError(socket: WebSocket, error: Error, ip: string): void;
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
    export function loadSslConfig(sslOptions: { key: string; cert: string; }): { key: string; cert: string; };

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
