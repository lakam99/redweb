const http = require('http');
const BaseSocketServer = require('./BaseSocketServer');

/**
 * WebSocket Server
 * @param {SocketServerOptions} options - Configuration options for SocketServer.
 * @return {Object} WebSocket server instance.
 */
function SocketServer(options = {}) {
    const server = http.createServer();
    BaseSocketServer.call(this, server, options);
    server.listen(this.port, () => console.log(`RedWeb SocketServer listening on port ${this.port}`));
    return this;
}

module.exports = SocketServer;
