const http = require('http');
const { BaseSocketServer } = require('./BaseSocketServer');

/**
 * WebSocket Server
 * @param {SocketServerOptions} options - Configuration options for SocketServer.
 * @return {Object} WebSocket server instance.
 */
class SocketServer extends BaseSocketServer {
    constructor(options = {}) {
        const server = http.createServer();
        super(server, options);
        server.listen(this.port, () => console.log(`RedWeb SocketServer listening on port ${this.port}`));
        return this;
    }
}

module.exports = SocketServer;
