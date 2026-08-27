const { performance } = require('perf_hooks');

class HeartbeatMonitor {
    constructor({ intervalMs, timeoutMs }, logger = console, clock = () => performance.now()) {
        if (!Number.isInteger(intervalMs) || intervalMs < 1) {
            throw new TypeError('`heartbeat.intervalMs` must be a positive integer.');
        }
        if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
            throw new TypeError('`heartbeat.timeoutMs` must be a positive integer.');
        }
        if (typeof clock !== 'function') throw new TypeError('`clock` must be a function.');
        this.intervalMs = intervalMs;
        this.timeoutMs = timeoutMs;
        this.logger = logger;
        this.clock = clock;
        this.sockets = new Map();
        this.timer = setInterval(() => this.tick(), Math.min(intervalMs, timeoutMs));
        this.timer.unref();
    }

    attach(socket) {
        this.detach(socket);
        const state = { awaitingPong: false, lastPing: null };
        const onPong = () => { state.awaitingPong = false; };
        state.onPong = onPong;
        this.sockets.set(socket, state);
        socket.on('pong', onPong);
    }

    detach(socket) {
        const state = this.sockets.get(socket);
        if (!state) return false;
        socket.off?.('pong', state.onPong);
        this.sockets.delete(socket);
        return true;
    }

    tick() {
        const now = this.clock();
        this.sockets.forEach((state, socket) => {
            if (state.awaitingPong && now - state.lastPing >= this.timeoutMs) {
                this.detach(socket);
                try {
                    socket.terminate?.();
                } catch (error) {
                    this.logger?.error?.('Error terminating unresponsive socket:', error);
                }
                return;
            }
            if (state.lastPing === null || now - state.lastPing >= this.intervalMs) {
                state.lastPing = now;
                state.awaitingPong = true;
                try {
                    socket.ping?.();
                } catch (error) {
                    this.logger?.error?.('Error pinging socket:', error);
                }
            }
        });
    }

    stop() {
        if (!this.timer) return;
        clearInterval(this.timer);
        this.timer = null;
        [...this.sockets.keys()].forEach(socket => this.detach(socket));
    }
}

module.exports = HeartbeatMonitor;
