const SocketRoute  = require("./SocketRoute");
const DefaultHandler = require('./DefaultHandler');

class DefaultRoute extends SocketRoute {
    constructor(server) {
        super({
            server,
            path: "/",
            handlers: [DefaultHandler]
        })
    }
}

module.exports = DefaultRoute;