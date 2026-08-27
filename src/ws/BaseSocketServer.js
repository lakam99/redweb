/**
 * @typedef {Object} SocketServerOptions
 * @property {import('http').Server} [server]                    HTTP server to bind to
 * @property {number}              [port=3000]                  Port to listen on
 * @property {boolean}             [listen=true]                Whether owned servers should automatically start listening
 * @property {Array<new () => import('./SocketRoute').SocketRoute>} [routes]
 */

const DefaultRoute = require('./DefaultRoute');
const { PLACEMENT_REDIRECT, ADMISSION_SETTLEMENT } = require('./AdmissionPolicy');
const { PROTOCOL_REJECTION } = require('./ProtocolPolicy');
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
    this.pendingUpgrades = new Map();
    this.rawConnections = ownsServer ? new Set() : null;
    this._connectionHandler = this.rawConnections ? socket => {
      this.rawConnections.add(socket);
      socket.once('close', () => this.rawConnections.delete(socket));
    } : null;
    if (this._connectionHandler) this.server.on('connection', this._connectionHandler);

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
    if (route.isReady?.() === false) return this.rejectUpgrade(sock, 503, 'Service Unavailable');

    if (route.admissionPolicy || route.protocolPolicy || route.transportPolicy && route.transportPolicy.maxConnections !== Infinity) {
      let reservation;
      try {
        reservation = route.reserveUpgrade(req);
      } catch (error) {
        this.logger?.error?.('WebSocket admission reservation failed:', error);
      }
      if (!reservation) return this.rejectUpgrade(sock, 503, 'Service Unavailable');
      const controller = new AbortController();
      this.pendingUpgrades.set(sock, { controller, route, reservation });
      void Promise.resolve()
        .then(() => route.authorizeUpgrade(req, sock, controller.signal))
        .then(accepted => {
          if (sock.destroyed) return;
          if (this.draining) return this.rejectUpgrade(sock, 503, 'Service Unavailable');
          if (!accepted) {
            const redirect = req[PLACEMENT_REDIRECT];
            if (redirect) return this.rejectUpgrade(sock, 307, 'Temporary Redirect', { Location: redirect });
            const rejection = req[PROTOCOL_REJECTION];
            return rejection
              ? this.rejectUpgrade(sock, rejection.statusCode, rejection.statusText, rejection.headers)
              : this.rejectUpgrade(sock, 401, 'Unauthorized');
          }
          this.completeUpgrade(route, req, sock, head);
        })
        .catch(error => {
          this.logger?.error?.('WebSocket admission failed:', error);
          if (!sock.destroyed) this.rejectUpgrade(sock, 401, 'Unauthorized');
        })
        .finally(async () => {
          await req[ADMISSION_SETTLEMENT];
          this.pendingUpgrades.delete(sock);
          route.releaseUpgrade(reservation);
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

  rejectUpgrade(socket, statusCode, statusText, headers = {}) {
    try {
      const extraHeaders = Object.entries(headers).map(([name, value]) => `${name}: ${value}\r\n`).join('');
      socket.end?.(
        `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
        extraHeaders +
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

  isReady() {
    return !this.draining && this.routes.every(route => route.isReady?.() !== false);
  }

  beginDrain() {
    if (this.draining) return false;
    this.draining = true;
    this.pendingUpgrades.forEach(({ controller }) => controller.abort());
    this.routes.forEach(route => route.beginDrain?.());
    return true;
  }

  async performShutdown() {
    this.beginDrain();
    this.server.off?.('upgrade', this._upgradeHandler);
    const deadline = Date.now() + Math.max(0, ...this.routes.map(route => route.shutdownTimeoutMs));
    const errors = await settleTasks(this.routes.map(route => () => route.shutdown?.()));
    if (this.closeServerOnShutdown && this.server.listening) {
      try {
        await this.closeOwnedServer(Math.max(0, deadline - Date.now()));
      } catch (error) {
        errors.push(error);
      }
    }
    if (this._connectionHandler) this.server.off?.('connection', this._connectionHandler);
    throwCleanupErrors(errors, 'One or more WebSocket server cleanup operations failed.');
  }

  closeOwnedServer(timeoutMs) {
    let timer;
    const closing = closeServer(this.server);
    const timeout = new Promise(resolve => {
      timer = setTimeout(() => {
        this.rawConnections?.forEach(socket => socket.destroy?.());
        resolve();
      }, timeoutMs);
      timer.unref?.();
    });
    return Promise.race([closing, timeout]).finally(() => clearTimeout(timer));
  }
}

module.exports = { BaseSocketServer, SOCKET_OPTIONS };
