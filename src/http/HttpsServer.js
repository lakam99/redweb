const https = require('https');
const { BaseHttpServer } = require('./BaseHttpServer');
const loadSslConfig = require('../sslConfig');
const { listenServer, closeServer } = require('../serverLifecycle');

/**
 * HTTPS Server
 * @param {RedWebOptions} options - Configuration options for RedWeb.
 * @return {Object} Express application instance.
 */
function HttpsServer(options) {
    BaseHttpServer.call(this, options);
    const sslOptions = loadSslConfig(this.ssl);
    this.server = https.createServer(sslOptions, this.app);
    this.shutdown = () => closeServer(this.server);
    if (this.listen === false) {
        return this;
    }

    listenServer(this.server, {
        port: this.port,
        bind: this.bind,
        callback: this.listenCallback,
        logger: this.logger,
        name: 'HttpsServer',
    });
    return this;
}

module.exports = HttpsServer;
