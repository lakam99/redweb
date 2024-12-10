/**
 * Represents the base class for a WebSocket message handler.
 */
class BaseHandler {
    /**
     * Creates a new handler instance.
     * @param {{ name: string, handlers: Record<string, (socket: WebSocket, data: object) => void> }} config
     * - `name`: The unique name of the handler.
     * - `handlers`: A dictionary of message types and their corresponding handler functions.
     */
    constructor(config) {
        /**
         * The name of the handler (used to identify this handler in the server).
         * @type {string}
         */
        this.name = config.name;

        /**
         * The dictionary of message handlers for this handler.
         * @type {Record<string, (socket: WebSocket, data: object) => void>}
         */
        this.messageHandlers = config.handlers || {};

        /**
         * The list of active WebSocket connections managed by this handler.
         * @type {WebSocket[]}
         */
        this.connections = [];
    }

    handleSocketMessages(socket) {
        socket.on('message', (message) => this.handleMessage(socket, message));
    }

    handleSocketClose(socket) {
        socket.on('close', () => {
            this.onClose(socket);
            this.connections = this.connections.filter((conn) => conn !== socket);
            console.log(`Connection closed for handler "${this.name}".`);
        });
    }

    handleNewConnection(socket) {
        this.connections.push(socket);
        this.handleSocketMessages(socket);
        this.handleSocketClose(socket);
        socket.isAssigned = true;
        console.log(`New connection added to handler "${this.name}".`);
    }

    /**
     * Adds a new WebSocket connection and sets up message handling for this handler.
     * @param {WebSocket} socket - The WebSocket connection to add.
     */
    newConnection(socket, data) {
        console.log(`Received newConnection data ${JSON.stringify(data)}`);
        this.handleNewConnection(socket);
    }

    onClose(socket) {
        console.log(`Closing socket ${socket.remoteAddress}`);
    }

    /**
     * Handles an incoming message and routes it to the appropriate handler function.
     * @param {WebSocket} socket - The WebSocket connection that sent the message.
     * @param {string} message - The incoming message in JSON string format.
     */
    handleMessage(socket, message) {
        try {
            const parsedMessage = JSON.parse(message);
            const { type, ...data } = parsedMessage;

            if (this.messageHandlers[type]) {
                this.messageHandlers[type](socket, data);
            } else {
                console.warn(`Unhandled message type: "${type}" in handler "${this.name}".`);
                socket.close();
            }
        } catch (error) {
            console.error(`Error processing message in handler "${this.name}":`, error);
        }
    }

    /**
     * Broadcasts a message to all connections managed by this handler.
     * @param {object} message - The message to broadcast.
     */
    broadcast(message) {
        this.connections.forEach((socket) => {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify(message));
            }
        });
    }
}

module.exports = { BaseHandler };
