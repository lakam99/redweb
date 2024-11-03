const https = require('https');
const loadSslConfig = require('../sslConfig');
const { BaseSocketServer } = require('./BaseSocketServer');

/**
 * Secure WebSocket Server
 * @param {SocketServerOptions} options - Configuration options for SecureSocketServer.
 * @return {Object} WebSocket server instance.
 */
class SecureSocketServer extends BaseSocketServer {
    constructor(options = {}) {
        const sslOptions = loadSslConfig(options.ssl);
        const server = https.createServer(sslOptions);
        super(server, options);
        server.listen(this.port, () => console.log(`RedWeb SecureSocketServer listening on port ${this.port}`));
        return this;
    }
}

module.exports = SecureSocketServer;
