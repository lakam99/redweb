const { BaseHandler } = require("./BaseHandler");

class DefaultHandler extends BaseHandler {
    constructor() {
        super("DefaultHandler");
    }

    onMessage(socket, message) {
        socket.sendJson({ message: `I got your message of ${JSON.stringify(message)}` });
    }
}

module.exports = DefaultHandler;
