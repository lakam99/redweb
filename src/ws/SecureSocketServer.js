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
        const ownsServer = !options?.server;
        const sslOptions = ownsServer ? loadSslConfig(options.ssl) : null;
        const server = options?.server || https.createServer(sslOptions);
        super(server, options);
        if ((ownsServer && this.listen !== false) || (!ownsServer && options.listen === true)) {
            server.listen(this.port, () => console.log(`RedWeb SecureSocketServer listening on port ${this.port}`));
        }
        return this;
    }
}

module.exports = SecureSocketServer;
