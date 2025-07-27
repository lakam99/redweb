/**
 * Represents the base class for a WebSocket message handler.
 */
class BaseHandler {
    /**
     * Creates a new handler instance.
     * @param {string} name - The name of the Handler, used in the client 'type' arg of request e.g {"type": "<handler-name>", ...}
     */
    constructor(name) {
        /**
         * he name of the Handler, used in the client 'type' arg of request e.g {"type": "<handler-name>", ...}.
         * @type {string}
         */
        this.name = name;
    }
    /**
     * Handles an incoming message and routes it to the appropriate handler function.
     * @param {WebSocket & {sendJson: (message: Object) => void, broadcast: (message: Object) => void}} socket - The WebSocket connection that sent the message.
     * @param {any} message - The incoming message in parsed JSON.
     */
    handleMessage(socket, message) {
        this.onMessage(socket, message);
    }

    /**
     * Method to be overriden to process messages.
     * @param {WebSocket} socket - The WebSocket connection that sent the message.
     * @param {any} message - The incoming message in parsed JSON.
     */
    onMessage(socket, message) {
        throw "Not yet implemented!";
    }

    onInitialContact(socket) {

    }
}

module.exports = { BaseHandler };
