/**
 * @typedef {Object} SocketServerOptions
 * @property {import('http').Server} [server] - The HTTP server instance to bind the WebSocket server to.
 * @property {number} [port=3000] - The port number for the WebSocket server.
 * @property {Array<new () => import('./SocketRoute').SocketRoute>} [routes] - An array of handler classes to use for routing.
 */

const DefaultRoute = require('./DefaultRoute');

const SOCKET_OPTIONS = {
    port: 3000,
    ssl: null,
    routes: []
};

/**
 * Broadcasts a message to all connected clients.
 * @param {BaseSocketServer} socketServer - The WebSocket server instance.
 * @param {object} message - The message to broadcast.
 */
function broadcast(socketServer, message) {
    socketServer.clients.forEach(client => client.send(JSON.stringify(message)));
}

/**
 * Represents the base WebSocket server.
 */
class BaseSocketServer {
    /**
     * @param {import('http').Server} server - The HTTP server instance to bind the WebSocket server to.
     * @param {SocketServerOptions} options - The configuration options for the WebSocket server.
     */
    constructor(server, options = {}) {
        this.clients = new Map(); // Map of clients by their IP addresses.
        Object.assign(this, { ...SOCKET_OPTIONS, ...options });
        this.server = server;
        if (!options.routes?.length) options.routes = [ DefaultRoute ];
        this.routes = options.routes.map((route) => new route(server));
        this.server.on('upgrade', this.handleUpgrade.bind(this));
    }

    handleUpgrade(req, sock, head) {
        const route = this.routes.find(route => route.path == req.url);
        if (!route) sock.destroy();
        else route.server.handleUpgrade(req, sock, head, (s, r) => route.server.emit('connection', s, r));
    }

    /**
     * 
     * @param {new () => import('./SocketRoute')} route 
     */
    addRoute(route) {
        this.routes.push(new route(this.server));
    }
}

module.exports = { BaseSocketServer, SOCKET_OPTIONS };
