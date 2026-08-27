/**
 * @typedef {Object} SocketServerOptions
 * @property {import('http').Server} [server]                    HTTP server to bind to
 * @property {number}              [port=3000]                  Port to listen on
 * @property {boolean}             [listen=true]                Whether owned servers should automatically start listening
 * @property {Array<new () => import('./SocketRoute').SocketRoute>} [routes]
 */

const DefaultRoute = require('./DefaultRoute');
const { listenServer, closeServer } = require('../serverLifecycle');

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
    if (!Number.isInteger(this.port) || this.port < 0 || this.port > 65535) throw new TypeError('`port` must be an integer between 0 and 65535.');
    if (!Array.isArray(this.routes)) throw new TypeError('`routes` must be an array.');
    this.server = server;
    this.ownsServer = ownsServer;
    this.closeServerOnShutdown = options.closeServerOnShutdown ?? ownsServer;

    /* ─── ROUTE INITIALISATION ─────────────────────────── */
    const RouteClasses = options.routes?.length ? [...options.routes] : [DefaultRoute];
    this.routes = RouteClasses.map(RouteClass => new RouteClass(server, { logger: this.logger }));
    this.assertUniqueRoutes();

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

  assertUniqueRoutes() {
    const paths = this.routes.map(route => route.path);
    if (new Set(paths).size !== paths.length) throw new Error('WebSocket route paths must be unique.');
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

    route.server.handleUpgrade(req, sock, head, (s, r) =>
      route.server.emit('connection', s, r)
    );
  }

  /**
   * Dynamically attach a new route at runtime
   * @param {new () => import('./SocketRoute').SocketRoute} RouteClass
   */
  addRoute(RouteClass) {
    const route = new RouteClass(this.server, { logger: this.logger });
    if (this.routes.some(existing => existing.path === route.path)) {
      route.shutdown?.();
      throw new Error(`A WebSocket route already exists at ${route.path}.`);
    }
    this.routes.push(route);
    return route;
  }

  /**
   * Gracefully tear down all routes (and their services)
   */
  async shutdown() {
    this.server.off?.('upgrade', this._upgradeHandler);
    await Promise.all(this.routes.map(route => Promise.resolve(route.shutdown?.())));
    if (!this.closeServerOnShutdown || !this.server.listening) return;
    await closeServer(this.server);
  }
}

module.exports = { BaseSocketServer, SOCKET_OPTIONS };
