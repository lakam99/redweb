const http = require('http');
const { BaseHttpServer } = require('./BaseHttpServer');

/**
 * HTTP Server
 * @param {RedWebOptions} options - Configuration options for RedWeb.
 * @return {Object} Express application instance.
 */
function HttpServer(options = {}) {
    BaseHttpServer.call(this, options);
    this.server = http.createServer(this.app);
    if (this.listen !== false) {
        this.server.listen(this.port, this.listenCallback ? this.listenCallback : () => console.log(`RedWeb HttpServer listening on port ${this.port}`));
    }
    return this;
}

module.exports = HttpServer;
