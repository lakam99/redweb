const http = require('http');
const { BaseSocketServer } = require('./BaseSocketServer');

/**
 * WebSocket Server
 * @param {SocketServerOptions} options - Configuration options for SocketServer.
 * @return {Object} WebSocket server instance.
 */
class SocketServer extends BaseSocketServer {
    constructor(options) {
        const ownsServer = !options?.server;
        const server = options?.server || http.createServer();
        super(server, options, ownsServer, 'SocketServer');
        return this;
    }
}

module.exports = SocketServer;
