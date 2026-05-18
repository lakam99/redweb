const http = require('http');
const { BaseSocketServer } = require('./BaseSocketServer');

/**
 * WebSocket Server
 * @param {SocketServerOptions} options - Configuration options for SocketServer.
 * @return {Object} WebSocket server instance.
 */
class SocketServer extends BaseSocketServer {
    constructor(options = {}) {
        const ownsServer = !options?.server;
        const server = options?.server || http.createServer();
        super(server, options);
        if ((ownsServer && this.listen !== false) || (!ownsServer && options.listen === true)) {
            server.listen(this.port, () => console.log(`RedWeb SocketServer listening on port ${this.port}`));
        }
        return this;
    }
}

module.exports = SocketServer;
