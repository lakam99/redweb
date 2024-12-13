const { BaseHandler } = require("./BaseHandler");
const { sendJson } = require("./util");

class DefaultHandler extends BaseHandler {
    constructor() {
        super("DefaultHandler");
    }

    onMessage(socket, message) {
        socket.send(sendJson(`I got your message of ${JSON.stringify(message)}`));
    }
}

module.exports = DefaultHandler;