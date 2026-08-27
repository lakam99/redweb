const SocketRoute  = require("./SocketRoute");
const DefaultHandler = require('./DefaultHandler');

class DefaultRoute extends SocketRoute {
    constructor(server, options = {}) {
        super({
            server,
            path: "/",
            handlers: [DefaultHandler],
            logger: options.logger,
        })
    }
}

module.exports = DefaultRoute;
