const https = require('https');
const { BaseHttpServer } = require('./BaseHttpServer');
const loadSslConfig = require('../sslConfig');

/**
 * HTTPS Server
 * @param {RedWebOptions} options - Configuration options for RedWeb.
 * @return {Object} Express application instance.
 */
function HttpsServer(options = {}) {
    BaseHttpServer.call(this, options);
    const sslOptions = loadSslConfig(this.ssl);
    this.server = https.createServer(sslOptions, this.app);
    if (this.listen === false) {
        return this;
    }

    this.server.listen(this.port, this.listenCallback ? this.listenCallback : () => console.log(`RedWeb HttpsServer listening on port ${this.port}`));
    return this;
}

module.exports = HttpsServer;
