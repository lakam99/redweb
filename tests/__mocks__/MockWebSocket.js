class MockWebSocket {
    constructor() {
        this.readyState = MockWebSocket.OPEN;
        this.listeners = {};
    }

    static OPEN = 1;
    static CLOSED = 3;

    on(event, callback) {
        this.listeners[event] = callback;
    }

    send(message) {
        if (this.readyState === MockWebSocket.OPEN) {
            if (this.listeners['message']) {
                this.listeners['message'](message);
            }
        }
    }

    close() {
        this.readyState = MockWebSocket.CLOSED;
        if (this.listeners['close']) {
            this.listeners['close']();
        }
    }

    emit(event, data) {
        if (this.listeners[event]) {
            this.listeners[event](data);
        }
    }

    /**
     * Removes all event listeners.
     */
    removeAllListeners() {
        this.listeners = {};
    }
}

module.exports = MockWebSocket;
