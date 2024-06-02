const https = require('https');
const loadSslConfig = require('../sslConfig');
const BaseSocketServer = require('./BaseSocketServer');

/**
 * Secure WebSocket Server
 * @param {SocketServerOptions} options - Configuration options for SecureSocketServer.
 * @return {Object} WebSocket server instance.
 */
function SecureSocketServer(options = {}) {
    const sslOptions = loadSslConfig(options.ssl);
    const server = https.createServer(sslOptions);
    BaseSocketServer.call(this, server, options);
    server.listen(this.port, () => console.log(`RedWeb SecureSocketServer listening on port ${this.port}`));
    return this;
}

module.exports = SecureSocketServer;
