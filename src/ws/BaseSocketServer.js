/**
 * @typedef {Object} SocketServerOptions
 * @property {import('http').Server} [server]                    HTTP server to bind to
 * @property {number}              [port=3000]                  Port to listen on
 * @property {boolean}             [listen=true]                Whether owned servers should automatically start listening
 * @property {Array<new () => import('./SocketRoute').SocketRoute>} [routes]
 */

const DefaultRoute = require('./DefaultRoute');
const {
  listenServer,
  closeServer,
  settleTasks,
  throwCleanupErrors,
  validateListenerOptions,
} = require('../serverLifecycle');

const SOCKET_OPTIONS = {
  port: 3000,
  bind: '0.0.0.0',
  ssl:  null,
  listen: true,
  routes: [],
  fallbackToRoot: false,
  closeServerOnShutdown: undefined,
  logger: console,
  listenCallback: undefined,
};

/**
 * Base WebSocket server
 */
class BaseSocketServer {
  /**
   * @param {import('http').Server} server
   * @param {SocketServerOptions}  [options]
   */
  constructor(server, options = {}, ownsServer = false, name = 'SocketServer') {
    if (!server || typeof server.on !== 'function') throw new TypeError('A Node HTTP(S) server is required.');
    Object.assign(this, { ...SOCKET_OPTIONS, ...options });
    validateListenerOptions(this);
    if (!Array.isArray(this.routes)) throw new TypeError('`routes` must be an array.');
    this.server = server;
    this.ownsServer = ownsServer;
    this.closeServerOnShutdown = options.closeServerOnShutdown ?? ownsServer;
    this.draining = false;

    /* ─── ROUTE INITIALISATION ─────────────────────────── */
    const RouteClasses = options.routes?.length ? [...options.routes] : [DefaultRoute];
    this.routes = [];
    try {
      for (const RouteClass of RouteClasses) {
        const route = new RouteClass(server, { logger: this.logger });
        if (this.routes.some(existing => existing.path === route.path)) {
          this.disposeRoutes([route]);
          throw new Error('WebSocket route paths must be unique.');
        }
        this.routes.push(route);
      }
    } catch (error) {
      this.disposeRoutes(this.routes);
      throw error;
    }

    this._upgradeHandler = this.handleUpgrade.bind(this);
    this.server.on('upgrade', this._upgradeHandler);

    const shouldListen = (ownsServer && this.listen !== false) || (!ownsServer && options.listen === true);
    if (shouldListen) {
      listenServer(this.server, {
        port: this.port,
        bind: this.bind,
        callback: this.listenCallback,
        logger: this.logger,
        name,
      });
    }
  }

  disposeRoutes(routes) {
    routes.forEach(route => {
      Promise.resolve()
        .then(() => route.shutdown?.())
        .catch(error => this.logger?.error?.('Error shutting down route:', error));
    });
  }

  handleUpgrade(req, sock, head) {
    // Some websocket clients (e.g., certain UE plugins) are finicky about the
    // HTTP upgrade path they send. Normalise the path and fall back to a default
    // route so we can still complete the upgrade instead of tearing the socket down.
    const path = (() => {
      try {
        return new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
      } catch {
        return req.url;
      }
    })();

    const route =
      this.routes.find(r => r.path === path) ||
      (this.fallbackToRoot ? this.routes.find(r => r.path === '/') : undefined);

    if (!route) return sock.destroy();
    if (this.draining) return this.rejectUpgrade(sock, 503, 'Service Unavailable');

    if (route.admissionPolicy) {
      void Promise.resolve()
        .then(() => route.authorizeUpgrade(req, sock))
        .then(accepted => {
          if (sock.destroyed) return;
          if (!accepted) return this.rejectUpgrade(sock, 401, 'Unauthorized');
          if (this.draining) return this.rejectUpgrade(sock, 503, 'Service Unavailable');
          this.completeUpgrade(route, req, sock, head);
        })
        .catch(error => {
          this.logger?.error?.('WebSocket admission failed:', error);
          if (!sock.destroyed) this.rejectUpgrade(sock, 401, 'Unauthorized');
        });
      return;
    }

    this.completeUpgrade(route, req, sock, head);
  }

  completeUpgrade(route, req, sock, head) {
    route.server.handleUpgrade(req, sock, head, (s, r) =>
      route.server.emit('connection', s, r)
    );
  }

  rejectUpgrade(socket, statusCode, statusText) {
    try {
      socket.end?.(
        `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
        'Connection: close\r\n' +
        'Content-Length: 0\r\n\r\n'
      );
    } catch {
      socket.destroy?.();
    }
  }

  /**
   * Dynamically attach a new route at runtime
   * @param {new () => import('./SocketRoute').SocketRoute} RouteClass
   */
  addRoute(RouteClass) {
    const route = new RouteClass(this.server, { logger: this.logger });
    if (this.routes.some(existing => existing.path === route.path)) {
      this.disposeRoutes([route]);
      throw new Error(`A WebSocket route already exists at ${route.path}.`);
    }
    this.routes.push(route);
    return route;
  }

  /**
   * Gracefully tear down all routes (and their services)
   */
  shutdown() {
    if (!this._shutdownPromise) this._shutdownPromise = this.performShutdown();
    return this._shutdownPromise;
  }

  async performShutdown() {
    this.draining = true;
    this.server.off?.('upgrade', this._upgradeHandler);
    const errors = await settleTasks(this.routes.map(route => () => route.shutdown?.()));
    if (this.closeServerOnShutdown && this.server.listening) {
      try {
        await closeServer(this.server);
      } catch (error) {
        errors.push(error);
      }
    }
    throwCleanupErrors(errors, 'One or more WebSocket server cleanup operations failed.');
  }
}

module.exports = { BaseSocketServer, SOCKET_OPTIONS };
