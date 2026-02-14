/**
 * @typedef {Object} SocketServerOptions
 * @property {import('http').Server} [server]                    HTTP server to bind to
 * @property {number}              [port=3000]                  Port to listen on
 * @property {Array<new () => import('./SocketRoute').SocketRoute>} [routes]
 */

const DefaultRoute = require('./DefaultRoute');

const SOCKET_OPTIONS = {
  port: 3000,
  ssl:  null,
  routes: []
};

/**
 * Base WebSocket server
 */
class BaseSocketServer {
  /**
   * @param {import('http').Server} server
   * @param {SocketServerOptions}  [options]
   */
  constructor(server, options = {}) {
    this.clients = new Map();
    Object.assign(this, { ...SOCKET_OPTIONS, ...options });
    this.server = server;

    /* ─── ROUTE INITIALISATION ─────────────────────────── */
    if (!options.routes?.length) options.routes = [DefaultRoute];
    this.routes = options.routes.map(RouteClass => new RouteClass(server));

    this.server.on('upgrade', this.handleUpgrade.bind(this));
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
      this.routes.find(r => r.path === '/');

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
    this.routes.push(new RouteClass(this.server));
  }

  /**
   * Gracefully tear down all routes (and their services)
   */
  shutdown() {
    this.routes.forEach(route => route.shutdown?.());
    this.server.close();
  }
}

module.exports = { BaseSocketServer, SOCKET_OPTIONS };
