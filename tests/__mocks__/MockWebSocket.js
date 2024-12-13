class MockWebSocket {
    constructor() {
        this.listeners = {};
        this.readyState = MockWebSocket.OPEN;
    }

    static get OPEN() {
        return 1;
    }

    on(event, callback) {
        this.listeners[event] = callback;
    }

    send(data) {
        if (this.readyState === MockWebSocket.OPEN) {
            console.log(`MockWebSocket sent: ${data}`);
        } else {
            throw new Error('WebSocket is not open');
        }
    }

    close() {
        this.readyState = MockWebSocket.CLOSED;
        if (this.listeners['close']) {
            this.listeners['close']();
        }
    }
}

MockWebSocket.CLOSED = 3;

module.exports = MockWebSocket;
