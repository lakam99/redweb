const { BaseHandler } = require('../../src/ws/BaseHandler');

/**
 * MockHandler class for testing purposes.
 */
class MockHandler extends BaseHandler {
    constructor() {
        super('MockHandler');
    }

    onMessage(socket, message) {
        // Handle incoming messages for testing
        console.log(`MockHandler received message: ${JSON.stringify(message)}`);
        socket.send(JSON.stringify({ type: 'mockResponse', data: message }));
    }

    onInitialContact(socket) {
        // Example initial contact logic for testing
        console.log('MockHandler: Initial contact established');
    }
}

module.exports = MockHandler;
