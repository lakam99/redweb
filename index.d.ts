declare module 'redweb' {
    import { Application } from 'express';
    import { CorsOptions } from 'cors';
    import { Server as HttpServer } from 'http';
    import { WebSocket } from 'ws';
  
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
  
    export interface SocketServerOptions {
      server?: HttpServer;
      port?: number;
      routes?: Array<new () => SocketRoute>;
      ssl?: { key: string; cert: string };
    }
  
    export interface SocketRouteConfig {
      path: string;
      handlers: Array<new () => BaseHandler>;
      allowDuplicateConnections?: boolean;
    }
  
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
  
    export class BaseSocketServer {
      clients: Map<string, WebSocket>;
      server: HttpServer;
      routes: SocketRoute[];
      constructor(server: HttpServer, options?: SocketServerOptions);
      addRoute(route: new () => SocketRoute): void;
    }
  
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
  