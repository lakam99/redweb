const http = require('http');
const { BaseHttpServer } = require('./BaseHttpServer');
const { listenServer, closeServer } = require('../serverLifecycle');

/**
 * HTTP Server
 * @param {RedWebOptions} options - Configuration options for RedWeb.
 * @return {Object} Express application instance.
 */
function HttpServer(options) {
    BaseHttpServer.call(this, options);
    this.server = http.createServer(this.app);
    this.shutdown = () => closeServer(this.server);
    if (this.listen !== false) {
        listenServer(this.server, {
            port: this.port,
            bind: this.bind,
            callback: this.listenCallback,
            logger: this.logger,
            name: 'HttpServer',
        });
    }
    return this;
}

module.exports = HttpServer;
